/**
 * Compiles and deploys CrucibleScoreboard + CrucibleAttestation to Mantle Sepolia.
 * Appends addresses + tx hashes to artifacts/deployed.json.
 * Writes ABIs to packages/core/abis/ for downstream use.
 *
 * Usage: npm run deploy:suite   (requires .env with MANTLE_PRIVATE_KEY)
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

// ── Compile helper ─────────────────────────────────────────────────────────

interface SolcOutput {
  errors?: Array<{ severity: string; formattedMessage: string }>
  contracts?: Record<string, Record<string, {
    abi: unknown[]
    evm: { bytecode: { object: string } }
  }>>
}

function compile(filename: string, contractName: string): { abi: unknown[]; bytecode: `0x${string}` } {
  const source = fs.readFileSync(path.join(CONTRACTS_DIR, filename), 'utf8')
  const input  = JSON.stringify({
    language: 'Solidity',
    sources: { [filename]: { content: source } },
    settings: {
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } },
      optimizer: { enabled: true, runs: 200 },
    },
  })
  const out: SolcOutput = JSON.parse(solc.compile(input))
  const errors = (out.errors ?? []).filter(e => e.severity === 'error')
  if (errors.length) throw new Error(`solc errors:\n${errors.map(e => e.formattedMessage).join('\n')}`)
  const c = out.contracts![filename][contractName]
  return { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` }
}

// ── Deploy helper ──────────────────────────────────────────────────────────

async function deploy(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof getWalletClient>,
  label:        string,
  abi:          unknown[],
  bytecode:     `0x${string}`,
  constructorArgs: unknown[],
): Promise<{ address: `0x${string}`; txHash: `0x${string}` }> {
  console.log(`\nDeploying ${label} from ${walletClient.account.address} ...`)

  let hash: `0x${string}`
  try {
    hash = await walletClient.deployContract({ abi, bytecode, args: constructorArgs as never[] })
  } catch {
    console.log('  Gas estimation failed — retrying with explicit gas: 3_000_000 ...')
    hash = await walletClient.deployContract({ abi, bytecode, args: constructorArgs as never[], gas: 3_000_000n })
  }

  console.log(`  Tx : ${hash}`)
  console.log('  Waiting for receipt ...')
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  const address = receipt.contractAddress!

  console.log(`  ${label} → ${address}`)
  console.log(`  Explorer : https://sepolia.mantlescan.xyz/address/${address}`)
  return { address, txHash: hash }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const publicClient = createPublicClient({
    chain:     mantleSepoliaTestnet,
    transport: http(process.env.MANTLE_RPC_URL ?? 'https://rpc.sepolia.mantle.xyz'),
  })
  const walletClient  = getWalletClient()
  const verifierAddr  = walletClient.account.address

  // 1. CrucibleScoreboard
  console.log('Compiling CrucibleScoreboard.sol ...')
  const sb = compile('CrucibleScoreboard.sol', 'CrucibleScoreboard')
  console.log('Compilation OK')
  fs.writeFileSync(path.join(ABIS_DIR, 'CrucibleScoreboard.json'), JSON.stringify(sb.abi, null, 2))
  console.log('ABI written → packages/core/abis/CrucibleScoreboard.json')

  const sbResult = await deploy(publicClient, walletClient, 'CrucibleScoreboard', sb.abi, sb.bytecode, [verifierAddr])

  // 2. CrucibleAttestation
  console.log('\nCompiling CrucibleAttestation.sol ...')
  const att = compile('CrucibleAttestation.sol', 'CrucibleAttestation')
  console.log('Compilation OK')
  fs.writeFileSync(path.join(ABIS_DIR, 'CrucibleAttestation.json'), JSON.stringify(att.abi, null, 2))
  console.log('ABI written → packages/core/abis/CrucibleAttestation.json')

  const attResult = await deploy(publicClient, walletClient, 'CrucibleAttestation', att.abi, att.bytecode, [verifierAddr])

  // 3. Append to artifacts/deployed.json
  fs.mkdirSync('artifacts', { recursive: true })
  const existing = fs.existsSync(ARTIFACTS)
    ? (JSON.parse(fs.readFileSync(ARTIFACTS, 'utf8')) as Record<string, unknown>)
    : {}

  const deployedAt = new Date().toISOString()
  const updated = {
    ...existing,
    CrucibleScoreboard: {
      address:    sbResult.address,
      txHash:     sbResult.txHash,
      chainId:    mantleSepoliaTestnet.id,
      verifier:   verifierAddr,
      deployedAt,
    },
    CrucibleAttestation: {
      address:      attResult.address,
      txHash:       attResult.txHash,
      chainId:      mantleSepoliaTestnet.id,
      crucibleSigner: verifierAddr,
      deployedAt,
    },
  }

  fs.writeFileSync(ARTIFACTS, JSON.stringify(updated, null, 2))
  console.log('\n✓ Written → artifacts/deployed.json')
  console.log(`  CrucibleScoreboard  : ${sbResult.address}`)
  console.log(`  CrucibleAttestation : ${attResult.address}`)
  console.log('\nRun tests with:  npx vitest run packages/contracts')
}

main().catch(err => { console.error(err); process.exit(1) })
