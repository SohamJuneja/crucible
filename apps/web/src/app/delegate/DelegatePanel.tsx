'use client'

import { useState } from 'react'
import { encodeFunctionData, parseAbi, parseEther } from 'viem'
import type { AgentData } from '@/lib/data'

// ── ABI ───────────────────────────────────────────────────────────────────────

const VAULT_ABI = parseAbi([
  'function delegate(uint256 agentId) payable',
])

// ── Ethereum provider types ────────────────────────────────────────────────────

interface EthProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
}

function getEthereum(): EthProvider | null {
  if (typeof window === 'undefined') return null
  return ((window as unknown as Record<string, unknown>).ethereum as EthProvider) ?? null
}

async function switchToMantle(eth: EthProvider): Promise<void> {
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x138B' }] })
  } catch {
    await eth.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId:           '0x138B',
        chainName:         'Mantle Sepolia Testnet',
        rpcUrls:           ['https://rpc.sepolia.mantle.xyz'],
        nativeCurrency:    { name: 'MNT', symbol: 'MNT', decimals: 18 },
        blockExplorerUrls: ['https://sepolia.mantlescan.xyz'],
      }],
    })
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreColor(s: number, min: number) {
  if (s >= min)        return 'text-[#22D9C8]'
  if (s >= min * 0.75) return 'text-amber-400'
  return 'text-red-400'
}

// ── Single agent card ─────────────────────────────────────────────────────────

