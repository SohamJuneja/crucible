/**
 * Compiles and deploys DisputeManager to Mantle Sepolia.
 * Appends the address to artifacts/deployed.json.
 *
 * Usage: npm run deploy:dispute   (requires .env with MANTLE_PRIVATE_KEY)
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { createPublicClient, http, parseEther } from 'viem'
import { mantleSepoliaTestnet } from 'viem/chains'
import { getWalletClient } from '@crucible/core'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const solc = require('solc') as { compile(input: string): string }

const CONTRACTS_DIR = path.resolve(process.cwd(), 'packages/contracts/src')
const ABIS_DIR      = path.resolve(process.cwd(), 'packages/core/abis')
const ARTIFACTS     = path.resolve(process.cwd(), 'artifacts/deployed.json')

// ── Compile ────────────────────────────────────────────────────────────────────

interface SolcOutput {
  errors?: Array<{ severity: string; formattedMessage: string }>
  contracts?: Record<string, Record<string, {
    abi: unknown[]
    evm: { bytecode: { object: string } }
  }>>
}

function compile(filename: string, contractName: string): { abi: unknown[]; bytecode: `0x${string}` } {
  const src   = fs.readFileSync(path.join(CONTRACTS_DIR, filename), 'utf8')
  const input = JSON.stringify({
    language: 'Solidity',
    sources:  { [filename]: { content: src } },
    settings: { outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } }, optimizer: { enabled: true, runs: 200 } },
  })
  const out: SolcOutput = JSON.parse(solc.compile(input))
  const errors = (out.errors ?? []).filter(e => e.severity === 'error')
  if (errors.length) throw new Error(`solc errors:\n${errors.map(e => e.formattedMessage).join('\n')}`)
  const c = out.contracts![filename][contractName]
  return { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const pc           = createPublicClient({ chain: mantleSepoliaTestnet, transport: http(process.env.MANTLE_RPC_URL ?? 'https://rpc.sepolia.mantle.xyz') })
  const walletClient = getWalletClient()
  const verifierAddr = walletClient.account.address

  // Dispute parameters
  const MIN_BOND    = parseEther('0.005')   // 0.005 MNT minimum bond
  const REWARD_BPS  = 5000                  // 50 % bonus to winning challenger (from rewardPool)

  // Treasury: dummy address for demo — in production use a multisig
  // Not the same as verifier so slashing is clearly visible in demos/tests
  const TREASURY = '0xdeadc0ffee0000000000000000000000000000ff' as const

  console.log('Compiling DisputeManager.sol ...')
  const dm = compile('DisputeManager.sol', 'DisputeManager')
  console.log('Compilation OK')

  fs.mkdirSync(ABIS_DIR, { recursive: true })
  fs.writeFileSync(path.join(ABIS_DIR, 'DisputeManager.json'), JSON.stringify(dm.abi, null, 2))
  console.log('ABI written → packages/core/abis/DisputeManager.json')

  console.log(`\nDeploying DisputeManager from ${verifierAddr} ...`)
  console.log(`  arbiter   = ${verifierAddr}`)
  console.log(`  treasury  = ${TREASURY}`)
  console.log(`  minBond   = 0.005 MNT`)
  console.log(`  rewardBps = ${REWARD_BPS} (= ${REWARD_BPS / 100} %)`)

  let hash: `0x${string}`
  try {
    hash = await walletClient.deployContract({
      abi:      dm.abi as never[],
      bytecode: dm.bytecode,
      args:     [verifierAddr, TREASURY, MIN_BOND, REWARD_BPS],
    })
  } catch {
    console.log('  Gas estimation failed — retrying with explicit gas: 3_000_000 ...')
    hash = await walletClient.deployContract({
      abi:      dm.abi as never[],
      bytecode: dm.bytecode,
      args:     [verifierAddr, TREASURY, MIN_BOND, REWARD_BPS],
      gas:      3_000_000n,
    })
  }

  console.log(`  Tx : ${hash}`)
  console.log('  Waiting for receipt ...')
  const receipt = await pc.waitForTransactionReceipt({ hash })
  const address = receipt.contractAddress!

  console.log(`  DisputeManager → ${address}`)
  console.log(`  Explorer : https://sepolia.mantlescan.xyz/address/${address}`)

  const existing = fs.existsSync(ARTIFACTS)
    ? (JSON.parse(fs.readFileSync(ARTIFACTS, 'utf8')) as Record<string, unknown>)
    : {}

  const updated = {
    ...existing,
    DisputeManager: {
      address,
      txHash:    hash,
      chainId:   mantleSepoliaTestnet.id,
      arbiter:   verifierAddr,
      treasury:  TREASURY,
      minBond:   MIN_BOND.toString(),
      rewardBps: REWARD_BPS,
      deployedAt: new Date().toISOString(),
    },
  }
  fs.writeFileSync(ARTIFACTS, JSON.stringify(updated, null, 2))
  console.log('\n✓ Written → artifacts/deployed.json')
  console.log(`  DisputeManager : ${address}`)
  console.log('\nRun the demo with:  npm run dispute:demo')
}

main().catch(err => { console.error(err); process.exit(1) })
