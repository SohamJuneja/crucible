import { notFound } from 'next/navigation'
import {
  getAgentData,
  getAgentReceipts,
  getScoreBreakdown,
  ipfsToGateway,
  shortAddr,
  fmtAmount,
  timeAgo,
  type AgentData,
  type ReceiptData,
  type ScoreBreakdown,
} from '@/lib/data'

export const revalidate = 0

// ── Helpers ────────────────────────────────────────────────────────────────────

function VerdictBadge({ verdict, large }: { verdict: string; large?: boolean }) {
  const cfg: Record<string, string> = {
    VERIFIED:     'bg-green-950 text-green-300 border-green-800',
    EXAGGERATED:  'bg-amber-950 text-amber-300 border-amber-800',
    FALSE_CLAIM:  'bg-red-950 text-red-300 border-red-800 font-bold',
    UNVERIFIABLE: 'bg-slate-800 text-slate-400 border-slate-700',
  }
  const icon: Record<string, string> = {
    VERIFIED: '✓', EXAGGERATED: '≈', FALSE_CLAIM: '🚨', UNVERIFIABLE: '?',
  }
  const size = large ? 'text-sm px-3 py-1.5' : 'text-xs px-2 py-0.5'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded border font-mono ${size} ${cfg[verdict] ?? 'bg-slate-800 text-slate-400 border-slate-700'}`}>
      <span>{icon[verdict] ?? '?'}</span>
      <span>{verdict.replace('_', ' ')}</span>
    </span>
  )
}

function scoreColor(s: number) {
  if (s >= 60) return 'text-green-400'
  if (s >= 40) return 'text-amber-400'
  return 'text-red-400'
}

// ── Score bar ──────────────────────────────────────────────────────────────────

function ScoreBar({ label, pts, max, note }: { label: string; pts: number; max: number; note?: string }) {
  const pct   = Math.min(100, (pts / max) * 100)
  const color = pct >= 60 ? 'bg-green-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-slate-300">{label}</span>
        <span className="font-mono text-slate-200">{pts.toFixed(2)} / {max}</span>
      </div>
      <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      {note && <p className="text-xs text-red-400 mt-1">{note}</p>}
    </div>
  )
}

// ── Score breakdown ────────────────────────────────────────────────────────────

function ScoreBreakdownPanel({ bd }: { bd: ScoreBreakdown }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-6 space-y-4">
      <h2 className="text-base font-bold text-white">Score Breakdown</h2>
      <ScoreBar label="Risk-Adj Return (35×)"  pts={bd.riskReturn}   max={35} />
      <ScoreBar label="Win Rate (20×)"         pts={bd.winRate}      max={20} />
      <ScoreBar label="Consistency (15×)"      pts={bd.consistency}  max={15} />
      <ScoreBar
        label="Truthfulness (30×)"
        pts={bd.truthfulness}
        max={30}
        note={bd.hasFalse
          ? `⚠ FALSE_CLAIM hard cap: ${bd.falseClaimCount} lie${bd.falseClaimCount > 1 ? 's' : ''} → score ceiling = ${bd.cap}`
          : undefined}
      />
      <div className="border-t border-slate-700 pt-3 flex justify-between text-sm font-mono">
        <span className="text-slate-400">
          Weighted sum: {bd.rawTotal.toFixed(2)}
          {bd.hasFalse && <span className="text-red-400"> → capped at {bd.cap}</span>}
        </span>
        <span className={`font-bold text-base ${scoreColor(bd.finalScore)}`}>
          {bd.finalScore.toFixed(2)}
        </span>
      </div>
    </section>
  )
}

// ── Receipt diff row ───────────────────────────────────────────────────────────

function DiffRow({ field, claimed, actual }: { field: string; claimed: string | undefined; actual: string | undefined }) {
  if (!claimed && !actual) return null
  const mismatch = !!(claimed && actual && claimed.toLowerCase() !== actual.toLowerCase())
  return (
    <tr className={mismatch ? 'bg-red-950/30' : ''}>
      <td className="px-3 py-2 text-xs text-slate-400 font-mono whitespace-nowrap">{field}</td>
      <td className={`px-3 py-2 text-xs font-mono ${mismatch ? 'text-red-300' : 'text-slate-200'}`}>{claimed ? shortAddr(claimed) : '—'}</td>
      <td className={`px-3 py-2 text-xs font-mono ${mismatch ? 'text-green-300' : 'text-slate-200'}`}>{actual ? shortAddr(actual) : '—'}</td>
      <td className="px-3 py-2 text-xs">
        {mismatch
          ? <span className="text-red-400 font-bold text-sm">❌ MISMATCH</span>
          : <span className="text-green-400">✓</span>
        }
      </td>
    </tr>
  )
}

// ── Receipt card ───────────────────────────────────────────────────────────────

function ReceiptCard({ r }: { r: ReceiptData }) {
  const gatewayUrl = ipfsToGateway(r.evidenceUri)
  const frameCls = r.verdict === 'FALSE_CLAIM'
    ? 'border-red-800 bg-red-950/20'
    : r.verdict === 'EXAGGERATED'
    ? 'border-amber-800 bg-amber-950/10'
    : 'border-slate-700 bg-slate-900'

  return (
    <div className={`rounded-xl border p-5 space-y-4 ${frameCls}`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1.5">
          <VerdictBadge verdict={r.verdict} large />
          <div className="text-xs text-slate-500 font-mono">
            {new Date(r.timestamp).toLocaleString()} · {timeAgo(r.createdAt)}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`https://sepolia.mantlescan.xyz/tx/${r.txHash}`} target="_blank" rel="noreferrer"
            className="text-xs px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-blue-400 hover:text-blue-300 font-mono">
            swap tx ↗
          </a>
          {r.validationTxHash && (
            <a href={`https://sepolia.mantlescan.xyz/tx/${r.validationTxHash}`} target="_blank" rel="noreferrer"
              className="text-xs px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-blue-400 hover:text-blue-300 font-mono">
              verdict tx ↗
            </a>
          )}
          {gatewayUrl && (
            <a href={gatewayUrl} target="_blank" rel="noreferrer"
              className="text-xs px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-purple-400 hover:text-purple-300 font-mono">
              evidence (IPFS) ↗
            </a>
          )}
        </div>
      </div>

      {/* Truth score bar */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-400 shrink-0 w-24">Truth score</span>
        <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${r.truthScore >= 0.9 ? 'bg-green-500' : r.truthScore >= 0.5 ? 'bg-amber-500' : 'bg-red-500'}`}
            style={{ width: `${r.truthScore * 100}%` }}
          />
        </div>
        <span className="text-xs font-mono text-slate-300 w-10 text-right">{(r.truthScore * 100).toFixed(0)}%</span>
      </div>

      {/* Claimed vs actual diff */}
      <div>
        <p className="text-xs text-slate-500 mb-2 uppercase tracking-wider font-semibold">Claimed vs Chain-Derived</p>
        <div className="rounded-lg overflow-hidden border border-slate-700">
          <table className="w-full">
            <thead className="bg-slate-800">
              <tr>
                {['Field', 'Claimed', 'Actual (chain)', 'Match'].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-xs text-slate-400 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              <DiffRow field="tokenIn"   claimed={r.claimedTokenIn}  actual={r.actualTokenIn} />
              <DiffRow field="tokenOut"  claimed={r.claimedTokenOut} actual={r.actualTokenOut} />
              <DiffRow field="amountIn"  claimed={fmtAmount(r.claimedAmountIn)}  actual={fmtAmount(r.actualAmountIn)} />
              <DiffRow field="amountOut" claimed={fmtAmount(r.claimedAmountOut)} actual={fmtAmount(r.actualAmountOut)} />
            </tbody>
          </table>
        </div>
      </div>

      {/* Engine verdict reasons */}
      {r.reasons.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 mb-1.5 uppercase tracking-wider font-semibold">Engine Verdict</p>
          {r.reasons.map((reason, i) => (
            <code key={i} className="block text-xs bg-slate-800/80 border border-slate-700 text-red-300 px-3 py-2 rounded font-mono break-all">
              {reason}
            </code>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AgentPage({ params }: { params: { id: string } }) {
  const agent    = getAgentData(params.id)
  if (!agent) notFound()

  const receipts = getAgentReceipts(params.id)
  const bd       = getScoreBreakdown(params.id)

  const verdictBg = agent.falseClaimCount > 0 ? 'border-red-900/50' : 'border-slate-800'

  return (
    <div className="space-y-8">
      {/* Agent header */}
      <div className={`rounded-xl border ${verdictBg} bg-slate-900 p-6`}>
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl font-bold text-white tracking-tight">{agent.name}</h1>
              <span className={`text-xs px-2.5 py-1 rounded-full border font-mono ${
                agent.cohort === 'ai'
                  ? 'bg-blue-950 text-blue-300 border-blue-900'
                  : 'bg-purple-950 text-purple-300 border-purple-900'
              }`}>
                {agent.cohort === 'ai' ? '🤖 AI Agent' : '👤 Human Trader'}
              </span>
              {agent.lastVerdict && <VerdictBadge verdict={agent.lastVerdict} />}
            </div>
            <p className="text-sm text-slate-400 font-mono">
              AgentId: <span className="text-slate-200">{agent.agentId}</span>
              <span className="text-slate-600 mx-2">·</span>
              Address: <span className="text-slate-200">{shortAddr(agent.address)}</span>
            </p>
          </div>
          <div className="text-right">
            <div className={`text-6xl font-bold font-mono leading-none ${scoreColor(agent.score)}`}>
              {agent.score.toFixed(1)}
            </div>
            <div className="text-xs text-slate-500 mt-1">/ 100 reputation</div>
          </div>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-6">
          {[
            { label: 'Trades',       value: agent.trades,            col: 'text-slate-200' },
            { label: '✓ Verified',   value: agent.verifiedCount,     col: 'text-green-400' },
            { label: '≈ Exaggerated',value: agent.exaggeratedCount,  col: 'text-amber-400' },
            { label: '🚨 False',      value: agent.falseClaimCount,   col: agent.falseClaimCount > 0 ? 'text-red-400 font-bold' : 'text-slate-500' },
            { label: 'Truthfulness', value: `${(agent.truthfulness * 100).toFixed(0)}%`, col: agent.truthfulness >= 0.8 ? 'text-green-400' : agent.truthfulness >= 0.5 ? 'text-amber-400' : 'text-red-400' },
          ].map(s => (
            <div key={s.label} className="rounded-lg border border-slate-800 bg-slate-800/40 p-3 text-center">
              <div className={`text-2xl font-bold font-mono ${s.col}`}>{s.value}</div>
              <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Score breakdown */}
      {bd && <ScoreBreakdownPanel bd={bd} />}

      {/* Claim history */}
      <section>
        <h2 className="text-base font-bold text-white mb-4">
          Claim Receipts <span className="text-slate-500 font-normal text-sm">({receipts.length})</span>
        </h2>
        {receipts.length === 0
          ? <p className="text-slate-500 text-sm">No claims yet.</p>
          : <div className="space-y-4">{receipts.map(r => <ReceiptCard key={r.id} r={r} />)}</div>
        }
      </section>

      <a href="/" className="inline-block text-sm text-slate-500 hover:text-slate-300 transition-colors pt-2">
        ← Back to Arena
      </a>
    </div>
  )
}
