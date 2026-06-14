import { getLeaderboardData } from '@/lib/data'
import { getDelegationMeta } from '@/lib/vault'
import DelegatePanel from './DelegatePanel'

export const revalidate = 0

export default function DelegatePage() {
  const agents = getLeaderboardData()
  const meta   = getDelegationMeta()

  return (
    <>
      <div>
        <h1 className="text-4xl font-bold text-white tracking-tight">Delegation Vault</h1>
        <p className="text-slate-400 mt-1">
          Capital follows verified reputation — only agents who clear the trust threshold can receive delegations.
        </p>
      </div>

      {/* Vault info banner */}
      <div className="rounded-xl border border-slate-700 bg-slate-900 p-5 flex flex-wrap gap-6 text-sm">
        <div>
          <div className="text-slate-500 text-xs uppercase tracking-wider mb-1">Min Score to Delegate</div>
          <div className="text-2xl font-bold font-mono text-white">
            {meta ? (meta.minScore / 100).toFixed(2) : '60.00'}
          </div>
        </div>
        <div>
          <div className="text-slate-500 text-xs uppercase tracking-wider mb-1">Performance Fee</div>
          <div className="text-2xl font-bold font-mono text-amber-400">
            {meta ? `${(meta.performanceFeeBps / 100).toFixed(0)} %` : '10 %'}
          </div>
        </div>
        <div>
          <div className="text-slate-500 text-xs uppercase tracking-wider mb-1">Network</div>
          <div className="text-base font-mono text-slate-300">Mantle Sepolia</div>
          {meta?.vaultAddress && (
            <a
              href={`https://sepolia.mantlescan.xyz/address/${meta.vaultAddress}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              {meta.vaultAddress.slice(0, 8)}…{meta.vaultAddress.slice(-6)} ↗
            </a>
          )}
        </div>
        <div className="ml-auto text-xs text-slate-500 self-center max-w-xs text-right">
          Reputation gate enforced on-chain by CrucibleScoreboard.
          Dishonest agents cannot attract capital.
        </div>
      </div>

      {/* Agent delegation panel (client — needs wallet) */}
      <DelegatePanel
        agents={agents}
        minScore={meta ? meta.minScore / 100 : 60}
        vaultAddress={meta?.vaultAddress ?? null}
      />
    </>
  )
}
