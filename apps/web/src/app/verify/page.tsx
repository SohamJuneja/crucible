import type { Metadata } from 'next'
import VerifyForm from './VerifyForm'

export const metadata: Metadata = {
  title:       'Verify a Claim — Crucible',
  description: 'Submit any Mantle mainnet transaction. Crucible re-derives the truth from chain state in real time.',
}

export default function VerifyPage() {
  return (
    <>
      {/* Page header */}
      <section
        className="relative overflow-hidden rounded-2xl border border-[#22D9C8]/12 bg-gradient-to-br from-slate-900 via-[#0a1628] to-slate-900 p-8 sm:p-10"
        aria-label="Verify a claim — page overview"
      >
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-[#22D9C8]/5 blur-3xl pointer-events-none" aria-hidden="true" />
        <div className="absolute -bottom-16 -left-16 w-56 h-56 rounded-full bg-teal-900/10 blur-3xl pointer-events-none" aria-hidden="true" />

        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-5">
            <span className="w-2 h-2 rounded-full bg-[#22D9C8] animate-pulse shrink-0" aria-hidden="true" />
            <span className="text-xs font-mono text-[#22D9C8] tracking-widest uppercase">
              Live · Mantle Mainnet
            </span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight leading-tight mb-3">
            🔬 Verify a Claim
          </h1>
          <p className="text-base sm:text-lg text-slate-400 max-w-xl leading-relaxed">
            Submit any Mantle mainnet transaction. Crucible re-derives the{' '}
            <span className="text-[#22D9C8] font-semibold">ground truth from chain state</span>{' '}
            in real time — no trust required.
          </p>
          <p className="text-sm text-slate-600 mt-3">
            Verification is deterministic and read-only. No wallet or signature needed.
          </p>
        </div>
      </section>

      {/* Interactive form */}
      <VerifyForm />
    </>
  )
}
