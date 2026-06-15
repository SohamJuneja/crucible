'use client'

import { useState, useRef, useEffect } from 'react'
import type { VerificationResult } from '@crucible/core'

// ── Types ─────────────────────────────────────────────────────────────────────

interface FormState {
  txHash:       string
  agentAddress: string
  action:       string
  tokenIn:      string
  tokenOut:     string
  amountIn:     string
  amountOut:    string
}

// Discriminated union keeps all async state in one place
type Phase =
  | { status: 'idle' }
  | { status: 'verifying' }
  | { status: 'explaining'; result: VerificationResult }
  | { status: 'typing';    result: VerificationResult; explanation: string; typed: string }
  | { status: 'done';      result: VerificationResult; explanation: string }
  | { status: 'error';     message: string }


// ── Verdict metadata ──────────────────────────────────────────────────────────

const VERDICT_META = {
  VERIFIED:     { bg: 'bg-teal-950/60',  text: 'text-teal-300',  border: 'border-teal-700/50',  ring: '#22D9C8', icon: '✓' },
  EXAGGERATED:  { bg: 'bg-amber-950/60', text: 'text-amber-300', border: 'border-amber-700/50', ring: '#F59E0B', icon: '≈' },
  FALSE_CLAIM:  { bg: 'bg-red-950/60',   text: 'text-red-300',   border: 'border-red-700/50',   ring: '#EF4444', icon: '🚨' },
  UNVERIFIABLE: { bg: 'bg-slate-800/60', text: 'text-slate-400', border: 'border-slate-700/40', ring: '#64748B', icon: '?' },
} as const

type VerdictKey = keyof typeof VERDICT_META

// ── Utility helpers ───────────────────────────────────────────────────────────

function shortAddr(s?: string) {
  if (!s) return '—'
  return `${s.slice(0, 6)}…${s.slice(-4)}`
}

function fmtAmount(s?: string) {
  if (!s) return '—'
  return s.length > 18 ? `${s.slice(0, 10)}…${s.slice(-6)}` : s
}

// ── Sub-components ────────────────────────────────────────────────────────────

