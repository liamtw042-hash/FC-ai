import type { ReactNode } from 'react'
import Link from 'next/link'
import './globals.css'
import { unverified } from './lib/server'

export const metadata = {
  title: 'FC-ai',
  description: 'A local SBC solver. It never talks to EA.',
}

// `typedRoutes` checks these against the real route tree at build time, so a
// page renamed without its link being updated fails the build rather than
// producing a 404 nobody notices.
const PAGES = [
  { href: '/club', label: 'Club' },
  { href: '/intake', label: 'Intake' },
  { href: '/sbc', label: 'SBC library' },
  { href: '/solve', label: 'Queue and solve' },
  { href: '/planner', label: 'Grind planner' },
  { href: '/history', label: 'History' },
  { href: '/fixtures', label: 'Fixtures' },
] as const

export default function RootLayout({ children }: { children: ReactNode }) {
  const live = unverified()
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-neutral-800 px-4 py-3">
          <nav className="flex flex-wrap items-baseline gap-4 text-sm">
            <Link href="/" className="font-bold text-neutral-100">
              FC-ai
            </Link>
            {PAGES.map((page) => (
              <Link key={page.href} href={page.href} className="text-neutral-400 hover:text-neutral-100">
                {page.label}
              </Link>
            ))}
            <span className="ml-auto text-xs text-neutral-600">
              localhost only, never talks to EA
            </span>
          </nav>
        </header>

        {live.length > 0 ? (
          // On every page, not tucked into an about box. Tests prove the code
          // matches the spec; they do not prove the spec matches the game.
          <div className="border-b border-amber-900 bg-amber-950/40 px-4 py-2 text-xs text-amber-200">
            <strong>{live.length} game rule value(s) are NOT verified against the game.</strong>{' '}
            Solutions relying on them may be wrong in ways the tests cannot catch:{' '}
            {live.map((item) => item.what).join('; ')}. See PENDING.md.
          </div>
        ) : null}

        <main className="p-4">{children}</main>
      </body>
    </html>
  )
}
