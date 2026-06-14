/**
 * ingest-demo.ts — end-to-end Phase 3 smoke test on Mantle Sepolia.
 *
 * Steps (all sequential, await each receipt before next tx):
 *   1.  Generate a fresh demo-agent wallet
 *   2.  Fund it with MNT from the verifier wallet (for gas)
 *   3.  Register agent on canonical IdentityRegistry (signed by agent wallet)
 *   4.  Mint MockERC20(A) tokens to the agent (MockERC20 has no mint access control)
 *   5.  Approve MockDEX to pull tokenA from agent
 *   6.  Execute swap on MockDEX — real tx, real Transfer events
 *   7.  Run ingestClaim → verify → post to ValidationRegistry + ReputationRegistry
 *   8.  Read getSummary from ReputationRegistry and print
 *
 * Usage: npm run ingest:demo   (requires .env + fixtures.json populated by make:fixtures)
 */
import 'dotenv/config'
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  decodeEventLog,
} from 'viem'
import { mantleSepoliaTestnet } from 'viem/chains'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  getWalletClient,
  IDENTITY_REGISTRY_ADDRESS,
  identityRegistryAbi,
  REPUTATION_REGISTRY_ADDRESS,
  reputationRegistryAbi,
} from '@crucible/core'
import { ingestClaim } from '@crucible/indexer'
import type { AgentClaim } from '@crucible/core'
import fixtures from '../packages/engine/src/__tests__/fixtures.json'

// Inline minimal ABIs — avoids depending on deploy-script ABI outputs
const ERC20_ABI = [
  { name: 'mint',    type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
] as const

const DEX_ABI = [
  { name: 'swap', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'tokenIn', type: 'address' }, { name: 'amountIn', type: 'uint256' }, { name: 'tokenOut', type: 'address' }], outputs: [{ name: 'amountOut', type: 'uint256' }] },
] as const

const AMOUNT_IN = 5n * 10n ** 18n  // 5 tokenA (smaller than make:fixtures so DEX still has reserves)

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

// ── helpers ────────────────────────────────────────────────────────────────────

const rpcUrl = process.env.MANTLE_RPC_URL ?? 'https://rpc.sepolia.mantle.xyz'

const publicClient = createPublicClient({
  chain: mantleSepoliaTestnet,
  transport: http(rpcUrl),
})

async function send<T extends object>(
  wc: ReturnType<typeof createWalletClient>,
  params: T,
  label: string,
): Promise<`0x${string}`> {
  console.log(`  [tx] ${label}...`)
  let hash: `0x${string}`
  try {
    hash = await wc.writeContract(params as never)
  } catch {
    hash = await wc.writeContract({ ...(params as never), gas: 300_000n })
  }
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') {
    console.error(`\n🚨 [${label}] TX REVERTED  hash=${hash}  block=${receipt.blockNumber}  gasUsed=${receipt.gasUsed}`)
    throw new Error(`[${label}] transaction reverted: ${hash}`)
  }
  console.log(`  [tx] ${label} confirmed ✓  ${hash}`)
  return hash
}

// ── main ───────────────────────────────────────────────────────────────────────

