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

// ── Verdict metadata ───────────────────────────────────────────────────────────

const VERDICT: Record<string, { bg: string; text: string; border: string; icon: string; tip: string }> = {
  VERIFIED: {
    bg:     'bg-teal-950/60',
    text:   'text-teal-300',
    border: 'border-teal-700/50',
    icon:   '✓',
    tip:    'Verified — claim matched chain state exactly',
  },
  EXAGGERATED: {
    bg:     'bg-amber-950/60',
    text:   'text-amber-300',
    border: 'border-amber-700/50',
    icon:   '≈',
    tip:    'Exaggerated — claim inflated vs actual chain output (minor untruth)',
  },
  FALSE_CLAIM: {
    bg:     'bg-red-950/60',
    text:   'text-red-300',
    border: 'border-red-700/50',
    icon:   '🚨',
    tip:    'False Claim — claim contradicts chain state (major lie; score capped hard)',
  },
  UNVERIFIABLE: {
    bg:     'bg-slate-800/60',
    text:   'text-slate-400',
    border: 'border-slate-700/40',
    icon:   '?',
    tip:    'Unverifiable — transaction not found or format unknown',
  },
}

function VerdictBadge({ verdict, large }: { verdict: string; large?: boolean }) {
  const m  = VERDICT[verdict] ?? VERDICT.UNVERIFIABLE
  const sz = large ? 'text-sm px-3 py-1.5 gap-1.5' : 'text-xs px-2 py-0.5 gap-1'
  return (
    <span
      className={`inline-flex items-center rounded border font-mono font-medium ${sz} ${m.bg} ${m.text} ${m.border}`}
      title={m.tip}
      role="status"
      aria-label={m.tip}
    >
      <span aria-hidden="true">{m.icon}</span>
      <span>{verdict.replace('_', ' ')}</span>
    </span>
  )
}

function scoreColor(s: number) {
  if (s >= 70) return 'text-[#22D9C8]'
  if (s >= 40) return 'text-amber-400'
  return 'text-red-400'
}

// ── SVG truth-score ring ───────────────────────────────────────────────────────

function TruthRing({ value }: { value: number }) {
  const r    = 38
  const circ = 2 * Math.PI * r
  const fill = circ * Math.max(0, Math.min(1, value))
  const color = value >= 0.8 ? '#22D9C8' : value >= 0.5 ? '#F59E0B' : '#EF4444'
  const pct   = (value * 100).toFixed(0)

  return (
    <div
      className="relative flex items-center justify-center w-28 h-28 shrink-0"
      role="meter"
      aria-valuenow={Number(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Truthfulness: ${pct}%`}
    >
      {/* SVG rotated so arc starts from the top */}
      <svg
        width="112" height="112" viewBox="0 0 112 112"
        className="absolute inset-0 -rotate-90"
        aria-hidden="true"
      >
        {/* Track */}
        <circle cx="56" cy="56" r={r} fill="none" stroke="#1E293B" strokeWidth="8" />
        {/* Filled arc */}
        <circle
          cx="56" cy="56" r={r}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${fill} ${circ}`}
          style={{ filter: `drop-shadow(0 0 5px ${color}80)`, transition: 'stroke-dasharray 0.5s ease' }}
        />
      </svg>
      {/* Center label */}
      <div className="relative text-center select-none" aria-hidden="true">
        <div className="text-xl font-bold font-mono leading-none" style={{ color }}>{pct}%</div>
        <div className="text-[10px] text-slate-500 uppercase tracking-widest mt-0.5">truth</div>
      </div>
    </div>
  )
}

// ── Score breakdown bars ───────────────────────────────────────────────────────

function ScoreBar({
  label, pts, max, note,
}: { label: string; pts: number; max: number; note?: string }) {
  const pct   = Math.min(100, (pts / max) * 100)
  const color = pct >= 60 ? 'bg-[#22D9C8]' : pct >= 40 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span className="text-slate-300">{label}</span>
        <span className="font-mono text-slate-300">
          {pts.toFixed(2)}
          <span className="text-slate-600"> / {max}</span>
        </span>
      </div>
      <div
        className="h-2.5 bg-slate-800 rounded-full overflow-hidden"
        role="meter"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {note && <p className="text-xs text-red-400 font-mono mt-0.5">{note}</p>}
    </div>
  )
}