function AgentCard({
  agent, minScore, vaultAddress,
}: {
  agent:        AgentData
  minScore:     number
  vaultAddress: string | null
}) {
  const [amount, setAmount] = useState('0.001')
  const [status, setStatus] = useState<'idle' | 'pending' | 'done' | 'error'>('idle')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState('')

  const eligible = agent.score >= minScore

  async function handleDelegate() {
    if (!vaultAddress) {
      setErrMsg('Vault not deployed — run: npm run deploy:vault')
      setStatus('error')
      return
    }
    const eth = getEthereum()
    if (!eth) {
      setErrMsg('MetaMask not found — install the MetaMask browser extension')
      setStatus('error')
      return
    }
    setStatus('pending')
    setErrMsg('')
    try {
      await switchToMantle(eth)
      const accounts = await eth.request({ method: 'eth_requestAccounts' }) as string[]
      const from     = accounts[0]
      if (!from) throw new Error('No wallet account connected')

      const weiHex = '0x' + parseEther(amount).toString(16)
      const data   = encodeFunctionData({
        abi:          VAULT_ABI,
        functionName: 'delegate',
        args:         [BigInt(agent.agentId)],
      })

      const hash = await eth.request({
        method: 'eth_sendTransaction',
        params: [{ from, to: vaultAddress, value: weiHex, data }],
      }) as string

      setTxHash(hash)
      setStatus('done')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrMsg(msg.length > 120 ? msg.slice(0, 120) + '…' : msg)
      setStatus('error')
    }
  }

  return (
    <article
      className={[
        'rounded-xl border p-5 transition-colors flex flex-col gap-4',
        eligible
          ? 'border-slate-700/50 bg-slate-900/50 hover:border-[#22D9C8]/30'
          : 'border-red-900/25 bg-red-950/5 opacity-60',
      ].join(' ')}
      aria-label={`${agent.name} — ${eligible ? 'eligible for delegation' : 'below threshold'}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="font-semibold text-slate-200 truncate">{agent.name}</div>
          <div className="text-xs text-slate-600 font-mono mt-0.5">
            {agent.address.slice(0, 8)}…{agent.address.slice(-6)}
          </div>
          <span
            className={`mt-1.5 inline-block text-xs px-2 py-0.5 rounded-full border font-mono ${
              agent.cohort === 'ai'
                ? 'bg-teal-950/50 text-teal-300 border-teal-900/60'
                : 'bg-purple-950/50 text-purple-300 border-purple-900/60'
            }`}
          >
            {agent.cohort === 'ai' ? '🤖 AI' : '👤 Human'}
          </span>
        </div>

        <div className="text-right shrink-0">
          <span
            className={`text-2xl font-bold font-mono ${scoreColor(agent.score, minScore)}`}
            title={`Reputation score: ${agent.score.toFixed(2)} / 100`}
          >
            {agent.score.toFixed(1)}
          </span>
          <div className="text-xs text-slate-600 font-mono">/ 100</div>
        </div>
      </div>

      {/* Stats */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-mono">
        <span className="text-teal-400">✓ {agent.verifiedCount} verified</span>
        <span className="text-amber-400/70">≈ {agent.exaggeratedCount} exaggerated</span>
        {agent.falseClaimCount > 0 && (
          <span className="text-red-400 font-bold">🚨 {agent.falseClaimCount} false</span>
        )}
        <span className="text-slate-500">{(agent.truthfulness * 100).toFixed(0)}% truthful</span>
      </div>

      {/* Action */}
      {eligible ? (
        <div className="space-y-2.5">
          <div className="flex gap-2">
            <label className="flex items-center gap-1.5 flex-1">
              <span className="sr-only">Amount in MNT</span>
              <input
                type="number"
                min="0.0001"
                step="0.001"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                disabled={status === 'pending'}
                aria-label="Amount to delegate in MNT"
                className="w-28 rounded-lg border border-slate-700/60 bg-slate-800/60 px-3 py-1.5 text-sm text-slate-200 font-mono focus:border-[#22D9C8]/50 focus:outline-none transition-colors disabled:opacity-50"
              />
              <span className="text-xs text-slate-500 font-mono">MNT</span>
            </label>
            <button
              onClick={handleDelegate}
              disabled={status === 'pending' || !vaultAddress}
              aria-label={`Delegate ${amount} MNT to ${agent.name}`}
              className="rounded-lg bg-[#22D9C8] px-4 py-1.5 text-sm font-semibold text-[#0C1117] hover:bg-[#1bc8b8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {status === 'pending' ? 'Pending…' : 'Delegate'}
            </button>
          </div>

          {status === 'done' && txHash && (
            <div className="flex items-center gap-2 text-xs text-teal-400 font-mono">
              <span>✅ Delegated!</span>
              <a
                href={`https://sepolia.mantlescan.xyz/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-teal-300 transition-colors"
              >
                View tx ↗
              </a>
            </div>
          )}
          {status === 'error' && errMsg && (
            <div className="text-xs text-red-400 font-mono break-words" role="alert">⚠ {errMsg}</div>
          )}
        </div>
      ) : (
        <div
          className="flex items-center gap-2 text-xs text-red-400/80 border border-red-900/30 rounded-lg px-3 py-2.5 bg-red-950/15"
          role="status"
          aria-label={`Delegation blocked: score ${agent.score.toFixed(1)} below required ${minScore.toFixed(0)}`}
        >
          <span aria-hidden="true">🔒</span>
          <span>
            Score {agent.score.toFixed(1)} below threshold {minScore.toFixed(0)} — blocked on-chain
          </span>
        </div>
      )}
    </article>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export default function DelegatePanel({
  agents, minScore, vaultAddress,
}: {
  agents:       AgentData[]
  minScore:     number
  vaultAddress: string | null
}) {
  if (agents.length === 0) {
    return (
      <div className="text-center py-16 text-slate-500 text-sm">
        No agents yet. Run <code className="text-slate-300 font-mono">npm run seed</code> to populate the Arena.
      </div>
    )
  }

  const eligible = agents.filter(a => a.score >= minScore)
  const blocked  = agents.filter(a => a.score <  minScore)

  return (
    <div className="space-y-10">
      {eligible.length > 0 && (
        <section aria-labelledby="eligible-heading">
          <h2 id="eligible-heading" className="text-base font-bold text-white mb-1 flex items-center gap-2">
            <span className="text-teal-400" aria-hidden="true">✓</span>
            Eligible for Delegation
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            Score ≥ {minScore.toFixed(0)} — reputation gate passed. Connect MetaMask to delegate MNT.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {eligible.map(a => (
              <AgentCard key={a.agentId} agent={a} minScore={minScore} vaultAddress={vaultAddress} />
            ))}
          </div>
        </section>
      )}

      {blocked.length > 0 && (
        <section aria-labelledby="blocked-heading">
          <h2 id="blocked-heading" className="text-base font-semibold text-slate-500 mb-1 flex items-center gap-2">
            <span aria-hidden="true">🔒</span>
            Below Reputation Threshold
          </h2>
          <p className="text-xs text-slate-600 mb-4">
            Score &lt; {minScore.toFixed(0)} — delegation blocked on-chain until score improves.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {blocked.map(a => (
              <AgentCard key={a.agentId} agent={a} minScore={minScore} vaultAddress={vaultAddress} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
