import Link from 'next/link'
import { DisplayControl } from '@/components/hud/DisplayControl'
import { SpecStrip } from '@/components/hud/Readout'
import s from '@/components/hud/hud.module.css'
import type { Display } from '@/lib/public-display'
import { GITHUB_URL } from '@/lib/site'

const EXTERNAL_ARROW = <span aria-hidden="true">{' ↗'}</span>

const PROJECT_LINKS = [
  { href: GITHUB_URL, label: 'GitHub', external: true },
  { href: '/features', label: 'Features', external: false },
  { href: '/news', label: 'News', external: false },
  { href: '/open-source', label: 'Open source', external: false },
  { href: '/contributors', label: 'Contributors', external: false },
  { href: `${GITHUB_URL}/blob/main/ROADMAP.md`, label: 'Roadmap', external: true },
  { href: `${GITHUB_URL}/blob/main/docs/api.md`, label: 'API', external: true },
] as const

// All four stay present on every public page (spec/13).
const LEGAL_LINKS = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/privacy/choices', label: 'Your privacy choices' },
  { href: '/subprocessors', label: 'Subprocessors' },
  { href: '/data-processing-agreement', label: 'DPA' },
] as const

/**
 * Public-site footer, rendered by HudShell with the server-read Display
 * mode. Deliberately not a <nav>: the public nav is the only navigation
 * landmark containing "Features".
 */
export function Footer({ display = 'day' }: { display?: Display }) {
  const year = new Date().getFullYear()
  return (
    <footer className={s.footer}>
      <div className={s.footerInner}>
        <div className={s.footerMain}>
          <p className={s.owner}>{`© ${year} Petrios, owned by We Health`}</p>
          <p className={s.footerTagline}>Open source. Self-hostable. Yours.</p>
          <div className={s.linkGroups}>
            <div className={s.linkGroup}>
              <p id="footer-project" className={s.caption}>
                Project
              </p>
              <ul aria-labelledby="footer-project" className={s.footerLinks}>
                {PROJECT_LINKS.map((link) => (
                  <li key={link.label}>
                    {link.external ? (
                      <a href={link.href}>
                        {link.label}
                        {EXTERNAL_ARROW}
                      </a>
                    ) : (
                      <Link href={link.href}>{link.label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <div className={s.linkGroup}>
              <p id="footer-legal" className={s.caption}>
                Legal
              </p>
              <ul aria-labelledby="footer-legal" className={s.footerLinks}>
                {LEGAL_LINKS.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <SpecStrip
          framed
          className={s.footerLicences}
          items={[
            {
              label: 'Code licence',
              value: (
                <a href="https://www.gnu.org/licenses/agpl-3.0.en.html">
                  AGPL-3.0{EXTERNAL_ARROW}
                </a>
              ),
              source: 'LICENSE; package.json "license": "AGPL-3.0-or-later"',
            },
            {
              label: 'Docs and specifications',
              value: (
                <a href="https://creativecommons.org/licenses/by-sa/4.0/">
                  CC-BY-SA 4.0{EXTERNAL_ARROW}
                </a>
              ),
              source: 'README licence section (docs and spec/ under CC-BY-SA 4.0)',
            },
          ]}
        />
        <DisplayControl display={display} className={s.footerDisplay} />
      </div>
    </footer>
  )
}
