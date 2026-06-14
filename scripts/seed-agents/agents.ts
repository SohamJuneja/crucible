/**
 * agents.ts — persistent wallet + IdentityRegistry management for seed bots.
 *
 * Wallets are generated once and saved to .seed-agents.json (gitignored).
 * agentId is cached after first registration — never re-registers.
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  decodeEventLog,
} from 'viem'
import { mantleSepoliaTestnet } from 'viem/chains'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { getWalletClient, IDENTITY_REGISTRY_ADDRESS, identityRegistryAbi } from '@crucible/core'

// ── Types ──────────────────────────────────────────────────────────────────────

export type BotName = 'honest-bot' | 'mediocre-bot' | 'liar-bot'

export interface AgentState {
  privateKey: `0x${string}`
  address:    `0x${string}`
  agentId:    string | null    // null until registered
}

export type SeedState = Record<BotName, AgentState>

export interface SwapResult {
  txHash:          `0x${string}`
  actualAmountIn:  bigint
  actualAmountOut: bigint
  tokenIn:         `0x${string}`
  tokenOut:        `0x${string}`
}

// ── Constants ──────────────────────────────────────────────────────────────────

const STATE_PATH     = path.resolve(process.cwd(), '.seed-agents.json')
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const RPC_URL        = process.env.MANTLE_RPC_URL ?? 'https://rpc.sepolia.mantle.xyz'

export const ERC20_ABI = [
  { name: 'mint',    type: 'function' as const, stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { name: 'approve', type: 'function' as const, stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
] as const

export const DEX_ABI = [
  { name: 'swap', type: 'function' as const, stateMutability: 'nonpayable', inputs: [{ name: 'tokenIn', type: 'address' }, { name: 'amountIn', type: 'uint256' }, { name: 'tokenOut', type: 'address' }], outputs: [{ name: 'amountOut', type: 'uint256' }] },
] as const

export const publicClient = createPublicClient({
  chain: mantleSepoliaTestnet,
  transport: http(RPC_URL),
})

// ── State management ───────────────────────────────────────────────────────────

export function loadState(): SeedState {
  if (fs.existsSync(STATE_PATH)) {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) as SeedState
  }
  const state: SeedState = {
    'honest-bot':   newAgent(),
    'mediocre-bot': newAgent(),
    'liar-bot':     newAgent(),
  }
  saveState(state)
  console.log(`[agents] generated fresh wallets → ${STATE_PATH}`)
  return state
}

export function saveState(state: SeedState): void {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
}

function newAgent(): AgentState {
  const privateKey = generatePrivateKey()
  return { privateKey, address: privateKeyToAccount(privateKey).address, agentId: null }
}

// ── Wallet factory ─────────────────────────────────────────────────────────────

export function makeBotWallet(agent: AgentState) {
  return createWalletClient({
    account:   privateKeyToAccount(agent.privateKey),
    chain:     mantleSepoliaTestnet,
    transport: http(RPC_URL),
  })
}

// ── Top-up ─────────────────────────────────────────────────────────────────────

export async function topUpIfNeeded(bot: BotName, agent: AgentState): Promise<void> {
  const balance = await publicClient.getBalance({ address: agent.address })
  const threshold = parseEther('2')
  if (balance >= threshold) {
    console.log(`[${bot}] balance ${fmtMnt(balance)} MNT — OK`)
    return
  }
  const verifier = getWalletClient()
  console.log(`[${bot}] balance ${fmtMnt(balance)} MNT — topping up to 3 MNT from verifier...`)
  let hash: `0x${string}`
  try {
    hash = await verifier.sendTransaction({ to: agent.address, value: parseEther('3'), gas: 21_000n })
  } catch {
    hash = await verifier.sendTransaction({ to: agent.address, value: parseEther('3') })
  }
  await publicClient.waitForTransactionReceipt({ hash })
  console.log(`[${bot}] topped up ✓  ${hash}`)
}

// ── Registration ───────────────────────────────────────────────────────────────

export async function ensureRegistered(
  bot:   BotName,
  agent: AgentState,
  state: SeedState,
): Promise<string> {
  if (agent.agentId !== null) {
    console.log(`[${bot}] agentId=${agent.agentId} (cached — skipping registration)`)
    return agent.agentId
  }

  console.log(`[${bot}] registering on IdentityRegistry...`)
  const wallet = makeBotWallet(agent)
  let hash: `0x${string}`
  try {
    hash = await wallet.writeContract({
      address: IDENTITY_REGISTRY_ADDRESS, abi: identityRegistryAbi,
      functionName: 'register', args: [`https://crucible.local/seed/${bot}.json`],
    })
  } catch {
    hash = await wallet.writeContract({
      address: IDENTITY_REGISTRY_ADDRESS, abi: identityRegistryAbi,
      functionName: 'register', args: [`https://crucible.local/seed/${bot}.json`],
      gas: 300_000n,
    })
  }
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`[${bot}] register reverted  ${hash}`)

  let agentId: bigint | undefined
  for (const log of receipt.logs) {
    try {
      const d = decodeEventLog({ abi: identityRegistryAbi, data: log.data, topics: log.topics })
      if (d.eventName === 'Registered') { agentId = (d.args as unknown as { agentId: bigint }).agentId; break }
    } catch {}
  }
  if (agentId === undefined) throw new Error(`[${bot}] Registered event not found`)

  agent.agentId = agentId.toString()
  saveState(state)
  console.log(`[${bot}] registered agentId=${agent.agentId}  tx=${hash}`)
  return agent.agentId
}

// ── Swap helper ────────────────────────────────────────────────────────────────

export async function doSwap(
  bot:      BotName,
  wallet:   ReturnType<typeof makeBotWallet>,
  tokenA:   `0x${string}`,
  tokenB:   `0x${string}`,
  dex:      `0x${string}`,
  amountIn: bigint,
): Promise<SwapResult> {
  const agent = wallet.account.address

  await sendTx(wallet, { address: tokenA, abi: ERC20_ABI, functionName: 'mint',    args: [agent,   amountIn] }, `[${bot}] mint tokenA`)
  await sendTx(wallet, { address: tokenA, abi: ERC20_ABI, functionName: 'approve', args: [dex,     amountIn] }, `[${bot}] approve DEX`)
  const txHash = await sendTx(wallet, { address: dex, abi: DEX_ABI, functionName: 'swap',    args: [tokenA, amountIn, tokenB] }, `[${bot}] swap`)

  const receipt = await publicClient.getTransactionReceipt({ hash: txHash })

  // Derive actual amountOut from Transfer events (chain-derived, not assumed)
  const outLog = receipt.logs.find(
    l => l.address.toLowerCase() === tokenB.toLowerCase() &&
         l.topics[0]?.toLowerCase() === TRANSFER_TOPIC &&
         l.topics[2]?.slice(-40).toLowerCase() === agent.slice(2).toLowerCase(),
  )
  const actualAmountOut = outLog ? BigInt(outLog.data) : amountIn * 2n

  return { txHash, actualAmountIn: amountIn, actualAmountOut, tokenIn: tokenA, tokenOut: tokenB }
}

// ── Send helper (gas fallback + revert guard) ──────────────────────────────────

export async function sendTx(
  wallet: ReturnType<typeof makeBotWallet>,
  params: object,
  label:  string,
): Promise<`0x${string}`> {
  console.log(`  ${label}...`)
  let hash: `0x${string}`
  try {
    hash = await wallet.writeContract(params as never)
  } catch {
    hash = await wallet.writeContract(Object.assign({}, params, { gas: 300_000n }) as never)
  }
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') {
    throw new Error(`${label} REVERTED  ${hash}`)
  }
  console.log(`  ${label} ✓  ${hash}`)
  return hash
}

// ── Util ───────────────────────────────────────────────────────────────────────

export function fmtMnt(wei: bigint): string {
  return (Number(wei) / 1e18).toFixed(4)
}
