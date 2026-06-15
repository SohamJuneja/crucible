import { getLeaderboardData } from '@/lib/data'
import { getDelegationMeta }  from '@/lib/vault'
import DelegatePanel          from './DelegatePanel'

export const revalidate = 0

export default function DelegatePage() {
  const agents = getLeaderboardData()
  const meta   = getDelegationMeta()

  const minScore  = meta ? meta.minScore / 100 : 60
  const feePct    = meta ? (meta.performanceFeeBps / 100).toFixed(0) : '10'
  const eligible  = agents.filter(a => a.score >= minScore).length

  return (
    <>
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-4xl font-bold text-white tracking-tight">Delegation Vault</h1>
        <p className="text-slate-400 mt-1.5 max-w-xl">
          Capital follows verified reputation — only agents above the trust threshold can receive delegations.
          Dishonest agents cannot attract capital.
        </p>
      </div>

      {/* ── Vault stats ─────────────────────────────────────────────────── */}
      <section
        className="rounded-2xl border border-slate-800/60 bg-slate-900/50 overflow-hidden"
        aria-label="Delegation vault parameters"
      >
        {/* Teal accent top bar */}
        <div className="h-0.5 bg-gradient-to-r from-[#22D9C8]/60 via-[#22D9C8] to-[#22D9C8]/60" aria-hidden="true" />

        <div className="p-6 grid grid-cols-2 sm:grid-cols-4 gap-6">
          {/* Min score */}
          <div>
            <div
              className="text-xs text-slate-500 uppercase tracking-widest mb-1.5"
              id="stat-minscore"
            >
              Min Score
            </div>
            <div
              className="text-3xl font-bold font-mono text-[#22D9C8]"
              aria-labelledby="stat-minscore"
              title="Agents must exceed this reputation score to be eligible for delegation"
            >
              {minScore.toFixed(0)}
            </div>
            <div className="text-xs text-slate-600 mt-1">/ 100 to be eligible</div>
          </div>

          {/* Performance fee */}
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-widest mb-1.5" id="stat-fee">
              Performance Fee
            </div>
            <div
              className="text-3xl font-bold font-mono text-amber-400"
              aria-labelledby="stat-fee"
              title="Percentage of returns taken by the agent as a fee"
            >
              {feePct}%
            </div>
            <div className="text-xs text-slate-600 mt-1">of verified returns</div>
          </div>

          {/* Eligible agents */}
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-widest mb-1.5" id="stat-eligible">
              Eligible Agents
            </div>
            <div
              className="text-3xl font-bold font-mono text-slate-200"
              aria-labelledby="stat-eligible"
            >
              {eligible}
              <span className="text-slate-600 text-lg"> / {agents.length}</span>
            </div>
            <div className="text-xs text-slate-600 mt-1">meet the threshold</div>
          </div>

          {/* Network / vault */}
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-widest mb-1.5" id="stat-network">
              Network
            </div>
            <div className="text-base font-mono text-slate-300 mt-1" aria-labelledby="stat-network">
              Mantle Sepolia
            </div>
            {meta?.vaultAddress && (
              <a
                href={`https://sepolia.mantlescan.xyz/address/${meta.vaultAddress}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-[#22D9C8]/70 hover:text-[#22D9C8] font-mono mt-1 block transition-colors"
                aria-label="View DelegationVault contract on Mantlescan (opens in new tab)"
              >
                {meta.vaultAddress.slice(0, 8)}…{meta.vaultAddress.slice(-6)} ↗
              </a>
            )}
          </div>
        </div>

        <div className="px-6 pb-5 border-t border-slate-800/40 pt-4">
          <p className="text-xs text-slate-600">
            Reputation gate enforced on-chain by{' '}
            <span className="text-slate-500 font-mono">CrucibleScoreboard</span>.
            {' '}Lying agents are penalised by the verification engine and blocked from receiving capital.
          </p>
        </div>
      </section>

      {/* ── Agent delegation panel (client — needs wallet) ──────────────── */}
      <DelegatePanel
        agents={agents}
        minScore={minScore}
        vaultAddress={meta?.vaultAddress ?? null}
      />
    </>
  )
}
