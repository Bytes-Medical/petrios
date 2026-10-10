/**
 * SSRF guard for organisation-admin webhook URLs (spec/09, "Delivery
 * semantics and SSRF boundary"). Pure functions only: lib/webhooks.ts applies
 * them to the URL at registration and delivery, and again to every address
 * DNS returns before the Node transport connects.
 *
 * Blocked: anything that is not plain http(s); hosts that are not public
 * names (single-label service names such as compose's `db` or `rest`, and
 * special-use suffixes like `.localhost`, `.internal`, `.home.arpa`); and any
 * IPv4 or IPv6 address outside public unicast space — loopback, RFC 1918,
 * link-local, CGNAT, benchmarking, multicast/reserved, unique-local, and
 * IPv4-mapped / NAT64 / 6to4 forms of those. WHATWG URL parsing has already
 * normalised alternative IPv4 spellings (`0x7f.1`, `2130706433`, `0`) to
 * dotted quads by the time these run.
 */

/** IPv4 CIDR blocks that are never a public webhook destination. */
const BLOCKED_IPV4_CIDRS: readonly [string, number][] = [
  ['0.0.0.0', 8], // "this network"; 0.0.0.0 reaches localhost on Linux
  ['10.0.0.0', 8], // RFC 1918
  ['100.64.0.0', 10], // CGNAT / Tailscale / some cloud metadata
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12], // RFC 1918
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay anycast (deprecated)
  ['192.168.0.0', 16], // RFC 1918
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
]

/** Special-use or private DNS names (exact match or any subdomain). */
const BLOCKED_NAME_SUFFIXES: readonly string[] = [
  'localhost',
  'local',
  'localdomain',
  'internal',
  'intranet',
  'private',
  'corp',
  'home',
  'lan',
  'arpa', // includes home.arpa, in-addr.arpa, ip6.arpa
  'test',
  'example',
  'invalid',
  'onion',
]

function parseIpv4(address: string): number | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    value = value * 256 + octet
  }
  return value
}

function ipv4InCidr(value: number, base: string, bits: number): boolean {
  const baseValue = parseIpv4(base)
  if (baseValue === null) return false
  const size = 2 ** (32 - bits)
  return Math.floor(value / size) === Math.floor(baseValue / size)
}

function isBlockedIpv4Value(value: number): boolean {
  return BLOCKED_IPV4_CIDRS.some(([base, bits]) => ipv4InCidr(value, base, bits))
}

/** Parses an IPv6 address (no brackets) into eight 16-bit groups. */
function parseIpv6(address: string): number[] | null {
  if (!address.includes(':')) return null
  let text = address

  // A trailing dotted IPv4 (e.g. ::ffff:127.0.0.1) becomes two groups.
  const lastColon = text.lastIndexOf(':')
  const tail = text.slice(lastColon + 1)
  if (tail.includes('.')) {
    const v4 = parseIpv4(tail)
    if (v4 === null) return null
    text = `${text.slice(0, lastColon + 1)}${Math.floor(v4 / 65536).toString(16)}:${(v4 % 65536).toString(16)}`
  }

  const halves = text.split('::')
  if (halves.length > 2) return null
  const parseGroups = (part: string): number[] | null => {
    if (part === '') return []
    const groups: number[] = []
    for (const group of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/i.test(group)) return null
      groups.push(parseInt(group, 16))
    }
    return groups
  }
  const head = parseGroups(halves[0])
  const rest = halves.length === 2 ? parseGroups(halves[1]) : []
  if (!head || !rest) return null

  if (halves.length === 1) {
    return head.length === 8 ? head : null
  }
  const missing = 8 - head.length - rest.length
  if (missing < 1) return null
  return [...head, ...new Array<number>(missing).fill(0), ...rest]
}

function embeddedIpv4(groups: number[], index: number): number {
  return groups[index] * 65536 + groups[index + 1]
}

function isBlockedIpv6Groups(groups: number[]): boolean {
  const [g0, g1, g2, g3, g4, g5] = groups

  // ::/96 — unspecified, loopback, deprecated IPv4-compatible.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return true
  // ::ffff:0:0/96 — IPv4-mapped: judge the embedded IPv4 address.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return isBlockedIpv4Value(embeddedIpv4(groups, 6))
  }
  // 64:ff9b::/96 — well-known NAT64 prefix (DNS64 hosts): judge the IPv4.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isBlockedIpv4Value(embeddedIpv4(groups, 6))
  }
  // 2002::/16 — 6to4: judge the embedded IPv4 address.
  if (g0 === 0x2002) return isBlockedIpv4Value(embeddedIpv4(groups, 1))

  // Only global unicast (2000::/3) is public. This rejects ::/8 remnants,
  // 64:ff9b:1::/48, 100::/64 discard, fc00::/7 ULA, fe80::/10 link-local,
  // fec0::/10 site-local and ff00::/8 multicast.
  if ((g0 & 0xe000) !== 0x2000) return true
  // 2001::/23 IETF protocol assignments (Teredo, ORCHID, benchmarking…).
  if (g0 === 0x2001 && g1 < 0x0200) return true
  // 2001:db8::/32 documentation.
  if (g0 === 0x2001 && g1 === 0x0db8) return true
  return false
}

/** True when `address` is an IP literal (IPv4 or IPv6, brackets allowed). */
export function isIpLiteral(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, '')
  return parseIpv4(bare) !== null || parseIpv6(bare) !== null
}

/**
 * True for any IP address that is not public unicast. Unparseable input and
 * scoped IPv6 (`fe80::1%eth0`) are treated as blocked.
 */
export function isBlockedIpAddress(address: string): boolean {
  const bare = address.trim().replace(/^\[|\]$/g, '').toLowerCase()
  if (bare.includes('%')) return true
  const v4 = parseIpv4(bare)
  if (v4 !== null) return isBlockedIpv4Value(v4)
  const v6 = parseIpv6(bare)
  if (v6 !== null) return isBlockedIpv6Groups(v6)
  return true
}

/**
 * Hostname check (as `URL.hostname` reports it: lower-case, IPv6 in
 * brackets). IP literals are judged by address; names must have at least two
 * labels and no special-use suffix.
 */
export function isBlockedWebhookHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.+$/, '')
  if (!host) return true
  if (host.startsWith('[') || host.includes(':')) return isBlockedIpAddress(host)
  if (/^[\d.]+$/.test(host)) {
    // All-numeric hosts that are not a dotted quad are not routable names.
    return parseIpv4(host) === null ? true : isBlockedIpAddress(host)
  }
  const labels = host.split('.')
  if (labels.length < 2 || labels.some((label) => label === '')) return true
  for (const suffix of BLOCKED_NAME_SUFFIXES) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return true
  }
  return false
}

export interface WebhookUrlGuardOptions {
  /**
   * Skip the private-destination checks (protocol is still enforced). Only
   * set from `WEBHOOK_ALLOW_PRIVATE=true`, for local development against a
   * listener on localhost or an in-network consumer a self-hoster trusts.
   */
  allowPrivate?: boolean
}

/** Synchronous URL check used at registration and before each delivery. */
export function isBlockedWebhookUrl(url: string, options: WebhookUrlGuardOptions = {}): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return true
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return true
  // Credentials in the URL would be sent to whoever answers; never needed.
  if (parsed.username || parsed.password) return true
  if (options.allowPrivate) return false
  return isBlockedWebhookHostname(parsed.hostname)
}

/** Reads the explicit opt-in; applies in every NODE_ENV. */
export function webhookPrivateTargetsAllowed(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.WEBHOOK_ALLOW_PRIVATE?.trim() === 'true'
}
