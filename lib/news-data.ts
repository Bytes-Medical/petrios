/**
 * Curated announcements for the public /news page, newest first. Edit this
 * file to publish — entries are versioned with the code and the newest one
 * is surfaced as the announcement strip on the landing page.
 */

export interface NewsEntry {
  slug: string
  /** ISO date (YYYY-MM-DD) the announcement was published. */
  date: string
  /** Short category chip, e.g. 'Conference', 'Release', 'Community'. */
  tag: string
  title: string
  /** Paragraphs of body text. */
  body: string[]
  link?: { label: string; href: string }
}

export const NEWS: NewsEntry[] = [
  {
    slug: 'petrios-rebrand',
    date: '2026-07-12',
    tag: 'Announcement',
    title: 'Byte Teaching is now Petrios',
    body: [
      'Same platform, same mission, new name. Byte Teaching is now Petrios — a name we can build a distinctive, lasting open-source project around.',
      'Everything carries over: your data, your sign-ins, and the full feature set, now under the Petrios family names (Petrios Meet, Petrios Ops, Petrios Recall). For API integrators: new tokens use the pt_ prefix and webhook signatures moved to the X-Petrios-Signature header — recreate tokens and update header checks when you upgrade.',
    ],
  },
  {
    slug: 'chess-2026',
    date: '2026-07-12',
    tag: 'Conference',
    title: 'Petrios heads to CHESS 2026',
    body: [
      'Our abstract has been accepted for poster presentation at the CHESS Conference — Future Ready: Today for Tomorrow — which brings together educators from across children’s healthcare, education, and industry to share learning and showcase innovation.',
      'The conference takes place on Friday 11 September 2026 in Sheffield. If you’re attending, come and find the poster — we’d love to talk about evidence-based teaching operations, open-source infrastructure in the NHS, and where the platform goes next.',
    ],
  },
  {
    slug: 'platform-layer',
    date: '2026-07-11',
    tag: 'Release',
    title: 'Platform update: public API, webhooks, and portable teaching records',
    body: [
      'Petrios is now API-first: an org-scoped REST API with scoped tokens and an OpenAPI schema, HMAC-signed webhooks for session, attendance, certificate, and slot events, and full self-hosting support — Docker image, SMTP transport, a plain-Postgres migration runner, and an OpenAI-compatible endpoint override so AI can run in-network.',
      'Instances also gained a federation identity: members can export signed, portable teaching records that any other instance — or anyone at all — can verify. A trainee’s teaching history now survives rotating between trusts.',
    ],
    link: { label: 'Read the API docs', href: 'https://github.com/Bytes-Medical/petrios/blob/main/docs/api.md' },
  },
  {
    slug: 'open-source',
    date: '2026-07-10',
    tag: 'Community',
    title: 'Petrios is now open source',
    body: [
      'The full platform is on GitHub under AGPL-3.0: scheduling, evidence-based attendance, built-in video, configurable identified feedback, certificates, portfolio evidence, and the approval-gated AI ops layer — all of it readable, auditable, and self-hostable.',
      'Star the repo, read the roadmap, open an issue, or pick up a contribution — the spec/ folder documents how every subsystem works so you can be productive on day one.',
    ],
    link: { label: 'View on GitHub', href: 'https://github.com/Bytes-Medical/petrios' },
  },
]
