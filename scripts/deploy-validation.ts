/**
 * Compiles ValidationRegistry.sol with solc and deploys it to Mantle Sepolia.
 * Writes the contract address + tx hash to artifacts/deployed.json.
 *
 * Usage: npm run deploy:validation   (requires .env with MANTLE_PRIVATE_KEY)
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { createPublicClient, http } from 'viem'
import { mantleSepoliaTestnet } from 'viem/chains'
import { getWalletClient } from '../packages/core/src/chain'

// solc has no TS types; tsx/esbuild handles the CJS import fine at runtime
// eslint-disable-next-line @typescript-eslint/no-require-imports
const solc = require('solc') as {
  compile(input: string): string
}

const SOL_PATH      = path.resolve(process.cwd(), 'packages/contracts/src/ValidationRegistry.sol')
const ABI_OUT_PATH  = path.resolve(process.cwd(), 'packages/core/abis/ValidationRegistry.json')
const ARTIFACTS     = path.resolve(process.cwd(), 'artifacts/deployed.json')

interface SolcOutput {
  errors?: Array<{ severity: string; formattedMessage: string }>
  contracts?: Record<string, Record<string, {
    abi: unknown[]
    evm: { bytecode: { object: string } }
  }>>
}

function compile(source: string): { abi: unknown[]; bytecode: `0x${string}` } {
  const input = {
    language: 'Solidity',
    sources: { 'ValidationRegistry.sol': { content: source } },
    settings: {
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } },
      optimizer: { enabled: true, runs: 200 },
    },
  }

  const raw: SolcOutput = JSON.parse(solc.compile(JSON.stringify(input)))

  const errors = (raw.errors ?? []).filter((e) => e.severity === 'error')
  if (errors.length > 0) {
    throw new Error(`solc errors:\n${errors.map((e) => e.formattedMessage).join('\n')}`)
  }

  const contract = raw.contracts!['ValidationRegistry.sol']['ValidationRegistry']
  return {
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`,
  }
}

async function main() {
  const source = fs.readFileSync(SOL_PATH, 'utf8')
  console.log('Compiling ValidationRegistry.sol ...')
  const { abi, bytecode } = compile(source)
  console.log('Compilation OK')

  // Persist ABI so packages/core can import it after deploy
  fs.writeFileSync(ABI_OUT_PATH, JSON.stringify(abi, null, 2))
  console.log(`ABI written → ${ABI_OUT_PATH}`)

  const publicClient = createPublicClient({
    chain: mantleSepoliaTestnet,
    transport: http(process.env.MANTLE_RPC_URL ?? 'https://rpc.sepolia.mantle.xyz'),
  })
  const walletClient = getWalletClient()
  console.log(`Deploying from ${walletClient.account.address} ...`)

  let hash: `0x${string}`
  try {
    hash = await walletClient.deployContract({ abi, bytecode })
  } catch {
    // Mantle L2 gas-estimation gotcha: fall back to explicit high gas limit
    console.log('Gas estimation reverted — retrying with explicit gas: 3_000_000 ...')
    hash = await walletClient.deployContract({ abi, bytecode, gas: 3_000_000n })
  }

  console.log(`Tx submitted : ${hash}`)
  console.log('Waiting for receipt ...')

  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  const address = receipt.contractAddress!

  console.log('\nValidationRegistry deployed!')
  console.log(`Address  : ${address}`)
  console.log(`Tx hash  : ${hash}`)
  console.log(`Explorer : https://sepolia.mantlescan.xyz/address/${address}`)

  fs.mkdirSync('artifacts', { recursive: true })
  const existing = fs.existsSync(ARTIFACTS)
    ? (JSON.parse(fs.readFileSync(ARTIFACTS, 'utf8')) as Record<string, unknown>)
    : {}

  fs.writeFileSync(
    ARTIFACTS,
    JSON.stringify(
      {
        ...existing,
        ValidationRegistry: {
          address,
          txHash: hash,
          chainId: mantleSepoliaTestnet.id,
          deployedAt: new Date().toISOString(),
        },
      },
      null,
      2
    )
  )
  console.log(`\nWritten → artifacts/deployed.json`)
}

main().catch((err) => { console.error(err); process.exit(1) })
