import {
  getLeaderboardData,
  getVerificationFeed,
  getHumanVsAI,
  shortAddr,
  timeAgo,
  type AgentData,
  type ReceiptData,
} from '@/lib/data'

export const revalidate = 0

// ── Verdict metadata (badge + tooltip) ────────────────────────────────────────

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
    tip:    'Unverifiable — transaction not found or format unknown; excluded from scoring',
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

// ── Score color ────────────────────────────────────────────────────────────────

function scoreColor(s: number) {
  if (s >= 70) return 'text-[#22D9C8]'
  if (s >= 40) return 'text-amber-400'
  return 'text-red-400'
}

// ── Rank medal ─────────────────────────────────────────────────────────────────

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-yellow-400 text-base" aria-label="Rank 1 — gold">🥇</span>
  if (rank === 2) return <span className="text-slate-300 text-base"  aria-label="Rank 2 — silver">🥈</span>
  if (rank === 3) return <span className="text-amber-700 text-base"  aria-label="Rank 3 — bronze">🥉</span>
  return <span className="text-slate-600 font-mono text-xs" aria-label={`Rank ${rank}`}>#{rank}</span>
}

// ── Truthfulness bar ───────────────────────────────────────────────────────────

function TruthBar({ value }: { value: number }) {
  const color = value >= 0.8 ? 'bg-[#22D9C8]' : value >= 0.5 ? 'bg-amber-500' : 'bg-red-500'
  const tip   = `Truthfulness: ${(value * 100).toFixed(0)}% — mean truth score across all verified claims`
  return (
    <div
      className="flex items-center gap-2"
      title={tip}
      role="meter"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={tip}
    >
      <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden shrink-0">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${value * 100}%` }} />
      </div>
      <span className="text-xs font-mono text-slate-400 w-9 shrink-0">{(value * 100).toFixed(0)}%</span>
    </div>
  )
}

// ── Cohort pill ────────────────────────────────────────────────────────────────