function InputField({
  id, label, hint, placeholder, value, onChange,
}: {
  id:          string
  label:       string
  hint?:       string
  placeholder: string
  value:       string
  onChange:    (v: string) => void
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-400 mb-1.5" htmlFor={id}>
        {label}
        {hint && <span className="ml-1.5 text-slate-600 font-normal">{hint}</span>}
      </label>
      <input
        id={id}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full font-mono text-sm bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-2.5 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-[#22D9C8]/50 focus:ring-1 focus:ring-[#22D9C8]/20 transition-colors"
      />
    </div>
  )
}

function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`animate-spin motion-reduce:animate-none ${className}`} fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function TruthRing({ score, verdict }: { score: number; verdict: string }) {
  const r    = 36
  const cx   = 44
  const cy   = 44
  const circ = 2 * Math.PI * r
  const off  = circ * (1 - score)
  const pct  = Math.round(score * 100)
  const meta = VERDICT_META[(verdict as VerdictKey)] ?? VERDICT_META.UNVERIFIABLE
  return (
    <svg
      width="88" height="88"
      role="meter"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Truth score: ${pct}%`}
      className="shrink-0"
    >
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e293b" strokeWidth="8" />
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke={meta.ring}
        strokeWidth="8"
        strokeDasharray={String(circ)}
        strokeDashoffset={off}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize="14" fontWeight="bold" fill={meta.ring} fontFamily="monospace">
        {pct}%
      </text>
      <text x={cx} y={cy + 11} textAnchor="middle" fontSize="8" fill="#64748b" fontFamily="monospace" letterSpacing="1">
        TRUTH
      </text>
    </svg>
  )
}

function DiffRow({ label, claimed, actual, match }: {
  label:    string
  claimed?: string
  actual?:  string
  match?:   boolean
}) {
  const icon  = match === undefined ? '—'  : match ? '✓'           : '✗'
  const color = match === undefined ? 'text-slate-600' : match ? 'text-teal-400' : 'text-red-400'
  return (
    <tr className="border-b border-slate-800/30 last:border-0 hover:bg-slate-800/20 transition-colors">
      <td className="px-5 py-2.5 text-xs font-mono text-slate-500 whitespace-nowrap">{label}</td>
      <td className="px-3 py-2.5 text-xs font-mono text-slate-300">{claimed ?? '—'}</td>
      <td className="px-3 py-2.5 text-xs font-mono text-slate-300">{actual  ?? '—'}</td>
      <td className={`px-3 py-2.5 text-xs font-bold ${color}`}>{icon}</td>
    </tr>
  )
}

// ── Result panel ──────────────────────────────────────────────────────────────

function ResultPanel({ phase, form }: { phase: Phase; form: FormState }) {
  if (phase.status === 'error') {
    return (
      <div className="rounded-xl border border-red-800/50 bg-red-950/20 p-5 animate-fade-up motion-reduce:animate-none">
        <p className="text-sm text-red-400 font-mono">{phase.message}</p>
      </div>
    )
  }

  if (
    phase.status !== 'explaining' &&
    phase.status !== 'typing' &&
    phase.status !== 'done'
  ) return null

  const result  = phase.result
  const meta    = VERDICT_META[(result.verdict as VerdictKey)] ?? VERDICT_META.UNVERIFIABLE
  const txError = result.reasons.includes('tx_not_found') || result.reasons.includes('tx_reverted')

  // What to show in the explanation slot
  const isAiLoading   = phase.status === 'explaining'
  const isTyping      = phase.status === 'typing'
  const visibleText   = phase.status === 'typing' ? phase.typed
                      : phase.status === 'done'   ? phase.explanation
                      : null

  return (
    <div className="space-y-4 animate-fade-up motion-reduce:animate-none">
      {/* Header: truth ring + verdict badge */}
      <div className="rounded-xl border border-slate-800/60 bg-slate-900/60 p-5">
        <div className="flex items-start gap-5">
          <TruthRing score={result.truthScore} verdict={result.verdict} />

          <div className="flex-1 min-w-0 space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded border px-3 py-1 text-sm font-mono font-semibold ${meta.bg} ${meta.text} ${meta.border}`}
                role="status"
              >
                <span aria-hidden="true">{meta.icon}</span>
                <span>{result.verdict.replace('_', ' ')}</span>
              </span>
              {result.derived.protocol && (
                <span className="text-xs font-mono text-slate-500 bg-slate-800/60 px-2 py-0.5 rounded">
                  {result.derived.protocol}
                </span>
              )}
              {result.derived.txExists && (
                <a
                  href={`https://mantlescan.xyz/tx/${form.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-mono text-[#22D9C8]/60 hover:text-[#22D9C8] transition-colors ml-auto shrink-0"
                  aria-label="View transaction on Mantlescan (opens in new tab)"
                >
                  view tx ↗
                </a>
              )}
            </div>

            {result.reasons.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {result.reasons.map(r => (
                  <span key={r} className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800/70 text-slate-500">
                    {r}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* AI explanation slot — always present once chain result arrives */}
        <div className="mt-4 pt-4 border-t border-slate-800/50 min-h-[3.5rem]">
          {isAiLoading && (
            <div className="flex items-center gap-2.5" role="status" aria-live="polite">
              <Spinner className="w-3.5 h-3.5 text-[#22D9C8]/70" />
              <span className="text-xs font-mono text-slate-500 tracking-wide">
                🤖 AI is analyzing the verdict<span className="animate-pulse">…</span>
              </span>
            </div>
          )}
          {(isTyping || phase.status === 'done') && visibleText !== null && (
            <p className="text-sm text-slate-300 leading-relaxed">
              {visibleText}
              {isTyping && (
                <span
                  className="inline-block w-0.5 h-3.5 bg-[#22D9C8] ml-0.5 align-middle animate-pulse motion-reduce:hidden"
                  aria-hidden="true"
                />
              )}
            </p>
          )}
        </div>
      </div>

      {/* Claimed vs Chain diff table */}
      {!txError && (
        <div className="rounded-xl border border-slate-800/60 bg-slate-900/50 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-800/50">
            <h3 className="text-sm font-semibold text-slate-300">Claimed vs Chain State</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Claimed vs chain state comparison">
              <thead>
                <tr className="border-b border-slate-800/40">
                  {['Field', 'Claimed', 'Chain State', ''].map(h => (
                    <th key={h} className="px-5 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider first:pl-5">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <DiffRow
                  label="tokenIn"
                  claimed={shortAddr(form.tokenIn)}
                  actual={shortAddr(result.derived.actualTokenIn)}
                  match={result.derived.actualTokenIn
                    ? form.tokenIn.toLowerCase() === result.derived.actualTokenIn.toLowerCase()
                    : undefined}
                />
                <DiffRow
                  label="tokenOut"
                  claimed={shortAddr(form.tokenOut)}
                  actual={shortAddr(result.derived.actualTokenOut)}
                  match={result.derived.actualTokenOut
                    ? form.tokenOut.toLowerCase() === result.derived.actualTokenOut.toLowerCase()
                    : undefined}
                />
                <DiffRow
                  label="amountIn"
                  claimed={fmtAmount(form.amountIn)}
                  actual={fmtAmount(result.derived.actualAmountIn)}
                  match={result.derived.actualAmountIn
                    ? form.amountIn === result.derived.actualAmountIn
                    : undefined}
                />
                <DiffRow
                  label="amountOut"
                  claimed={fmtAmount(form.amountOut)}
                  actual={fmtAmount(result.derived.actualAmountOut)}
                  match={result.derived.actualAmountOut
                    ? form.amountOut === result.derived.actualAmountOut
                    : undefined}
                />
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main form ─────────────────────────────────────────────────────────────────

const BLANK: FormState = {
  txHash:       '',
  agentAddress: '',
  action:       'swap',
  tokenIn:      '',
  tokenOut:     '',
  amountIn:     '',
  amountOut:    '',
}

const TYPEWRITER_MS = 22   // ms per character; ~150 chars ≈ 3.3s of visible typing

export default function VerifyForm() {
  const [form,  setForm]  = useState<FormState>(BLANK)
  const [phase, setPhase] = useState<Phase>({ status: 'idle' })
  const timerRef          = useRef<ReturnType<typeof setInterval> | null>(null)

  // Clean up typewriter on unmount
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current) }, [])

  function set(key: keyof FormState, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function startTypewriter(result: VerificationResult, explanation: string) {
    if (timerRef.current) clearInterval(timerRef.current)

    // Respect prefers-reduced-motion — skip animation
    const reduced = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setPhase({ status: 'done', result, explanation })
      return
    }

    let i = 0
    setPhase({ status: 'typing', result, explanation, typed: '' })

    timerRef.current = setInterval(() => {
      i++
      setPhase({ status: 'typing', result, explanation, typed: explanation.slice(0, i) })
      if (i >= explanation.length) {
        clearInterval(timerRef.current!)
        timerRef.current = null
        setPhase({ status: 'done', result, explanation })
      }
    }, TYPEWRITER_MS)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    setPhase({ status: 'verifying' })

    try {
      const res = await fetch('/api/verify', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(form),
      })

      // Non-streaming error (validation failure before the stream started)
      const contentType = res.headers.get('content-type') ?? ''
      if (contentType.includes('application/json')) {
        const err = await res.json() as { error?: string }
        setPhase({ status: 'error', message: err.error ?? 'Unknown error' })
        return
      }

      if (!res.body) throw new Error('No response body')

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let   buffer  = ''
      let   chainResult: VerificationResult | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          const event = JSON.parse(line) as
            | { type: 'result';      result:  VerificationResult }
            | { type: 'explanation'; explanation: string }
            | { type: 'error';       message: string }

          if (event.type === 'result') {
            chainResult = event.result
            // Show chain result + AI spinner immediately
            setPhase({ status: 'explaining', result: event.result })
          } else if (event.type === 'explanation') {
            if (chainResult) {
              startTypewriter(chainResult, event.explanation)
            }
          } else if (event.type === 'error') {
            setPhase({ status: 'error', message: event.message })
          }
        }
      }
    } catch (err) {
      setPhase({
        status:  'error',
        message: err instanceof Error ? err.message : 'Network error',
      })
    }
  }

  const isLoading = phase.status === 'verifying' || phase.status === 'explaining' || phase.status === 'typing'

  return (
    <div className="space-y-6">
      {/* Input form */}
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-slate-800/60 bg-slate-900/50 p-6 space-y-5"
        aria-label="Claim verification form"
      >
        {/* txHash */}
        <div>
          <label className="block text-xs font-semibold text-slate-400 mb-1.5" htmlFor="txHash">
            Transaction Hash <span className="text-red-500" aria-label="required">*</span>
          </label>
          <input
            id="txHash"
            type="text"
            required
            placeholder="0x…"
            value={form.txHash}
            onChange={e => set('txHash', e.target.value)}
            className="w-full font-mono text-sm bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-2.5 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-[#22D9C8]/50 focus:ring-1 focus:ring-[#22D9C8]/20 transition-colors"
          />
        </div>

        {/* agentAddress + action */}
        <div className="grid sm:grid-cols-2 gap-4">
          <InputField
            id="agentAddress"
            label="Agent Wallet Address"
            hint="(tx sender)"
            placeholder="0x…"
            value={form.agentAddress}
            onChange={v => set('agentAddress', v)}
          />
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5" htmlFor="action">
              Action Type
            </label>
            <select
              id="action"
              value={form.action}
              onChange={e => set('action', e.target.value)}
              className="w-full font-mono text-sm bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-2.5 text-slate-200 focus:outline-none focus:border-[#22D9C8]/50 focus:ring-1 focus:ring-[#22D9C8]/20 transition-colors"
            >
              <option value="swap">swap</option>
              <option value="lendDeposit">lendDeposit</option>
            </select>
          </div>
        </div>

        {/* tokenIn + tokenOut */}
        <div className="grid sm:grid-cols-2 gap-4">
          <InputField
            id="tokenIn"
            label="Claimed Token In"
            placeholder="0x…"
            value={form.tokenIn}
            onChange={v => set('tokenIn', v)}
          />
          <InputField
            id="tokenOut"
            label="Claimed Token Out"
            placeholder="0x…"
            value={form.tokenOut}
            onChange={v => set('tokenOut', v)}
          />
        </div>

        {/* amountIn + amountOut */}
        <div className="grid sm:grid-cols-2 gap-4">
          <InputField
            id="amountIn"
            label="Claimed Amount In"
            hint="(base units)"
            placeholder="e.g. 50000000000000000000"
            value={form.amountIn}
            onChange={v => set('amountIn', v)}
          />
          <InputField
            id="amountOut"
            label="Claimed Amount Out"
            hint="(base units)"
            placeholder="e.g. 470002053220261512021"
            value={form.amountOut}
            onChange={v => set('amountOut', v)}
          />
        </div>

        {/* Submit + inline loading status */}
        <div className="flex flex-wrap items-center gap-4 pt-1">
          <button
            type="submit"
            disabled={isLoading || !form.txHash.startsWith('0x')}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#22D9C8] text-[#0C1117] font-semibold text-sm hover:bg-teal-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isLoading ? (
              <>
                <Spinner className="w-4 h-4" />
                {phase.status === 'verifying'  ? 'Fetching chain state…'       : null}
                {phase.status === 'explaining' ? 'AI generating…'              : null}
                {phase.status === 'typing'     ? 'Done'                        : null}
              </>
            ) : 'Verify Claim →'}
          </button>

          {/* Contextual status hint beside the button */}
          {phase.status === 'verifying' && (
            <span className="text-xs font-mono text-slate-500 animate-pulse">
              ⛓ Querying Mantle mainnet…
            </span>
          )}
          {phase.status === 'explaining' && (
            <span className="text-xs font-mono text-[#22D9C8]/60 animate-pulse">
              🤖 Asking AI to explain the verdict…
            </span>
          )}
          {phase.status === 'idle' && (
            <span className="text-xs text-slate-600 font-mono">Mantle mainnet · read-only</span>
          )}
        </div>
      </form>

      {/* Result (renders as soon as chain data arrives, explanation types in afterwards) */}
      <ResultPanel phase={phase} form={form} />
    </div>
  )
}
