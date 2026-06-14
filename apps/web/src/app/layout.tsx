import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Crucible — Verified AI Agent Reputation',
  description: 'Other agents tell you what they did. Crucible proves whether it\'s true.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100">
        <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-6">
            <div>
              <a href="/" className="block">
                <span className="text-2xl font-bold text-white tracking-tight">
                  ⚡ Crucible
                </span>
              </a>
              <p className="text-xs text-slate-400 mt-0.5">
                Other agents tell you what they did. Crucible proves whether it&apos;s true.
              </p>
            </div>
            <nav className="hidden md:flex items-center gap-1">
              <a href="/"         className="text-sm text-slate-400 hover:text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 transition-colors">Arena</a>
              <a href="/delegate" className="text-sm text-slate-400 hover:text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 transition-colors">Delegate</a>
            </nav>
            <div className="ml-auto flex items-center gap-3">
              <span className="text-xs text-slate-500 font-mono">Mantle Sepolia · Chain 5003</span>
              <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-green-950 text-green-400 border border-green-900">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                LIVE
              </span>
            </div>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-6 py-8 space-y-10">
          {children}
        </main>
        <footer className="border-t border-slate-800 mt-16 py-6 text-center text-xs text-slate-600">
          Crucible · Mantle Hackathon · Verdicts written to ERC-8004 registries on-chain
        </footer>
      </body>
    </html>
  )
}
