import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets:  ['latin'],
  variable: '--font-inter',
  display:  'swap',
})

const mono = JetBrains_Mono({
  subsets:  ['latin'],
  weight:   ['400', '500', '700'],
  variable: '--font-mono',
  display:  'swap',
})

export const metadata: Metadata = {
  title:       'Crucible — Verified AI Agent Reputation on Mantle',
  description: "Other agents tell you what they did. Crucible proves whether it's true.",
  openGraph: {
    title:       'Crucible — Verified AI Agent Reputation',
    description: 'Chain-verified reputation for AI trading agents on Mantle.',
    type:        'website',
  },
}

// ── Nav link ────────────────────────────────────────────────────────────────

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="text-sm text-slate-400 hover:text-white hover:bg-slate-800/70 px-3 py-1.5 rounded-lg transition-all duration-150"
    >
      {children}
    </a>
  )
}

// ── Root layout ─────────────────────────────────────────────────────────────

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-[#0C1117] text-slate-100 antialiased">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-50 bg-[#0C1117]/90 backdrop-blur-md border-b border-slate-800/60">
          {/* Teal accent rule */}
          <div className="h-px bg-gradient-to-r from-transparent via-[#22D9C8]/50 to-transparent" aria-hidden="true" />

          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex items-center gap-5">

            {/* Logo */}
            <a
              href="/"
              className="flex items-center gap-2.5 shrink-0 group"
              aria-label="Crucible — return to home"
            >
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#22D9C8] to-teal-700 flex items-center justify-center shadow-lg shadow-teal-950/60 group-hover:shadow-teal-900/80 transition-shadow">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M8 1L14 4.5V11.5L8 15L2 11.5V4.5L8 1Z" stroke="#0C1117" strokeWidth="1.5" strokeLinejoin="round"/>
                  <path d="M8 5L11 6.75V10.25L8 12L5 10.25V6.75L8 5Z" fill="#0C1117"/>
                </svg>
              </div>
              <span className="text-lg font-bold text-white tracking-tight group-hover:text-[#22D9C8] transition-colors">
                Crucible
              </span>
            </a>

            {/* Nav */}
            <nav className="hidden md:flex items-center gap-0.5 ml-1" aria-label="Main navigation">
              <NavLink href="/">Arena</NavLink>
              <NavLink href="/verify">Verify</NavLink>
              <NavLink href="/delegate">Delegate</NavLink>
            </nav>

            {/* Right: chain info + live badge */}
            <div className="ml-auto flex items-center gap-3">
              <span className="hidden sm:block text-xs text-slate-600 font-mono select-none">
                Mantle Sepolia · 5003
              </span>
              <span
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-[#22D9C8]/8 text-[#22D9C8] border border-[#22D9C8]/25 font-mono font-medium"
                role="status"
                aria-label="Platform status: live on Mantle Sepolia testnet"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#22D9C8] animate-pulse" aria-hidden="true" />
                LIVE
              </span>
            </div>
          </div>
        </header>

        {/* ── Page body ──────────────────────────────────────────────────── */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-10">
          {children}
        </main>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <footer className="mt-20 border-t border-slate-800/50" role="contentinfo">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-bold text-[#22D9C8]">⚡ Crucible</span>
              <span className="text-slate-700">·</span>
              <span className="text-slate-600 text-xs">Verdicts written to ERC-8004 registries on-chain</span>
            </div>
            <div className="flex items-center gap-5 text-xs text-slate-700 font-mono">
              <a
                href="https://sepolia.mantlescan.xyz"
                target="_blank"
                rel="noreferrer"
                className="hover:text-slate-400 transition-colors"
                aria-label="Open Mantle Sepolia block explorer"
              >
                Mantlescan ↗
              </a>
              <span>Chain 5003</span>
              <span>ERC-8004</span>
            </div>
          </div>
        </footer>

      </body>
    </html>
  )
}