async function main() {
  if (fixtures.honestSwap.txHash.startsWith('0x0000')) {
    console.error('fixtures.json is still a placeholder — run: npm run make:fixtures first')
    process.exit(1)
  }

  // 1. Generate fresh demo-agent wallet (never reused)
  const agentPrivateKey = generatePrivateKey()
  const agentAccount    = privateKeyToAccount(agentPrivateKey)
  console.log(`\nDemo agent wallet : ${agentAccount.address}`)

  const agentWallet = createWalletClient({
    account:   agentAccount,
    chain:     mantleSepoliaTestnet,
    transport: http(rpcUrl),
  })

  const verifierWallet = getWalletClient()
  console.log(`Crucible verifier : ${verifierWallet.account.address}`)

  // 2. Fund agent from verifier (native MNT for gas)
  console.log('\nFunding demo agent...')
  let fundHash: `0x${string}`
  try {
    fundHash = await verifierWallet.sendTransaction({ to: agentAccount.address, value: parseEther('1'), gas: 21_000n })
  } catch {
    fundHash = await verifierWallet.sendTransaction({ to: agentAccount.address, value: parseEther('1') })
  }
  await publicClient.waitForTransactionReceipt({ hash: fundHash })
  console.log(`  funded: ${fundHash}`)

  // 3. Register agent on canonical IdentityRegistry (signed by agent)
  console.log('\nRegistering agent...')
  let regHash: `0x${string}`
  try {
    regHash = await agentWallet.writeContract({
      address: IDENTITY_REGISTRY_ADDRESS,
      abi: identityRegistryAbi,
      functionName: 'register',
      args: ['https://crucible.local/demo-agent.json'],
    })
  } catch {
    regHash = await agentWallet.writeContract({
      address: IDENTITY_REGISTRY_ADDRESS,
      abi: identityRegistryAbi,
      functionName: 'register',
      args: ['https://crucible.local/demo-agent.json'],
      gas: 300_000n,
    })
  }
  const regReceipt = await publicClient.waitForTransactionReceipt({ hash: regHash })
  console.log(`  register tx: ${regHash}`)

  // Extract agentId from Registered event
  let agentId: bigint | undefined
  for (const log of regReceipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: identityRegistryAbi, data: log.data, topics: log.topics })
      if (decoded.eventName === 'Registered') {
        agentId = (decoded.args as { agentId: bigint }).agentId
        break
      }
    } catch { /* not the Registered event */ }
  }
  if (agentId === undefined) throw new Error('Could not find Registered event — check receipt')
  console.log(`  agentId: ${agentId}`)

  // 4. Mint tokenA to agent (MockERC20.mint has no access control)
  await send(agentWallet, {
    address:      fixtures.tokenA as `0x${string}`,
    abi:          ERC20_ABI,
    functionName: 'mint',
    args:         [agentAccount.address, AMOUNT_IN],
  }, `mint ${AMOUNT_IN} tokenA → agent`)

  // 5. Approve MockDEX to pull tokenA
  await send(agentWallet, {
    address:      fixtures.tokenA as `0x${string}`,
    abi:          ERC20_ABI,
    functionName: 'approve',
    args:         [fixtures.dex as `0x${string}`, AMOUNT_IN],
  }, 'approve DEX for tokenA')

  // 6. Execute swap — real tx, real Transfer events
  console.log('\nExecuting swap...')
  let swapHash: `0x${string}`
  try {
    swapHash = await agentWallet.writeContract({
      address:      fixtures.dex as `0x${string}`,
      abi:          DEX_ABI,
      functionName: 'swap',
      args:         [fixtures.tokenA as `0x${string}`, AMOUNT_IN, fixtures.tokenB as `0x${string}`],
    })
  } catch {
    swapHash = await agentWallet.writeContract({
      address:      fixtures.dex as `0x${string}`,
      abi:          DEX_ABI,
      functionName: 'swap',
      args:         [fixtures.tokenA as `0x${string}`, AMOUNT_IN, fixtures.tokenB as `0x${string}`],
      gas:          300_000n,
    })
  }
  const swapReceipt = await publicClient.waitForTransactionReceipt({ hash: swapHash })
  console.log(`  swap tx: ${swapHash}`)

  // Derive actual amounts from Transfer events (chain-derived)
  const tokenOutLog = swapReceipt.logs.find(
    l => l.address.toLowerCase() === fixtures.tokenB.toLowerCase() &&
         l.topics[0]?.toLowerCase() === TRANSFER_TOPIC &&
         l.topics[2]?.slice(-40).toLowerCase() === agentAccount.address.slice(2).toLowerCase(),
  )
  const actualAmountOut = tokenOutLog ? BigInt(tokenOutLog.data).toString() : (AMOUNT_IN * 2n).toString()
  console.log(`  amountIn=${AMOUNT_IN}  amountOut=${actualAmountOut}`)

  // 7. Build claim and run the full ingest pipeline
  const claim: AgentClaim = {
    agentId:      agentId.toString(),
    agentAddress: agentAccount.address,
    action:       'swap',
    txHash:       swapHash,
    params: {
      tokenIn:   fixtures.tokenA as `0x${string}`,
      tokenOut:  fixtures.tokenB as `0x${string}`,
      amountIn:  AMOUNT_IN.toString(),
      amountOut: actualAmountOut,
    },
    timestamp: new Date().toISOString(),
  }

  console.log('\n── Ingesting claim ──')
  const ingestResult = await ingestClaim(claim, agentPrivateKey)

  // 8. Read back getSummary — must use EXACT same client + tags as giveFeedback wrote
  const FEEDBACK_TAG1  = 'crucible'
  const FEEDBACK_TAG2  = 'score'
  const clientAddress  = verifierWallet.account.address

  console.log('\n── ReputationRegistry.getSummary ──')
  console.log(`  querying: client=${clientAddress} tag1="${FEEDBACK_TAG1}" tag2="${FEEDBACK_TAG2}"`)

  const summary = await publicClient.readContract({
    address:      REPUTATION_REGISTRY_ADDRESS,
    abi:          reputationRegistryAbi,
    functionName: 'getSummary',
    args:         [agentId, [clientAddress], FEEDBACK_TAG1, FEEDBACK_TAG2],
  }) as [bigint, bigint, number]

  const [feedbackCount, summaryValue, summaryDecimals] = summary
  const displayScore = Number(summaryValue) / 10 ** summaryDecimals
  const localScore   = ingestResult.score

  console.log(`  agentId           : ${agentId}`)
  console.log(`  feedback count    : ${feedbackCount}`)
  console.log(`  on-chain score    : ${summaryValue} (dec=${summaryDecimals}) → ${displayScore.toFixed(2)}`)
  console.log(`  local score       : ${localScore.toFixed(2)}/100`)
  console.log(`  scores match      : ${Math.abs(displayScore - localScore) < 0.01 ? '✓ YES' : '✗ NO (delta=' + Math.abs(displayScore - localScore).toFixed(4) + ')'}`)

  console.log(`  verdict           : ${ingestResult.verificationResult.verdict}`)
  console.log(`  validationTx      : ${ingestResult.validationTxHash}`)
  console.log(`  feedbackTx        : ${ingestResult.feedbackTxHash}`)
  console.log(`  evidence          : ${ingestResult.evidenceUri}`)
  console.log(`  explorer (swap)   : https://sepolia.mantlescan.xyz/tx/${swapHash}`)
  console.log(`  explorer (verdict): https://sepolia.mantlescan.xyz/tx/${ingestResult.validationTxHash}`)
}

main().catch(err => { console.error(err); process.exit(1) })