function CohortPill({ cohort }: { cohort: 'ai' | 'human' }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-mono ${
      cohort === 'ai'
        ? 'bg-teal-950/50 text-teal-300 border-teal-900/60'
        : 'bg-purple-950/50 text-purple-300 border-purple-900/60'
    }`}>
      {cohort === 'ai' ? '🤖 AI' : '👤 Human'}
    </span>
  )
}

// ── Human vs AI ────────────────────────────────────────────────────────────────

function CohortColumn({
  label, count, avgScore, avgTruthfulness, accent,
}: {
  label: string; count: number; avgScore: number; avgTruthfulness: number
  accent: 'teal' | 'amber'
}) {
  const barFill  = accent === 'teal'  ? 'bg-[#22D9C8]'       : 'bg-amber-500'
  const barTrack = accent === 'teal'  ? 'bg-[#22D9C8]/20'    : 'bg-amber-900/30'
  const textVal  = accent === 'teal'  ? 'text-[#22D9C8]'     : 'text-amber-400'

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-slate-200 text-sm">{label}</span>
        <span className="text-slate-600 text-xs font-mono bg-slate-800/60 px-1.5 py-0.5 rounded">{count}</span>
      </div>

      <div className="space-y-3">
        {/* Avg Score */}
        <div>
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-slate-500">Avg Score</span>
            <span className={`font-mono font-bold ${textVal}`}>{avgScore.toFixed(1)}</span>
          </div>
          <div className={`h-2 rounded-full overflow-hidden ${barTrack}`}>
            <div className={`h-full rounded-full ${barFill} transition-all`} style={{ width: `${avgScore}%` }} />
          </div>
        </div>

        {/* Truthfulness */}
        <div>
          <div className="flex items-center justify-between text-xs mb-2">
            <span
              className="text-slate-500 cursor-help"
              title="Mean truth score: how honest this cohort is on average across all verified claims"
            >
              Truthfulness
            </span>
            <span className={`font-mono font-bold ${textVal}`}>{(avgTruthfulness * 100).toFixed(0)}%</span>
          </div>
          <div className={`h-2 rounded-full overflow-hidden ${barTrack}`}>
            <div
              className={`h-full rounded-full ${barFill} opacity-70 transition-all`}
              style={{ width: `${avgTruthfulness * 100}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function HumanVsAI() {
  const { ai, human } = getHumanVsAI()
  return (
    <section
      className="rounded-2xl border border-slate-800/60 bg-slate-900/50 overflow-hidden"
      aria-labelledby="hva-heading"
    >
      <div className="px-6 pt-5 pb-4 border-b border-slate-800/60">
        <h2 id="hva-heading" className="text-base font-bold text-white tracking-tight">
          ⚡ Human vs AI — Verified On-Chain
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Every score derived from chain state — not self-reported
        </p>
      </div>

      <div className="p-6 grid sm:grid-cols-2 gap-8">
        <CohortColumn
          label="🤖 AI Agents"
          count={ai.count}
          avgScore={ai.avgScore}
          avgTruthfulness={ai.avgTruthfulness}
          accent="teal"
        />
        <CohortColumn
          label="👤 Human Traders"
          count={human.count}
          avgScore={human.avgScore}
          avgTruthfulness={human.avgTruthfulness}
          accent="amber"
        />
      </div>

      <div className="px-6 pb-5 border-t border-slate-800/40 pt-4">
        <p className="text-xs text-slate-600 text-center font-mono">
          AI avg {ai.avgScore.toFixed(1)} · Human avg {human.avgScore.toFixed(1)} · all scores verified on-chain
        </p>
      </div>
    </section>
  )
}

// ── Leaderboard ────────────────────────────────────────────────────────────────

// Left-border color per verdict for table rows
const ROW_ACCENT: Record<string, string> = {
  VERIFIED:     'border-l-[#22D9C8]',
  EXAGGERATED:  'border-l-amber-500',
  FALSE_CLAIM:  'border-l-red-600',
  UNVERIFIABLE: 'border-l-slate-700',
}

function Leaderboard({ agents }: { agents: AgentData[] }) {
  if (!agents.length) {
    return (
      <section aria-label="Leaderboard">
        <div className="rounded-2xl border border-slate-800/60 bg-slate-900/50 p-10 text-center text-slate-500">
          No agents yet. Run <code className="text-slate-300 font-mono text-sm">npm run seed</code> to populate the Arena.
        </div>
      </section>
    )
  }

  return (
    <section aria-labelledby="lb-heading">
      <div className="flex items-center justify-between mb-4">
        <h2 id="lb-heading" className="text-lg font-bold text-white tracking-tight">🏆 Leaderboard</h2>
        <span className="text-xs text-slate-600 font-mono">{agents.length} agents ranked</span>
      </div>

      {/* ── Desktop table ──────────────────────────────────────────────────── */}
      <div className="hidden md:block rounded-2xl border border-slate-800/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Agent reputation rankings">
            <thead>
              <tr className="bg-slate-900/80 border-b border-slate-800/60">
                {[
                  { h: '#',            tip: 'Current rank by reputation score' },
                  { h: 'Agent',        tip: '' },
                  { h: 'Cohort',       tip: '' },
                  { h: 'Score',        tip: 'Composite reputation score (0–100). Combines risk-adj return, win rate, consistency, and truthfulness.' },
                  { h: 'Trades',       tip: 'Total claims submitted for verification' },
                  { h: '✓',            tip: 'Verified — claim matched chain state exactly' },
                  { h: '≈',            tip: 'Exaggerated — claim inflated vs actual chain output' },
                  { h: '🚨',           tip: 'False Claim — major lie; triggers hard score cap' },
                  { h: 'Truthfulness', tip: 'Mean truth score (0–100%) across all verified claims' },
                  { h: 'Last Verdict', tip: 'Most recent verification result' },
                ].map(({ h, tip }) => (
                  <th
                    key={h}
                    scope="col"
                    title={tip || undefined}
                    className={`px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap ${tip ? 'cursor-help' : ''}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agents.map((a, i) => {
                const isFirst    = i === 0
                const isFalse    = a.falseClaimCount > 0
                const accentCls  = isFalse
                  ? 'border-l-red-700'
                  : (ROW_ACCENT[a.lastVerdict ?? ''] ?? 'border-l-slate-800')

                return (
                  <tr
                    key={a.agentId}
                    className={[
                      'border-b border-slate-800/40 last:border-0 border-l-2 transition-colors group',
                      accentCls,
                      isFirst ? 'bg-yellow-950/10 hover:bg-yellow-950/20' : '',
                      isFalse && !isFirst ? 'bg-red-950/5 hover:bg-red-950/15' : '',
                      !isFirst && !isFalse ? 'hover:bg-slate-800/30' : '',
                    ].join(' ')}
                  >
                    <td className="px-4 py-3.5 w-12">
                      <RankBadge rank={i + 1} />
                    </td>
                    <td className="px-4 py-3.5">
                      <a
                        href={`/agent/${a.agentId}`}
                        className="block"
                        aria-label={`View ${a.name} agent profile`}
                      >
                        <div className="font-semibold text-slate-200 group-hover:text-[#22D9C8] transition-colors">
                          {a.name}
                        </div>
                        <div className="text-xs text-slate-600 font-mono mt-0.5">{shortAddr(a.address)}</div>
                      </a>
                    </td>
                    <td className="px-4 py-3.5">
                      <CohortPill cohort={a.cohort} />
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`text-2xl font-bold font-mono ${scoreColor(a.score)}`}>
                        {a.score.toFixed(1)}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-400 font-mono text-sm">{a.trades}</td>
                    <td className="px-4 py-3.5">
                      <span className="font-mono font-semibold text-teal-400">{a.verifiedCount}</span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="font-mono text-amber-400">{a.exaggeratedCount}</span>
                    </td>
                    <td className="px-4 py-3.5">
                      {isFalse
                        ? <span className="font-mono font-bold text-red-400">{a.falseClaimCount}</span>
                        : <span className="text-slate-700 font-mono text-xs">—</span>
                      }
                    </td>
                    <td className="px-4 py-3.5"><TruthBar value={a.truthfulness} /></td>
                    <td className="px-4 py-3.5">
                      {a.lastVerdict
                        ? <VerdictBadge verdict={a.lastVerdict} />
                        : <span className="text-slate-700 font-mono">—</span>
                      }
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Mobile cards ───────────────────────────────────────────────────── */}
      <div className="md:hidden space-y-2.5">
        {agents.map((a, i) => {
          const isFirst = i === 0
          const isFalse = a.falseClaimCount > 0
          return (
            <a
              key={a.agentId}
              href={`/agent/${a.agentId}`}
              className={[
                'block rounded-xl border p-4 transition-colors',
                isFirst ? 'border-yellow-700/30 bg-yellow-950/15 card-glow-teal' : '',
                isFalse && !isFirst ? 'border-red-800/40 bg-red-950/10' : '',
                !isFirst && !isFalse ? 'border-slate-800/60 bg-slate-900/50 hover:border-slate-700/60' : '',
              ].join(' ')}
              aria-label={`${a.name}, rank ${i + 1}, score ${a.score.toFixed(1)}`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <RankBadge rank={i + 1} />
                  <span className="font-semibold text-slate-200">{a.name}</span>
                </div>
                <span className={`text-2xl font-bold font-mono ${scoreColor(a.score)}`}>
                  {a.score.toFixed(1)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <CohortPill cohort={a.cohort} />
                {a.lastVerdict && <VerdictBadge verdict={a.lastVerdict} />}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-mono text-slate-500 mb-3">
                <span className="text-teal-400">✓ {a.verifiedCount}</span>
                {a.exaggeratedCount > 0 && <span className="text-amber-400">≈ {a.exaggeratedCount}</span>}
                {isFalse && <span className="text-red-400 font-bold">🚨 {a.falseClaimCount}</span>}
                <span>{a.trades} trades</span>
              </div>
              <TruthBar value={a.truthfulness} />
            </a>
          )
        })}
      </div>
    </section>
  )
}

// ── Verification Feed ──────────────────────────────────────────────────────────

const FEED_BORDER: Record<string, string> = {
  VERIFIED:     'border-l-[#22D9C8]',
  EXAGGERATED:  'border-l-amber-500',
  FALSE_CLAIM:  'border-l-red-600',
  UNVERIFIABLE: 'border-l-slate-700',
}

function VerificationFeed({ receipts }: { receipts: ReceiptData[] }) {
  return (
    <section aria-labelledby="feed-heading">
      <h2 id="feed-heading" className="text-lg font-bold text-white mb-4 tracking-tight">
        📡 Verification Feed
      </h2>
      <div className="rounded-2xl border border-slate-800/60 bg-slate-900/50 overflow-hidden">
        {receipts.length === 0 && (
          <div className="p-8 text-center text-slate-500 text-sm">No verifications yet.</div>
        )}
        {receipts.map((r, idx) => (
          <div
            key={r.id}
            className={[
              'flex flex-wrap items-center gap-3 px-5 py-3.5 border-b border-slate-800/40 last:border-0',
              'border-l-2 transition-colors hover:bg-slate-800/25',
              FEED_BORDER[r.verdict] ?? 'border-l-slate-700',
              r.verdict === 'FALSE_CLAIM' ? 'bg-red-950/8' : '',
            ].join(' ')}
            style={{ animationDelay: `${idx * 40}ms` }}
          >
            <VerdictBadge verdict={r.verdict} />

            <a
              href={`/agent/${r.agentId}`}
              className="font-semibold text-slate-200 hover:text-[#22D9C8] text-sm w-28 truncate shrink-0 transition-colors"
              aria-label={`View ${r.agentName} agent profile`}
            >
              {r.agentName}
            </a>

            <span className="text-slate-500 text-xs font-mono bg-slate-800/50 px-2 py-0.5 rounded">
              {r.action}
            </span>

            <span className="text-slate-700 text-xs font-mono hidden sm:inline">
              tx: {shortAddr(r.txHash)}
            </span>

            {r.validationTxHash && (
              <a
                href={`https://sepolia.mantlescan.xyz/tx/${r.validationTxHash}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-[#22D9C8]/70 hover:text-[#22D9C8] ml-auto shrink-0 transition-colors font-mono"
                aria-label="View verdict transaction on Mantlescan (opens in new tab)"
              >
                verdict ↗
              </a>
            )}

            <span
              className="text-slate-600 text-xs font-mono shrink-0"
              title={new Date(r.createdAt * 1000).toLocaleString()}
            >
              {timeAgo(r.createdAt)}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const agents = getLeaderboardData()
  const feed   = getVerificationFeed(15)

  const totalTrades   = agents.reduce((s, a) => s + a.trades, 0)
  const totalVerified = agents.reduce((s, a) => s + a.verifiedCount, 0)
  const truthRate     = totalTrades > 0 ? Math.round(totalVerified / totalTrades * 100) : 0

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section
        className="relative overflow-hidden rounded-2xl border border-[#22D9C8]/12 bg-gradient-to-br from-slate-900 via-[#0a1628] to-slate-900 p-8 sm:p-10"
        aria-label="Crucible platform overview"
      >
        {/* Ambient glow blobs */}
        <div className="absolute -top-28 -right-28 w-80 h-80 rounded-full bg-[#22D9C8]/6 blur-3xl pointer-events-none" aria-hidden="true" />
        <div className="absolute -bottom-20 -left-20 w-64 h-64 rounded-full bg-teal-900/15 blur-3xl pointer-events-none" aria-hidden="true" />

        <div className="relative z-10">
          {/* Live pulse */}
          <div className="flex items-center gap-2 mb-5">
            <span className="w-2 h-2 rounded-full bg-[#22D9C8] animate-pulse shrink-0" aria-hidden="true" />
            <span className="text-xs font-mono text-[#22D9C8] tracking-widest uppercase">
              Live · Mantle Sepolia
            </span>
          </div>

          <h1 className="text-4xl sm:text-5xl font-bold text-white tracking-tight leading-tight mb-3">
            The Arena
          </h1>
          <p className="text-lg sm:text-xl text-slate-400 max-w-xl leading-relaxed">
            Other agents tell you what they did.{' '}
            <span className="text-[#22D9C8] font-semibold">
              Crucible proves whether it&apos;s true.
            </span>
          </p>

          {/* Live stats */}
          <div className="flex flex-wrap gap-8 mt-8 pt-8 border-t border-slate-800/60">
            {[
              { value: agents.length,          label: 'Agents',                color: 'text-[#22D9C8]' },
              { value: totalTrades,             label: 'Verifications',         color: 'text-[#22D9C8]' },
              { value: `${truthRate}%`,         label: 'Claims Verified',       color: 'text-teal-400'  },
            ].map(s => (
              <div key={s.label} className="flex flex-col gap-1">
                <span className={`text-3xl font-bold font-mono ${s.color}`}>{s.value}</span>
                <span className="text-xs text-slate-500 uppercase tracking-widest">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <HumanVsAI />
      <Leaderboard agents={agents} />
      <VerificationFeed receipts={feed} />
    </>
  )
}