function ScoreBreakdownPanel({ bd }: { bd: ScoreBreakdown }) {
  return (
    <section
      className="rounded-2xl border border-slate-800/60 bg-slate-900/50 p-6 space-y-5"
      aria-labelledby="breakdown-heading"
    >
      <div className="flex items-center justify-between">
        <h2 id="breakdown-heading" className="text-base font-bold text-white">Score Formula</h2>
        {bd.hasFalse && (
          <span
            className="text-xs text-red-400 font-mono bg-red-950/40 border border-red-800/40 px-2.5 py-1 rounded-full"
            title="A FALSE_CLAIM penalty applies a hard ceiling on the total score"
          >
            ⚠ Cap = {bd.cap}
          </span>
        )}
      </div>

      <div className="space-y-4">
        <ScoreBar label="Risk-Adj Return (35×)"  pts={bd.riskReturn}   max={35} />
        <ScoreBar label="Win Rate (20×)"         pts={bd.winRate}      max={20} />
        <ScoreBar label="Consistency (15×)"      pts={bd.consistency}  max={15} />
        <ScoreBar
          label="Truthfulness (30×)"
          pts={bd.truthfulness}
          max={30}
          note={bd.hasFalse
            ? `⚠ FALSE_CLAIM penalty: ${bd.falseClaimCount} lie${bd.falseClaimCount > 1 ? 's' : ''} → ceiling = ${bd.cap}`
            : undefined}
        />
      </div>

      <div className="border-t border-slate-800/60 pt-4 flex items-center justify-between font-mono text-sm">
        <span className="text-slate-500">
          Weighted sum: {bd.rawTotal.toFixed(2)}
          {bd.hasFalse && (
            <span className="text-red-400"> → capped at {bd.cap}</span>
          )}
        </span>
        <span className={`font-bold text-xl ${scoreColor(bd.finalScore)}`}>
          {bd.finalScore.toFixed(2)}
        </span>
      </div>
    </section>
  )
}

// ── Receipt: claimed-vs-chain diff ─────────────────────────────────────────────

function DiffRow({
  field, claimed, actual,
}: { field: string; claimed: string | undefined; actual: string | undefined }) {
  if (!claimed && !actual) return null
  const mismatch = !!(claimed && actual && claimed.toLowerCase() !== actual.toLowerCase())
  return (
    <tr className={`border-b border-slate-800/30 last:border-0 ${mismatch ? 'bg-red-950/20' : ''}`}>
      <td className="px-4 py-2.5 text-xs text-slate-500 font-mono whitespace-nowrap">{field}</td>
      <td className={`px-4 py-2.5 text-xs font-mono ${mismatch ? 'text-red-300' : 'text-slate-300'}`}>
        {claimed ?? '—'}
      </td>
      <td className={`px-4 py-2.5 text-xs font-mono ${mismatch ? 'text-teal-300' : 'text-slate-300'}`}>
        {actual ?? '—'}
      </td>
      <td className="px-4 py-2.5 text-xs text-center w-16">
        {mismatch
          ? <span className="text-red-400 font-bold" title="Mismatch between claimed and actual">❌</span>
          : <span className="text-teal-400" title="Claimed matches chain state">✓</span>
        }
      </td>
    </tr>
  )
}

// ── Receipt card ───────────────────────────────────────────────────────────────

