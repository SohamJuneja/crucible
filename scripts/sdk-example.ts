/**
 * sdk-example.ts — live end-to-end demo of @crucible/sdk against Mantle Sepolia.
 *
 * 1. Generates a fresh agent wallet
 * 2. Funds it from the verifier wallet (infrastructure — not part of the SDK)
 * 3. Registers the agent with CrucibleClient.registerAgent()
 * 4. Executes a real MockDEX swap (infrastructure — SDK is claim-layer, not trading layer)
 * 5. Submits a truthful claim with CrucibleClient.submitClaim()
 * 6. Reads reputation with CrucibleClient.getReputation()
 *
 * Usage: npm run sdk:example   (requires .env + make:fixtures already run)
 */
import 'dotenv/config'
import { createPublicClient, createWalletClient, http, parseEther } from 'viem'
import { mantleSepoliaTestnet } from 'viem/chains'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { getWalletClient } from '@crucible/core'
import { CrucibleClient } from '@crucible/sdk'
import type { AgentClaim } from '@crucible/core'
import fixtures from '../packages/engine/src/__tests__/fixtures.json'

// ── Inline ABIs (infrastructure helpers, not part of the SDK) ─────────────────

const ERC20_ABI = [
  { name: 'mint',    type: 'function' as const, stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { name: 'approve', type: 'function' as const, stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
] as const

const DEX_ABI = [
  { name: 'swap', type: 'function' as const, stateMutability: 'nonpayable', inputs: [{ name: 'tokenIn', type: 'address' }, { name: 'amountIn', type: 'uint256' }, { name: 'tokenOut', type: 'address' }], outputs: [{ name: 'amountOut', type: 'uint256' }] },
] as const

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const AMOUNT_IN      = 1n * 10n ** 17n   // 0.1 tokenA — tiny
const TOKEN_A        = fixtures.tokenA as `0x${string}`
const TOKEN_B        = fixtures.tokenB as `0x${string}`
const DEX            = fixtures.dex    as `0x${string}`
const RPC_URL        = process.env.MANTLE_RPC_URL ?? 'https://rpc.sepolia.mantle.xyz'

// ── Helpers ────────────────────────────────────────────────────────────────────

const publicClient = createPublicClient({ chain: mantleSepoliaTestnet, transport: http(RPC_URL) })

async function sendTx(wallet: ReturnType<typeof createWalletClient>, params: object, label: string): Promise<`0x${string}`> {
  process.stdout.write(`  ${label}...`)
  let hash: `0x${string}`
  try   { hash = await wallet.writeContract(params as never) }
  catch { hash = await wallet.writeContract(Object.assign({}, params, { gas: 300_000n }) as never) }
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${label} reverted: ${hash}`)
  console.log(` ✓`)
  return hash
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  if (fixtures.honestSwap.txHash.startsWith('0x0000')) {
    console.error('fixtures.json is a placeholder — run: npm run make:fixtures first')
    process.exit(1)
  }

  // 1. Fresh agent wallet (each run is a new identity — demonstrates SDK onboarding)
  const agentPrivateKey = generatePrivateKey()
  const agentAccount    = privateKeyToAccount(agentPrivateKey)
  console.log(`\n── SDK Example ──────────────────────────────────────────`)
  console.log(`Agent wallet : ${agentAccount.address}`)

  // 2. Fund agent (infrastructure — SDK caller's responsibility)
  const verifier     = getWalletClient()
  const agentWallet  = createWalletClient({ account: agentAccount, chain: mantleSepoliaTestnet, transport: http(RPC_URL) })
  console.log(`Verifier     : ${verifier.account.address}`)
  console.log('\nFunding agent...')
  let fundHash: `0x${string}`
  try   { fundHash = await verifier.sendTransaction({ to: agentAccount.address, value: parseEther('1'), gas: 21_000n }) }
  catch { fundHash = await verifier.sendTransaction({ to: agentAccount.address, value: parseEther('1') }) }
  await publicClient.waitForTransactionReceipt({ hash: fundHash })
  console.log(`  funded ✓  ${fundHash}`)

  // 3. Register agent via SDK ── the one-liner any external team would write
  console.log('\nRegistering agent...')
  const client          = new CrucibleClient({ agentPrivateKey })
  const { agentId, txHash: regTx } = await client.registerAgent({ name: 'SDK Demo Agent', description: 'Live sdk-example.ts run' })
  console.log(`  agentId=${agentId}  tx=${regTx}`)

  // 4. Execute a real swap (infrastructure)
  console.log('\nExecuting swap...')
  await sendTx(agentWallet, { address: TOKEN_A, abi: ERC20_ABI, functionName: 'mint',    args: [agentAccount.address, AMOUNT_IN] }, 'mint tokenA')
  await sendTx(agentWallet, { address: TOKEN_A, abi: ERC20_ABI, functionName: 'approve', args: [DEX, AMOUNT_IN] },                  'approve DEX')
  const swapHash = await sendTx(agentWallet, { address: DEX, abi: DEX_ABI, functionName: 'swap', args: [TOKEN_A, AMOUNT_IN, TOKEN_B] }, 'swap')

  // Derive actual amountOut from Transfer events (chain-derived, not assumed)
  const swapReceipt  = await publicClient.getTransactionReceipt({ hash: swapHash })
  const outLog       = swapReceipt.logs.find(
    l => l.address.toLowerCase() === TOKEN_B.toLowerCase() &&
         l.topics[0]?.toLowerCase() === TRANSFER_TOPIC &&
         l.topics[2]?.slice(-40).toLowerCase() === agentAccount.address.slice(2).toLowerCase(),
  )
  const actualAmountOut = outLog ? BigInt(outLog.data) : AMOUNT_IN * 2n
  console.log(`  swap tx: ${swapHash}  amountOut=${actualAmountOut}`)

  // 5. Submit truthful claim via SDK ── exact match → VERIFIED
  console.log('\nSubmitting claim via SDK...')
  const claim: AgentClaim = {
    agentId,
    agentAddress: agentAccount.address,
    action:       'swap',
    txHash:       swapHash,
    params: {
      tokenIn:   TOKEN_A,
      tokenOut:  TOKEN_B,
      amountIn:  AMOUNT_IN.toString(),
      amountOut: actualAmountOut.toString(),
    },
    timestamp: new Date().toISOString(),
  }
  const result = await client.submitClaim(claim)

  // 6. Read reputation via SDK
  const score = await client.getReputation(agentId)

  // ── Results ─────────────────────────────────────────────────────────────────
  console.log('\n── Results ──────────────────────────────────────────────')
  console.log(`  agentId   : ${agentId}`)
  console.log(`  verdict   : ${result.verdict}`)
  console.log(`  truthScore: ${result.truthScore.toFixed(3)}`)
  console.log(`  score     : ${score.toFixed(2)}/100`)
  console.log(`  explorer  : https://sepolia.mantlescan.xyz/tx/${swapHash}`)
}

main().catch(err => { console.error(err); process.exit(1) })
