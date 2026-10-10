import { describe, expect, it } from 'vitest'
import {
  isBlockedIpAddress,
  isBlockedWebhookHostname,
  isBlockedWebhookUrl,
  isIpLiteral,
  webhookPrivateTargetsAllowed,
} from './webhook-guard'

describe('isBlockedIpAddress', () => {
  it.each([
    '0.0.0.0',
    '0.1.2.3',
    '10.0.0.1',
    '100.64.0.1',
    '100.100.100.200', // Alibaba metadata (CGNAT)
    '127.0.0.1',
    '127.255.255.254',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.1',
    '192.0.2.10',
    '192.168.1.1',
    '198.18.0.1',
    '198.19.255.255',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
  ])('blocks IPv4 %s', (address) => {
    expect(isBlockedIpAddress(address)).toBe(true)
  })

  it.each(['8.8.8.8', '1.1.1.1', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '93.184.215.14'])(
    'allows public IPv4 %s',
    (address) => {
      expect(isBlockedIpAddress(address)).toBe(false)
    }
  )

  it.each([
    '::',
    '::1',
    '[::1]',
    '::ffff:7f00:1', // 127.0.0.1 mapped
    '::ffff:127.0.0.1',
    '::ffff:a9fe:a9fe', // 169.254.169.254 mapped
    '::ffff:10.0.0.1',
    '::127.0.0.1', // deprecated IPv4-compatible
    '64:ff9b::7f00:1', // NAT64 of 127.0.0.1
    '64:ff9b:1::1',
    '2002:7f00:1::1', // 6to4 of 127.0.0.1
    '2002:c0a8:101::1', // 6to4 of 192.168.1.1
    'fc00::1',
    'fd12:3456:789a::1',
    'fe80::1',
    'fe80::1%eth0',
    'febf::1',
    'fec0::1',
    'ff02::1',
    '100::1',
    '2001:db8::1',
    '2001::1', // Teredo
    'not-an-ip',
    '',
  ])('blocks IPv6 / invalid %s', (address) => {
    expect(isBlockedIpAddress(address)).toBe(true)
  })

  it.each([
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
    '[2a00:1450:4009:81f::200e]',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808', // NAT64 of 8.8.8.8 (DNS64 hosts)
    '2002:808:808::1',
  ])('allows public IPv6 %s', (address) => {
    expect(isBlockedIpAddress(address)).toBe(false)
  })
})

describe('isIpLiteral', () => {
  it('recognises IPv4 and bracketed IPv6', () => {
    expect(isIpLiteral('127.0.0.1')).toBe(true)
    expect(isIpLiteral('[::1]')).toBe(true)
    expect(isIpLiteral('hooks.example.org')).toBe(false)
  })
})

describe('isBlockedWebhookHostname', () => {
  it.each([
    'localhost',
    'localhost.',
    'api.localhost',
    'printer.local',
    'metadata.google.internal',
    'router.home.arpa',
    'nas.lan',
    'db', // self-host compose service names
    'auth',
    'rest',
    'storage',
    'gateway',
    'app',
    'hooks.example',
    'thing.test',
    '',
    '.',
    'a..b',
    '[::1]',
    '[::ffff:7f00:1]',
    '127.0.0.1',
    '0.0.0.0',
    '1.2.3',
  ])('blocks %s', (host) => {
    expect(isBlockedWebhookHostname(host)).toBe(true)
  })

  it.each(['hooks.example.org', 'api.partner.nhs.uk', 'example.com.', '8.8.8.8', '[2606:4700:4700::1111]'])(
    'allows %s',
    (host) => {
      expect(isBlockedWebhookHostname(host)).toBe(false)
    }
  )
})

describe('isBlockedWebhookUrl', () => {
  it.each([
    'ftp://hooks.example.org/x',
    'file:///etc/passwd',
    'not a url',
    'http://localhost:3000/hook',
    'http://[::1]/',
    'http://[::ffff:7f00:1]/',
    'http://[::ffff:a9fe:a9fe]/latest/meta-data',
    'http://[fc00::1]/',
    'http://[fe80::1]/',
    'http://[::]/',
    'http://0/', // WHATWG → 0.0.0.0
    'http://0x7f.1/', // WHATWG → 127.0.0.1
    'http://2130706433/', // WHATWG → 127.0.0.1
    'http://017700000001/', // octal → 127.0.0.1
    'http://100.100.100.200/',
    'http://198.18.0.1/',
    'http://rest:3000/rest/v1/',
    'http://auth:9999/',
    'http://storage:5000/',
    'http://gateway:8000/',
    'http://db:5432/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://localhost./',
    'https://user:pass@hooks.example.org/',
  ])('blocks %s in every environment', (url) => {
    expect(isBlockedWebhookUrl(url)).toBe(true)
  })

  it('allows a public https URL', () => {
    expect(isBlockedWebhookUrl('https://hooks.example.org/petrios')).toBe(false)
    expect(isBlockedWebhookUrl('http://8.8.8.8:8080/hook')).toBe(false)
  })

  it('lets the explicit opt-in reach private listeners, but never a non-http scheme', () => {
    expect(isBlockedWebhookUrl('http://localhost:4000/hook', { allowPrivate: true })).toBe(false)
    expect(isBlockedWebhookUrl('http://rest:3000/', { allowPrivate: true })).toBe(false)
    expect(isBlockedWebhookUrl('file:///etc/passwd', { allowPrivate: true })).toBe(true)
  })
})

describe('webhookPrivateTargetsAllowed', () => {
  it('is only on for exactly "true"', () => {
    expect(webhookPrivateTargetsAllowed({})).toBe(false)
    expect(webhookPrivateTargetsAllowed({ WEBHOOK_ALLOW_PRIVATE: 'false' })).toBe(false)
    expect(webhookPrivateTargetsAllowed({ WEBHOOK_ALLOW_PRIVATE: '1' })).toBe(false)
    expect(webhookPrivateTargetsAllowed({ WEBHOOK_ALLOW_PRIVATE: 'true' })).toBe(true)
    // NODE_ENV no longer matters.
    expect(webhookPrivateTargetsAllowed({ NODE_ENV: 'development' })).toBe(false)
  })
})