function ReceiptCard({ r }: { r: ReceiptData }) {
  const gatewayUrl = ipfsToGateway(r.evidenceUri)
  const vm   = VERDICT[r.verdict]
  const cardBorder = r.verdict === 'FALSE_CLAIM'
    ? 'border-red-800/50'
    : r.verdict === 'EXAGGERATED'
    ? 'border-amber-700/40'
    : r.verdict === 'VERIFIED'
    ? 'border-teal-800/40'
    : 'border-slate-700/50'
  const cardBg = r.verdict === 'FALSE_CLAIM'
    ? 'bg-red-950/10'
    : r.verdict === 'EXAGGERATED'
    ? 'bg-amber-950/8'
    : 'bg-slate-900/50'

  return (
    <article
      className={`rounded-2xl border p-5 space-y-5 ${cardBorder} ${cardBg}`}
      aria-label={`Receipt: ${r.verdict.replace('_', ' ')} — ${r.action}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2">
          <VerdictBadge verdict={r.verdict} large />
          <div className="text-xs text-slate-500 font-mono">
            {new Date(r.timestamp).toLocaleString()}
            <span className="text-slate-700 mx-1.5">·</span>
            {timeAgo(r.createdAt)}
          </div>
        </div>

        {/* External links */}
        <div className="flex flex-wrap gap-2">
          <a
            href={`https://sepolia.mantlescan.xyz/tx/${r.txHash}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50 text-blue-400 hover:text-blue-300 hover:border-blue-800/50 font-mono transition-colors"
            aria-label="View swap transaction on Mantlescan (opens in new tab)"
          >
            swap tx ↗
          </a>
          {r.validationTxHash && (
            <a
              href={`https://sepolia.mantlescan.xyz/tx/${r.validationTxHash}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50 text-[#22D9C8]/80 hover:text-[#22D9C8] hover:border-teal-800/50 font-mono transition-colors"
              aria-label="View verdict transaction on Mantlescan (opens in new tab)"
            >
              verdict tx ↗
            </a>
          )}
          {gatewayUrl && (
            <a
              href={gatewayUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50 text-purple-400 hover:text-purple-300 hover:border-purple-800/50 font-mono transition-colors"
              aria-label="View evidence on IPFS (opens in new tab)"
            >
              evidence (IPFS) ↗
            </a>
          )}
        </div>
      </div>

      {/* Truth score bar */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-500 shrink-0 w-20">Truth score</span>
        <div
          className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden"
          role="meter"
          aria-valuenow={Math.round(r.truthScore * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Truth score: ${(r.truthScore * 100).toFixed(0)}%`}
        >
          <div
            className={`h-full rounded-full ${r.truthScore >= 0.9 ? 'bg-[#22D9C8]' : r.truthScore >= 0.5 ? 'bg-amber-500' : 'bg-red-500'}`}
            style={{ width: `${r.truthScore * 100}%` }}
          />
        </div>
        <span className="text-xs font-mono text-slate-300 w-10 text-right shrink-0">
          {(r.truthScore * 100).toFixed(0)}%
        </span>
      </div>

      {/* Claimed vs Chain diff table */}
      <div>
        <p className="text-xs text-slate-500 mb-2.5 uppercase tracking-widest font-semibold">
          Claimed vs Chain-Derived
        </p>
        <div className="rounded-xl overflow-hidden border border-slate-700/50">
          <table className="w-full" aria-label="Claimed vs actual values comparison">
            <thead className="bg-slate-800/60">
              <tr>
                {['Field', 'Claimed', 'Actual (chain)', ''].map(h => (
                  <th key={h} scope="col" className="px-4 py-2.5 text-left text-xs text-slate-500 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <DiffRow
                field="tokenIn"
                claimed={r.claimedTokenIn  ? shortAddr(r.claimedTokenIn)  : undefined}
                actual ={r.actualTokenIn   ? shortAddr(r.actualTokenIn)   : undefined}
              />
              <DiffRow
                field="tokenOut"
                claimed={r.claimedTokenOut ? shortAddr(r.claimedTokenOut) : undefined}
                actual ={r.actualTokenOut  ? shortAddr(r.actualTokenOut)  : undefined}
              />
              <DiffRow
                field="amountIn"
                claimed={fmtAmount(r.claimedAmountIn)}
                actual ={fmtAmount(r.actualAmountIn)}
              />
              <DiffRow
                field="amountOut"
                claimed={fmtAmount(r.claimedAmountOut)}
                actual ={fmtAmount(r.actualAmountOut)}
              />
            </tbody>
          </table>
        </div>
      </div>

      {/* Engine reasons */}
      {r.reasons.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 mb-2 uppercase tracking-widest font-semibold">
            Engine Verdict
          </p>
          <div className="space-y-1.5">
            {r.reasons.map((reason, i) => (
              <div
                key={i}
                className="flex items-start gap-2 text-xs font-mono bg-slate-800/50 border border-slate-700/40 text-red-300 px-3 py-2.5 rounded-lg break-all"
              >
                <span className="text-red-500 shrink-0 mt-px" aria-hidden="true">✗</span>
                {reason}
              </div>
            ))}
          </div>
        </div>
      )}
    </article>
  )
}

// ── Agent stat pill ────────────────────────────────────────────────────────────

function StatPill({
  label, value, valueClass,
}: { label: string; value: string | number; valueClass?: string }) {
  return (
    <div className="rounded-xl border border-slate-800/60 bg-slate-800/30 p-4 text-center">
      <div className={`text-2xl font-bold font-mono ${valueClass ?? 'text-slate-200'}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-1 uppercase tracking-wider">{label}</div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AgentPage({ params }: { params: { id: string } }) {
  const agent    = getAgentData(params.id)
  if (!agent) notFound()

  const receipts = getAgentReceipts(params.id)
  const bd       = getScoreBreakdown(params.id)

  const hasFalse   = agent.falseClaimCount > 0
  const headerBorder = hasFalse
    ? 'border-red-800/50'
    : agent.score >= 70
    ? 'border-[#22D9C8]/20 card-glow-teal'
    : 'border-slate-800/60'

  return (
    <div className="space-y-8">

      {/* Back link */}
      <a
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors"
        aria-label="Back to Arena leaderboard"
      >
        ← Back to Arena
      </a>

      {/* ── Agent header card ──────────────────────────────────────────────── */}
      <section
        className={`rounded-2xl border bg-slate-900/60 p-6 ${headerBorder}`}
        aria-labelledby="agent-name"
      >
        <div className="flex items-start justify-between gap-6 flex-wrap">
          {/* Identity */}
          <div className="space-y-3 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 id="agent-name" className="text-3xl font-bold text-white tracking-tight">
                {agent.name}
              </h1>
              <span
                className={`text-xs px-2.5 py-1 rounded-full border font-mono ${
                  agent.cohort === 'ai'
                    ? 'bg-teal-950/50 text-teal-300 border-teal-900/60'
                    : 'bg-purple-950/50 text-purple-300 border-purple-900/60'
                }`}
              >
                {agent.cohort === 'ai' ? '🤖 AI Agent' : '👤 Human Trader'}
              </span>
              {agent.lastVerdict && <VerdictBadge verdict={agent.lastVerdict} />}
            </div>
            <p className="text-sm text-slate-500 font-mono">
              ID:{' '}
              <span className="text-slate-300">{agent.agentId}</span>
              <span className="text-slate-700 mx-2">·</span>
              <span className="text-slate-300">{shortAddr(agent.address)}</span>
              <a
                href={`https://sepolia.mantlescan.xyz/address/${agent.address}`}
                target="_blank"
                rel="noreferrer"
                className="text-[#22D9C8]/60 hover:text-[#22D9C8] ml-2 transition-colors text-xs"
                aria-label="View wallet on Mantlescan (opens in new tab)"
              >
                ↗
              </a>
            </p>
          </div>

          {/* Truth ring + score */}
          <div className="flex items-center gap-5 shrink-0">
            <TruthRing value={agent.truthfulness} />
            <div className="text-right">
              <div
                className={`text-5xl font-bold font-mono leading-none ${scoreColor(agent.score)}`}
                title={`Reputation score: ${agent.score.toFixed(2)} / 100`}
              >
                {agent.score.toFixed(1)}
              </div>
              <div className="text-xs text-slate-600 mt-1.5 font-mono">/ 100 reputation</div>
              {hasFalse && (
                <div
                  className="text-xs text-red-400 mt-1 font-mono"
                  title="Score capped due to FALSE_CLAIM penalty"
                >
                  ⚠ capped
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Quick stat pills */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-6">
          <StatPill label="Trades"      value={agent.trades}           />
          <StatPill label="✓ Verified"  value={agent.verifiedCount}    valueClass="text-teal-400" />
          <StatPill label="≈ Exaggerated" value={agent.exaggeratedCount} valueClass="text-amber-400" />
          <StatPill
            label="🚨 False"
            value={agent.falseClaimCount}
            valueClass={hasFalse ? 'text-red-400 font-bold' : 'text-slate-600'}
          />
          <StatPill
            label="Truthfulness"
            value={`${(agent.truthfulness * 100).toFixed(0)}%`}
            valueClass={
              agent.truthfulness >= 0.8
                ? 'text-[#22D9C8]'
                : agent.truthfulness >= 0.5
                ? 'text-amber-400'
                : 'text-red-400'
            }
          />
        </div>
      </section>

      {/* ── Score breakdown ────────────────────────────────────────────────── */}
      {bd && <ScoreBreakdownPanel bd={bd} />}

      {/* ── Claim receipts ─────────────────────────────────────────────────── */}
      <section aria-labelledby="receipts-heading">
        <h2 id="receipts-heading" className="text-base font-bold text-white mb-4">
          Claim Receipts{' '}
          <span className="text-slate-600 font-normal text-sm font-mono">({receipts.length})</span>
        </h2>
        {receipts.length === 0
          ? <p className="text-slate-500 text-sm">No claims submitted yet.</p>
          : (
            <div className="space-y-4">
              {receipts.map(r => <ReceiptCard key={r.id} r={r} />)}
            </div>
          )
        }
      </section>

    </div>
  )
}
