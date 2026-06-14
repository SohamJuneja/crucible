/**
 * Deploys MockERC20 (×2) + MockDEX to Mantle Sepolia, executes one honest swap,
 * and writes real tx data to packages/engine/src/__tests__/fixtures.json.
 *
 * Usage: npm run make:fixtures   (requires .env with MANTLE_PRIVATE_KEY)
 *
 * This script is the ONLY place mock contracts are used.
 * The Transfer events it generates are real on-chain; verifyClaim reads them from the RPC.
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { createPublicClient, http } from 'viem'
import { mantleSepoliaTestnet } from 'viem/chains'
import { getWalletClient } from '@crucible/core'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const solc = require('solc') as { compile(input: string): string }

const FIXTURES_PATH = path.resolve(
  process.cwd(),
  'packages/engine/src/__tests__/fixtures.json',
)

const ERC20_SOURCE = fs.readFileSync(
  path.resolve(process.cwd(), 'packages/contracts/src/MockERC20.sol'),
  'utf8',
)
const DEX_SOURCE = fs.readFileSync(
  path.resolve(process.cwd(), 'packages/contracts/src/MockDEX.sol'),
  'utf8',
)

const AMOUNT_IN  = 10n * 10n ** 18n   // 10 tokens
const MINT_AMOUNT = 1000n * 10n ** 18n // 1000 tokens

const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

// ── compile ───────────────────────────────────────────────────────────────────

interface SolcOut {
  errors?: Array<{ severity: string; formattedMessage: string }>
  contracts?: Record<string, Record<string, {
    abi: unknown[]
    evm: { bytecode: { object: string } }
  }>>
}

function compileAll() {
  const input = JSON.stringify({
    language: 'Solidity',
    sources: {
      'MockERC20.sol': { content: ERC20_SOURCE },
      'MockDEX.sol':   { content: DEX_SOURCE   },
    },
    settings: {
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } },
      optimizer: { enabled: true, runs: 200 },
    },
  })
  const out: SolcOut = JSON.parse(solc.compile(input))
  const errors = (out.errors ?? []).filter(e => e.severity === 'error')
  if (errors.length) throw new Error(errors.map(e => e.formattedMessage).join('\n'))

  const erc20 = out.contracts!['MockERC20.sol']['MockERC20']
  const dex   = out.contracts!['MockDEX.sol']['MockDEX']
  return {
    erc20: { abi: erc20.abi, bytecode: `0x${erc20.evm.bytecode.object}` as `0x${string}` },
    dex:   { abi: dex.abi,   bytecode: `0x${dex.evm.bytecode.object}`   as `0x${string}` },
  }
}

// ── deploy helper ──────────────────────────────────────────────────────────────

async function deployContract(
  walletClient: Awaited<ReturnType<typeof getWalletClient>>,
  publicClient: ReturnType<typeof createPublicClient>,
  abi: unknown[],
  bytecode: `0x${string}`,
  args: unknown[],
  label: string,
): Promise<`0x${string}`> {
  console.log(`Deploying ${label} ...`)
  let hash: `0x${string}`
  try {
    hash = await walletClient.deployContract({ abi, bytecode, args: args as never[] })
  } catch {
    console.log(`  gas estimation failed — retrying with explicit limit`)
    hash = await walletClient.deployContract({ abi, bytecode, args: args as never[], gas: 3_000_000n })
  }
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  const address = receipt.contractAddress!
  console.log(`  ${label} → ${address}`)
  return address
}

// ── write helper ───────────────────────────────────────────────────────────────

async function send(
  walletClient: Awaited<ReturnType<typeof getWalletClient>>,
  publicClient: ReturnType<typeof createPublicClient>,
  params: Parameters<typeof walletClient.writeContract>[0],
  label: string,
) {
  console.log(`  ${label} ...`)
  let hash: `0x${string}`
  try {
    hash = await walletClient.writeContract(params)
  } catch {
    hash = await walletClient.writeContract({ ...params, gas: 500_000n })
  }
  await publicClient.waitForTransactionReceipt({ hash })
  return hash
}

// ── main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Compiling MockERC20 + MockDEX ...')
  const { erc20, dex } = compileAll()
  console.log('Compilation OK\n')

  const publicClient = createPublicClient({
    chain: mantleSepoliaTestnet,
    transport: http(process.env.MANTLE_RPC_URL ?? 'https://rpc.sepolia.mantle.xyz'),
  })
  const walletClient = getWalletClient()
  const agent = walletClient.account.address
  console.log(`Wallet: ${agent}\n`)

  // ── deploy: ONE tx at a time; await each receipt before the next ──────────
  // (concurrent deploys share the same nonce → replacement-underpriced errors on Mantle)

  const tokenA = await deployContract(
    walletClient, publicClient, erc20.abi, erc20.bytecode, ['CrucibleTokenA', 'CTKA'], 'MockERC20(A)',
  )

  const tokenB = await deployContract(
    walletClient, publicClient, erc20.abi, erc20.bytecode, ['CrucibleTokenB', 'CTKB'], 'MockERC20(B)',
  )

  const dexAddress = await deployContract(
    walletClient, publicClient, dex.abi, dex.bytecode, [], 'MockDEX',
  )

  // ── seed liquidity: DEX must hold enough of BOTH tokens ──────────────────
  // tokenA: DEX holds reserves so it can accept incoming tokenA (not strictly needed
  //         for a transferFrom DEX, but seeds realistic state)
  // tokenB: DEX MUST hold at least amountOut = AMOUNT_IN * 2 to pay the swap
  console.log('\nSeeding liquidity & approvals (sequential) ...')

  const erc20Abi = erc20.abi as Parameters<typeof walletClient.writeContract>[0]['abi']

  await send(walletClient, publicClient, {
    address: tokenA, abi: erc20Abi, functionName: 'mint',
    args: [agent, MINT_AMOUNT],
  }, `mint tokenA → agent (${MINT_AMOUNT})`)

  await send(walletClient, publicClient, {
    address: tokenA, abi: erc20Abi, functionName: 'mint',
    args: [dexAddress, MINT_AMOUNT],
  }, `mint tokenA → DEX   (${MINT_AMOUNT})`)

  await send(walletClient, publicClient, {
    address: tokenB, abi: erc20Abi, functionName: 'mint',
    args: [dexAddress, MINT_AMOUNT],
  }, `mint tokenB → DEX   (${MINT_AMOUNT})`)

  await send(walletClient, publicClient, {
    address: tokenA, abi: erc20Abi, functionName: 'approve',
    args: [dexAddress, AMOUNT_IN],
  }, `approve DEX to pull ${AMOUNT_IN} tokenA`)

  // ── execute the honest swap ───────────────────────────────────────────────
  console.log('\nExecuting honest swap ...')
  const dexAbi = dex.abi as Parameters<typeof walletClient.writeContract>[0]['abi']
  const swapHash = await send(walletClient, publicClient, {
    address: dexAddress, abi: dexAbi, functionName: 'swap',
    args: [tokenA, AMOUNT_IN, tokenB],
  }, 'swap tokenA → tokenB')

  const swapReceipt = await publicClient.getTransactionReceipt({ hash: swapHash })
  console.log(`  swap tx: ${swapHash}`)

  // Derive actual amounts from Transfer events (chain-derived, not assumed)
  const tokenOutLog = swapReceipt.logs.find(
    l =>
      l.address.toLowerCase() === tokenB.toLowerCase() &&
      l.topics[0]?.toLowerCase() === TRANSFER_TOPIC.toLowerCase() &&
      l.topics[2]?.slice(-40).toLowerCase() === agent.slice(2).toLowerCase(),
  )
  const tokenInLog = swapReceipt.logs.find(
    l =>
      l.address.toLowerCase() === tokenA.toLowerCase() &&
      l.topics[0]?.toLowerCase() === TRANSFER_TOPIC.toLowerCase() &&
      l.topics[1]?.slice(-40).toLowerCase() === agent.slice(2).toLowerCase(),
  )

  const actualAmountOut = tokenOutLog ? BigInt(tokenOutLog.data).toString() : AMOUNT_IN.toString()
  const actualAmountIn  = tokenInLog  ? BigInt(tokenInLog.data).toString()  : AMOUNT_IN.toString()

  const fixtures = {
    chainId:      mantleSepoliaTestnet.id,
    agentAddress: agent,
    tokenA,
    tokenB,
    dex: dexAddress,
    swapRate: '2',
    honestSwap: {
      txHash:    swapHash,
      amountIn:  actualAmountIn,
      amountOut: actualAmountOut,
      tokenIn:   tokenA,
      tokenOut:  tokenB,
    },
  }

  fs.writeFileSync(FIXTURES_PATH, JSON.stringify(fixtures, null, 2))
  console.log(`\nFixtures written → ${FIXTURES_PATH}`)
  console.log(`  tokenA    : ${tokenA}`)
  console.log(`  tokenB    : ${tokenB}`)
  console.log(`  dex       : ${dexAddress}`)
  console.log(`  swapHash  : ${swapHash}`)
  console.log(`  amountIn  : ${actualAmountIn}`)
  console.log(`  amountOut : ${actualAmountOut}`)
  console.log(`  Explorer  : https://sepolia.mantlescan.xyz/tx/${swapHash}`)
}

main().catch(err => { console.error(err); process.exit(1) })
