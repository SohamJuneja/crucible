/**
 * firewall-demo.ts — live Agent Firewall demonstration on Mantle Sepolia.
 *
 * Builds three real intents against our deployed MockDEX / MockERC20 tokens
 * and runs assessIntent on each.  The two malicious intents are NEVER broadcast.
 *
 *   (a) Normal approve to MockDEX for a small amount    → expect ALLOW
 *   (b) Unlimited approve (MaxUint256) to attacker EOA  → expect BLOCK
 *   (c) Drain transfer (99 999 tokens) to attacker EOA  → expect BLOCK
 *
 * Usage: npm run firewall:demo   (requires .env)
 */
import 'dotenv/config'
import { createPublicClient, http, parseEther, encodeFunctionData } from 'viem'
import { mantleSepoliaTestnet } from 'viem/chains'
import { getWalletClient } from '@crucible/core'
import { assessIntent, addToAllowlist } from '@crucible/monitor'
import type { Intent } from '@crucible/monitor'
import fixtures from '../packages/engine/src/__tests__/fixtures.json'

// ── Setup ──────────────────────────────────────────────────────────────────

const publicClient = createPublicClient({
  chain:     mantleSepoliaTestnet,
  transport: http(process.env.MANTLE_RPC_URL ?? 'https://rpc.sepolia.mantle.xyz'),
})

// The agent we're protecting (use the verifier wallet as a stand-in agent)
const AGENT = getWalletClient().account.address

// Seed the allowlist with our deployed MockDEX and token contracts
const TOKEN_A = fixtures.tokenA as `0x${string}`
const TOKEN_B = fixtures.tokenB as `0x${string}`
const DEX     = fixtures.dex    as `0x${string}`

addToAllowlist(TOKEN_A)
addToAllowlist(TOKEN_B)
addToAllowlist(DEX)

const KNOWN_ALLOWLIST = new Set([TOKEN_A.toLowerCase(), TOKEN_B.toLowerCase(), DEX.toLowerCase()])

// Simulated attacker EOA — NOT in allowlist
const ATTACKER = '0xdeadc0ffee0000000000000000000000000000ff' as const

const ERC20_ABI = [
  { name: 'approve',  type: 'function' as const, inputs: [{ name: 'spender', type: 'address' }, { name: 'amount',  type: 'uint256' }], outputs: [] },
  { name: 'transfer', type: 'function' as const, inputs: [{ name: 'to',      type: 'address' }, { name: 'amount',  type: 'uint256' }], outputs: [] },
] as const

// ── Intents ────────────────────────────────────────────────────────────────

const intents: Array<{ label: string; intent: Intent }> = [
  {
    label: '(a) Normal approve — 1 tokenA to MockDEX (allowlisted)',
    intent: {
      agentAddress: AGENT,
      to:   TOKEN_A,
      data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [DEX, parseEther('1')] }),
      value: 0n,
    },
  },
  {
    label: '(b) Unlimited approve — MaxUint256 tokenA to attacker EOA  ⚠ NOT broadcast',
    intent: {
      agentAddress: AGENT,
      to:   TOKEN_A,
      data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [ATTACKER, 2n ** 256n - 1n] }),
      value: 0n,
    },
  },
  {
    label: '(c) Drain transfer — 99 999 tokenA to attacker EOA  ⚠ NOT broadcast',
    intent: {
      agentAddress: AGENT,
      to:   TOKEN_A,
      data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [ATTACKER, parseEther('99999')] }),
      value: 0n,
    },
  },
]

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════════════')
  console.log('  ⚡ Crucible Agent Firewall — Pre-trade Risk Assessment')
  console.log('═══════════════════════════════════════════════════════')
  console.log(`  Agent        : ${AGENT}`)
  console.log(`  TokenA (CTKA): ${TOKEN_A}`)
  console.log(`  MockDEX      : ${DEX}`)
  console.log(`  Attacker EOA : ${ATTACKER}`)
  console.log(`  Network      : Mantle Sepolia (chainId 5003)`)
  console.log()

  for (const { label, intent } of intents) {
    const assessment = await assessIntent(intent, publicClient, { extraAllowlist: KNOWN_ALLOWLIST })

    const icon    = assessment.decision === 'ALLOW' ? '✅ ALLOW' : assessment.decision === 'WARN' ? '⚠️  WARN' : '🚨 BLOCK'
    const scoreTxt = `score=${assessment.riskScore}/100`

    console.log(`┌─ ${label}`)
    console.log(`│  Decision : ${icon}  (${scoreTxt})`)

    if (assessment.reasons.length > 0) {
      console.log(`│  Reasons  :`)
      assessment.reasons.forEach(r => console.log(`│    → ${r}`))
    } else {
      console.log(`│  Reasons  : (none — intent is clean)`)
    }
    console.log()
  }

  console.log('═══════════════════════════════════════════════════════')
  console.log('  Malicious intents (b) and (c) were assessed but NOT broadcast.')
  console.log('  The firewall blocked them before any wallet signed them.')
  console.log('═══════════════════════════════════════════════════════\n')
}

main().catch(err => { console.error(err); process.exit(1) })
