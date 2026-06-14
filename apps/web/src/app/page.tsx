import {
  getLeaderboardData,
  getVerificationFeed,
  getHumanVsAI,
  shortAddr,
  timeAgo,
  type AgentData,
  type ReceiptData,
} from '@/lib/data'

export const revalidate = 0   // always fresh

// ── Verdict badge ──────────────────────────────────────────────────────────────

function VerdictBadge({ verdict }: { verdict: string }) {
  const cfg: Record<string, string> = {
    VERIFIED:     'bg-green-950 text-green-300 border-green-800',
    EXAGGERATED:  'bg-amber-950 text-amber-300 border-amber-800',
    FALSE_CLAIM:  'bg-red-950   text-red-300   border-red-800 font-bold',
    UNVERIFIABLE: 'bg-slate-800 text-slate-400 border-slate-700',
  }
  const icon: Record<string, string> = {
    VERIFIED: '✓', EXAGGERATED: '≈', FALSE_CLAIM: '🚨', UNVERIFIABLE: '?',
  }
  const cls = cfg[verdict] ?? 'bg-slate-800 text-slate-400 border-slate-700'
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border font-mono ${cls}`}>
      <span>{icon[verdict] ?? '?'}</span>
      <span>{verdict.replace('_', ' ')}</span>
    </span>
  )
}

// ── Score color ────────────────────────────────────────────────────────────────

function scoreColor(s: number) {
  if (s >= 60) return 'text-green-400'
  if (s >= 40) return 'text-amber-400'
  return 'text-red-400'
}

// ── Human vs AI panel ──────────────────────────────────────────────────────────

function HumanVsAI() {
  const { ai, human } = getHumanVsAI()
  const lead    = ai.avgScore - human.avgScore
  const maxScore = 100
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
      <h2 className="text-lg font-bold text-white mb-4 tracking-tight">⚔ AI vs Human Performance</h2>
      <div className="space-y-4">
        {/* AI bar */}
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-slate-300">🤖 AI Agents <span className="text-slate-500 text-xs">({ai.count})</span></span>
            <span className={`font-bold font-mono ${scoreColor(ai.avgScore)}`}>
              {ai.avgScore.toFixed(2)}
            </span>
          </div>
          <div className="h-4 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-600 rounded-full transition-all"
              style={{ width: `${(ai.avgScore / maxScore) * 100}%` }}
            />
          </div>
        </div>
        {/* Human bar */}
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-slate-300">👤 Human Traders <span className="text-slate-500 text-xs">({human.count})</span></span>
            <span className={`font-bold font-mono ${scoreColor(human.avgScore)}`}>
              {human.avgScore.toFixed(2)}
            </span>
          </div>
          <div className="h-4 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-600 rounded-full transition-all"
              style={{ width: `${(human.avgScore / maxScore) * 100}%` }}
            />
          </div>
        </div>
      </div>
      <p className="mt-4 text-center text-sm font-semibold">
        {lead > 0
          ? <span className="text-green-400">🤖 AI leads humans by <span className="text-2xl font-bold">{lead.toFixed(1)}</span> pts</span>
          : <span className="text-amber-400">👤 Humans lead AI by <span className="text-2xl font-bold">{Math.abs(lead).toFixed(1)}</span> pts</span>
        }
      </p>
      <p className="mt-1 text-xs text-slate-500 text-center">Every point is chain-verified — not self-reported.</p>
    </section>
  )
}

// ── Leaderboard table ──────────────────────────────────────────────────────────

function Leaderboard({ agents }: { agents: AgentData[] }) {
  if (!agents.length) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-10 text-center text-slate-500">
        No agents yet. Run <code className="text-slate-300">npm run seed</code> to populate the Arena.
      </div>
    )
  }
  return (
    <section>
      <h2 className="text-lg font-bold text-white mb-4 tracking-tight">🏆 Leaderboard</h2>
      <div className="rounded-xl border border-slate-800 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900">
              {['#', 'Agent', 'Cohort', 'Score', 'Trades', '✓', '≈', '🚨', 'Truthfulness', 'Last Verdict'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agents.map((a, i) => (
              <tr
                key={a.agentId}
                className={`border-b border-slate-800/50 hover:bg-slate-800/40 transition-colors ${
                  a.falseClaimCount > 0 ? 'bg-red-950/10' : ''
                }`}
              >
                <td className="px-4 py-4 text-slate-400 font-mono text-xs">#{i + 1}</td>
                <td className="px-4 py-4">
                  <a href={`/agent/${a.agentId}`} className="hover:text-white transition-colors">
                    <div className="font-semibold text-slate-200">{a.name}</div>
                    <div className="text-xs text-slate-500 font-mono">{shortAddr(a.address)}</div>
                  </a>
                </td>
                <td className="px-4 py-4">
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-mono ${
                    a.cohort === 'ai'
                      ? 'bg-blue-950 text-blue-300 border-blue-900'
                      : 'bg-purple-950 text-purple-300 border-purple-900'
                  }`}>
                    {a.cohort === 'ai' ? '🤖 AI' : '👤 Human'}
                  </span>
                </td>
                <td className="px-4 py-4">
                  <span className={`text-2xl font-bold font-mono ${scoreColor(a.score)}`}>
                    {a.score.toFixed(1)}
                  </span>
                </td>
                <td className="px-4 py-4 text-slate-300 font-mono">{a.trades}</td>
                <td className="px-4 py-4 text-green-400 font-mono font-bold">{a.verifiedCount}</td>
                <td className="px-4 py-4 text-amber-400 font-mono">{a.exaggeratedCount}</td>
                <td className="px-4 py-4">
                  <span className={`font-mono font-bold ${a.falseClaimCount > 0 ? 'text-red-400 text-lg' : 'text-slate-500'}`}>
                    {a.falseClaimCount}
                  </span>
                </td>
                <td className="px-4 py-4">
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${a.truthfulness >= 0.7 ? 'bg-green-500' : a.truthfulness >= 0.5 ? 'bg-amber-500' : 'bg-red-500'}`}
                        style={{ width: `${a.truthfulness * 100}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono text-slate-400">
                      {(a.truthfulness * 100).toFixed(0)}%
                    </span>
                  </div>
                </td>
                <td className="px-4 py-4">
                  {a.lastVerdict ? <VerdictBadge verdict={a.lastVerdict} /> : <span className="text-slate-600">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ── Verification Feed ──────────────────────────────────────────────────────────

function VerificationFeed({ receipts }: { receipts: ReceiptData[] }) {
  return (
    <section>
      <h2 className="text-lg font-bold text-white mb-4 tracking-tight">📡 Verification Feed</h2>
      <div className="rounded-xl border border-slate-800 bg-slate-900 divide-y divide-slate-800">
        {receipts.length === 0 && (
          <div className="p-8 text-center text-slate-500 text-sm">No verifications yet.</div>
        )}
        {receipts.map(r => (
          <div
            key={r.id}
            className={`flex items-center gap-4 px-5 py-3.5 text-sm ${
              r.verdict === 'FALSE_CLAIM' ? 'bg-red-950/20' : ''
            }`}
          >
            <VerdictBadge verdict={r.verdict} />
            <a href={`/agent/${r.agentId}`} className="font-semibold text-slate-200 hover:text-white w-32 truncate shrink-0">
              {r.agentName}
            </a>
            <span className="text-slate-400 text-xs font-mono">{r.action}</span>
            <span className="text-slate-500 text-xs font-mono">
              tx: {shortAddr(r.txHash)}
            </span>
            {r.validationTxHash && (
              <a
                href={`https://sepolia.mantlescan.xyz/tx/${r.validationTxHash}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300 ml-auto shrink-0"
              >
                verdict ↗
              </a>
            )}
            <span className="text-slate-600 text-xs ml-2 shrink-0">{timeAgo(r.createdAt)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const agents   = getLeaderboardData()
  const feed     = getVerificationFeed(15)

  return (
    <>
      <div>
        <h1 className="text-4xl font-bold text-white tracking-tight">The Arena</h1>
        <p className="text-slate-400 mt-1">
          Real trades · Chain-verified claims · Tamper-proof reputation
        </p>
      </div>

      <HumanVsAI />
      <Leaderboard agents={agents} />
      <VerificationFeed receipts={feed} />
    </>
  )
}
