import { clsx } from 'clsx'
import { HealthCheck } from '@/components/hud/HealthCheck'
import { HudShell } from '@/components/hud/HudShell'
import { HudLink } from '@/components/hud/HudLink'
import { PageHeader } from '@/components/hud/PageHeader'
import { Panel, PanelTitle } from '@/components/hud/Panel'
import { SpecStrip, type SpecItem } from '@/components/hud/Readout'
import { TerminalBlock, type TerminalLine } from '@/components/hud/TerminalBlock'
import s from '@/components/hud/hud.module.css'
import { GITHUB_URL } from '@/lib/site'

export const metadata = {
  title: 'Open source',
  description:
    'Petrios is an AGPL-licensed, self-hostable teaching platform with an org-scoped REST API, signed webhooks, and portable teaching records. Run it on your own servers.',
  alternates: { canonical: '/open-source' },
}

// Mirrors the docs/self-hosting.md quickstart; keep the two in step.
const QUICK_START: TerminalLine[] = [
  { command: `git clone ${GITHUB_URL}.git` },
  { command: `cd ${GITHUB_URL.split('/').pop()}` },
  { command: 'cp .env.example .env.production', comment: 'your DB, SMTP, domains' },
  { command: 'docker compose --env-file .env.production up -d --build' },
  { command: 'npm run db:migrate', comment: 'needs DATABASE_URL; plain-Postgres migration runner' },
  { command: 'curl http://localhost:3000/api/health', comment: '{"status":"ok","db":"ok"}' },
]

const INTEGRATE_SPEC: SpecItem[] = [
  { label: 'API tokens', value: 'pt_ prefix, hashed at rest', source: 'lib/api/auth.ts (pt_ tokens, sha256 stored); spec/09' },
  { label: 'Webhook signature', value: 'X-Petrios-Signature (HMAC)', source: 'lib/webhooks.ts signWebhookBody' },
  { label: 'Schema', value: 'OpenAPI', source: 'public/openapi.json' },
]

const FEDERATION_SPEC: SpecItem[] = [
  { label: 'Record signing', value: 'Ed25519, when configured', source: 'lib/federation.ts (needs INSTANCE_SIGNING_KEY)' },
  { label: 'Public key', value: '/.well-known/petrios', source: 'app/.well-known/petrios' },
  {
    label: 'Verifier',
    value: <HudLink href="/verify/record">/verify/record</HudLink>,
    source: 'app/verify/record',
  },
]

export default function OpenSourcePage() {
  return (
    <HudShell current="open-source">
      <PageHeader
        title={
          <>
            <span className="whitespace-nowrap">Your servers.</span>{' '}
            <span className="whitespace-nowrap">Your data.</span>{' '}
            <span className="whitespace-nowrap">Your platform.</span>
          </>
        }
        lede="Petrios is free software: AGPL-3.0 for the code, CC-BY-SA 4.0 for the docs and specifications. No procurement cycle, no per-seat licence, no lock-in — clone it, deploy it inside your trust, and keep all of your data where you can see it."
      />

      <Panel aria-labelledby="self-hosting-title">
        <PanelTitle id="self-hosting-title" label="Self-hosting">
          Self-host every core service
        </PanelTitle>
        <p className={clsx(s.body, 'mt-3')}>
          Every core dependency has a self-hosted seat: your Postgres (via Supabase&apos;s self-host
          stack), your SMTP relay, your Jitsi server for video. The AI layer runs on Anthropic Claude by
          default or any OpenAI-compatible endpoint, so text features can run against an in-network
          model, or AI can be switched off entirely. Audio Recap, and so Recall catch-up, is the
          exception: it needs a provider that accepts document file inputs and runs hosted web search
          against public sites, and ElevenLabs speech is always an external service.
        </p>
        <TerminalBlock lines={QUICK_START} className="mt-5" />
        <HealthCheck />
        <p className={clsx(s.body, 'mt-4')}>
          <HudLink href={`${GITHUB_URL}/blob/main/docs/self-hosting.md`}>Read the self-hosting guide</HudLink>
        </p>
      </Panel>

      <Panel aria-labelledby="integrate-title" footer={<SpecStrip items={INTEGRATE_SPEC} />}>
        <PanelTitle id="integrate-title" label="Integrate">
          An API and webhooks, not an island
        </PanelTitle>
        <p className={clsx(s.body, 'mt-3')}>
          Wire Petrios into rota systems, data warehouses, or your own frontends: an org-scoped REST API with
          scoped bearer tokens (OpenAPI schema included), plus HMAC-signed webhooks for session publishes,
          computed attendance, issued certificates, and claimed slots.
        </p>
        <ul className={clsx(s.bullets, 'mt-4')}>
          <li>Tokens created in Settings, hashed at rest, revocable, per-scope</li>
          <li>
            <code className={s.code}>X-Petrios-Signature</code> on every webhook delivery
          </li>
          <li>iCalendar feeds and CSV exports for everything tabular</li>
        </ul>
        <p className={clsx(s.body, 'mt-4')}>
          <HudLink href={`${GITHUB_URL}/blob/main/docs/api.md`}>API documentation</HudLink>
        </p>
      </Panel>

      <Panel aria-labelledby="federation-title" footer={<SpecStrip items={FEDERATION_SPEC} />}>
        <PanelTitle id="federation-title" label="Federation">
          Records that survive rotation
        </PanelTitle>
        <p className={clsx(s.body, 'mt-3')}>
          Trainees rotate; their teaching history shouldn&apos;t evaporate. Every instance can sign portable
          teaching records that any other instance — or anyone at all — can verify against the issuer&apos;s
          published key. Independent deployments become a network, not silos.
        </p>
        <p className={clsx(s.body, 'mt-4')}>
          <HudLink href="/verify/record">Try the record verifier</HudLink>
        </p>
      </Panel>

      <Panel aria-labelledby="governance-title">
        <PanelTitle id="governance-title" label="Trust & governance">
          Built for the paperwork too
        </PanelTitle>
        <ul className={clsx(s.bullets, 'mt-3')}>
          <li>Row-level security everywhere; sensitive tables deny-all behind an audited service layer</li>
          <li>
            CI security gates on every PR: CodeQL, Semgrep, secret scanning, dependency audit, an RLS guard
          </li>
          <li>
            AI that drafts but never sends; the Ops audit keeps prompt hashes, not prompt text;{' '}
            <code className={s.code}>OPS_ENABLED=false</code> switches off the agent layer, and unsetting the
            AI and speech provider keys turns all AI off
          </li>
          <li>
            DTAC self-assessment starter and DPIA template in{' '}
            <HudLink href={`${GITHUB_URL}/tree/main/docs/compliance`}>docs/compliance</HudLink>
          </li>
        </ul>
      </Panel>

      <Panel rule="none" aria-labelledby="get-involved-title" className={s.ctaPanel}>
        <h2 id="get-involved-title" className={s.sectionTitle}>
          Get involved
        </h2>
        <p className={s.sectionLede}>
          Star the repo, open an issue, pick something off the roadmap — or just tell us what your programme
          needs.
        </p>
        <div className={clsx(s.ctaRow, 'mt-5')}>
          <HudLink href={GITHUB_URL} variant="ink">
            Star on GitHub
          </HudLink>
          <HudLink href={`${GITHUB_URL}/blob/main/ROADMAP.md`} variant="secondary">
            Roadmap
          </HudLink>
          <HudLink href="/contributors" variant="secondary">
            Contributors
          </HudLink>
        </div>
      </Panel>
    </HudShell>
  )
}
