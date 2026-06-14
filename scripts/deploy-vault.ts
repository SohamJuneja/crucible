/**
 * Compiles and deploys DelegationVault to Mantle Sepolia.
 * Wires it to the deployed CrucibleScoreboard.
 * Appends the address to artifacts/deployed.json.
 *
 * Usage: npm run deploy:vault   (requires .env with MANTLE_PRIVATE_KEY)
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { createPublicClient, http } from 'viem'
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
  const src  = fs.readFileSync(path.join(CONTRACTS_DIR, filename), 'utf8')
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

// ── Deploy ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(ARTIFACTS)) {
    throw new Error('artifacts/deployed.json not found — run: npm run deploy:suite first')
  }
  const existing = JSON.parse(fs.readFileSync(ARTIFACTS, 'utf8')) as Record<string, { address?: string }>
  const sbAddress = existing.CrucibleScoreboard?.address
  if (!sbAddress) {
    throw new Error('CrucibleScoreboard not in deployed.json — run: npm run deploy:suite first')
  }

  const pc           = createPublicClient({ chain: mantleSepoliaTestnet, transport: http(process.env.MANTLE_RPC_URL ?? 'https://rpc.sepolia.mantle.xyz') })
  const walletClient = getWalletClient()
  const verifierAddr = walletClient.account.address

  // Vault parameters
  const MIN_SCORE           = 6000   // 60.00 — only verified top agents
  const PERFORMANCE_FEE_BPS = 1000   // 10 %

  console.log('Compiling DelegationVault.sol ...')
  const vault = compile('DelegationVault.sol', 'DelegationVault')
  console.log('Compilation OK')

  fs.mkdirSync(ABIS_DIR, { recursive: true })
  fs.writeFileSync(path.join(ABIS_DIR, 'DelegationVault.json'), JSON.stringify(vault.abi, null, 2))
  console.log('ABI written → packages/core/abis/DelegationVault.json')

  console.log(`\nDeploying DelegationVault from ${verifierAddr} ...`)
  console.log(`  scoreboard  = ${sbAddress}`)
  console.log(`  minScore    = ${MIN_SCORE} (= ${MIN_SCORE / 100}.00)`)
  console.log(`  feeBps      = ${PERFORMANCE_FEE_BPS} (= ${PERFORMANCE_FEE_BPS / 100} %)`)

  let hash: `0x${string}`
  try {
    hash = await walletClient.deployContract({
      abi:  vault.abi as never[],
      bytecode: vault.bytecode,
      args: [sbAddress as `0x${string}`, MIN_SCORE, PERFORMANCE_FEE_BPS],
    })
  } catch {
    console.log('  Gas estimation failed — retrying with explicit gas: 3_000_000 ...')
    hash = await walletClient.deployContract({
      abi:  vault.abi as never[],
      bytecode: vault.bytecode,
      args: [sbAddress as `0x${string}`, MIN_SCORE, PERFORMANCE_FEE_BPS],
      gas: 3_000_000n,
    })
  }

  console.log(`  Tx : ${hash}`)
  console.log('  Waiting for receipt ...')
  const receipt = await pc.waitForTransactionReceipt({ hash })
  const address = receipt.contractAddress!

  console.log(`  DelegationVault → ${address}`)
  console.log(`  Explorer : https://sepolia.mantlescan.xyz/address/${address}`)

  const updated = {
    ...existing,
    DelegationVault: {
      address,
      txHash:           hash,
      chainId:          mantleSepoliaTestnet.id,
      scoreboard:       sbAddress,
      minScore:         MIN_SCORE,
      performanceFeeBps: PERFORMANCE_FEE_BPS,
      deployedAt:       new Date().toISOString(),
    },
  }
  fs.writeFileSync(ARTIFACTS, JSON.stringify(updated, null, 2))
  console.log('\n✓ Written → artifacts/deployed.json')
  console.log(`  DelegationVault : ${address}`)
  console.log('\nRun the demo with:  npm run delegate:demo')
}

main().catch(err => { console.error(err); process.exit(1) })
