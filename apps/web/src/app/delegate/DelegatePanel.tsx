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

// ── Score helpers ──────────────────────────────────────────────────────────────

function scoreColor(s: number, minScore: number) {
  if (s >= minScore) return 'text-green-400'
  if (s >= minScore * 0.75) return 'text-amber-400'
  return 'text-red-400'
}

// ── Agent card ─────────────────────────────────────────────────────────────────

function AgentCard({
  agent,
  minScore,
  vaultAddress,
}: {
  agent:        AgentData
  minScore:     number
  vaultAddress: string | null
}) {
  const [amount, setAmount] = useState('0.001')
  const [status, setStatus] = useState<'idle' | 'pending' | 'done' | 'error'>('idle')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState('')

  const above = agent.score >= minScore

  async function handleDelegate() {
    if (!vaultAddress) { setErrMsg('Vault not deployed yet — run: npm run deploy:vault'); setStatus('error'); return }

    const eth = getEthereum()
    if (!eth) { setErrMsg('MetaMask not found — install the MetaMask browser extension'); setStatus('error'); return }

    setStatus('pending')
    setErrMsg('')

    try {
      await switchToMantle(eth)

      const accounts = await eth.request({ method: 'eth_requestAccounts' }) as string[]
      const from = accounts[0]
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
    <div className={`rounded-xl border p-5 transition-colors ${
      above
        ? 'border-slate-700 bg-slate-900 hover:border-slate-600'
        : 'border-red-900/40 bg-red-950/10 opacity-70'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="font-semibold text-slate-200">{agent.name}</div>
          <div className="text-xs text-slate-500 font-mono mt-0.5">
            {agent.address.slice(0, 8)}…{agent.address.slice(-6)}
          </div>
          <span className={`mt-1 inline-block text-xs px-2 py-0.5 rounded-full border font-mono ${
            agent.cohort === 'ai'
              ? 'bg-blue-950 text-blue-300 border-blue-900'
              : 'bg-purple-950 text-purple-300 border-purple-900'
          }`}>
            {agent.cohort === 'ai' ? '🤖 AI' : '👤 Human'}
          </span>
        </div>
        <div className="text-right shrink-0">
          <span className={`text-2xl font-bold font-mono ${scoreColor(agent.score, minScore)}`}>
            {agent.score.toFixed(1)}
          </span>
          <div className="text-xs text-slate-500">/ 100</div>
        </div>
      </div>

      {/* Stats */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 mb-4">
        <span>✓ {agent.verifiedCount} verified</span>
        <span>≈ {agent.exaggeratedCount} exaggerated</span>
        {agent.falseClaimCount > 0 && (
          <span className="text-red-400 font-bold">🚨 {agent.falseClaimCount} false</span>
        )}
        <span>{(agent.truthfulness * 100).toFixed(0)} % truthful</span>
      </div>

      {/* Action */}
      {above ? (
        <>
          <div className="flex gap-2">
            <div className="flex items-center gap-1.5 flex-1">
              <input
                type="number"
                min="0.0001"
                step="0.001"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                disabled={status === 'pending'}
                className="w-28 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 focus:border-blue-500 focus:outline-none font-mono"
              />
              <span className="text-xs text-slate-500">MNT</span>
            </div>
            <button
              onClick={handleDelegate}
              disabled={status === 'pending' || !vaultAddress}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {status === 'pending' ? 'Pending…' : 'Delegate'}
            </button>
          </div>
          {status === 'done' && txHash && (
            <div className="mt-2 text-xs text-green-400">
              ✅ Delegated!{' '}
              <a
                href={`https://sepolia.mantlescan.xyz/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
                className="text-blue-400 hover:text-blue-300 underline"
              >
                View tx ↗
              </a>
            </div>
          )}
          {status === 'error' && errMsg && (
            <div className="mt-2 text-xs text-red-400 break-words">⚠ {errMsg}</div>
          )}
        </>
      ) : (
        <div className="flex items-center gap-2 text-xs text-red-400 border border-red-900/40 rounded-lg px-3 py-2 bg-red-950/20">
          <span>🔒</span>
          <span>
            Below reputation threshold ({minScore.toFixed(2)}) — delegation blocked on-chain
          </span>
        </div>
      )}
    </div>
  )
}

// ── Panel ──────────────────────────────────────────────────────────────────────

export default function DelegatePanel({
  agents,
  minScore,
  vaultAddress,
}: {
  agents:       AgentData[]
  minScore:     number
  vaultAddress: string | null
}) {
  if (agents.length === 0) {
    return (
      <div className="text-center py-16 text-slate-500 text-sm">
        No agents yet. Run <code className="text-slate-300">npm run seed</code> to populate the Arena.
      </div>
    )
  }

  const eligible = agents.filter(a => a.score >= minScore)
  const blocked  = agents.filter(a => a.score <  minScore)

  return (
    <div className="space-y-8">
      {eligible.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
            <span className="text-green-400">✓</span>
            Eligible for Delegation
            <span className="text-sm font-normal text-slate-500">
              (score ≥ {minScore.toFixed(2)})
            </span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {eligible.map(a => (
              <AgentCard key={a.agentId} agent={a} minScore={minScore} vaultAddress={vaultAddress} />
            ))}
          </div>
        </section>
      )}

      {blocked.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-slate-500 mb-3 flex items-center gap-2">
            <span>🔒</span>
            Below Reputation Threshold
            <span className="text-sm font-normal text-slate-600">
              (score &lt; {minScore.toFixed(2)})
            </span>
          </h2>
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
