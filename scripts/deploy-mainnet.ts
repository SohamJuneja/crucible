/**
 * deploy-mainnet.ts — deploys all 5 Crucible contracts to Mantle mainnet (chainId 5000).
 *
 * Uses MAINNET_PRIVATE_KEY from .env — a SEPARATE key from MANTLE_PRIVATE_KEY (Sepolia).
 * Never touches the Sepolia setup; reads/writes nothing from artifacts/deployed.json.
 *
 * Deploy order (sequential, each receipt awaited before the next):
 *   1. ValidationRegistry    — no constructor args
 *   2. CrucibleScoreboard    — verifier = deployer
 *   3. CrucibleAttestation   — crucibleSigner = deployer
 *   4. DelegationVault       — scoreboard(2) + minScore 6000 + feeBps 1000
 *   5. DisputeManager        — arbiter/treasury = deployer + minBond 0.005 MNT + rewardBps 5000
 *
 * Output: artifacts/deployed.mainnet.json
 *
 * Usage: npm run deploy:mainnet
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { createPublicClient, createWalletClient, http, parseEther } from 'viem'
import { mantle } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const solc = require('solc') as { compile(input: string): string }

const CONTRACTS_DIR   = path.resolve(process.cwd(), 'packages/contracts/src')
const MAINNET_ARTIFACTS = path.resolve(process.cwd(), 'artifacts/deployed.mainnet.json')
const EXPLORER        = 'https://mantlescan.xyz'

// ── Compile helper ─────────────────────────────────────────────────────────────

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

// ── Deploy helper ──────────────────────────────────────────────────────────────

async function deploy(
  label:           string,
  pc:              ReturnType<typeof createPublicClient>,
  wc:              ReturnType<typeof createWalletClient>,
  abi:             unknown[],
  bytecode:        `0x${string}`,
  args:            unknown[],
): Promise<{ address: `0x${string}`; txHash: `0x${string}` }> {
  console.log(`\n[${label}] deploying from ${wc.account!.address} ...`)

  let hash: `0x${string}`
  try {
    hash = await wc.deployContract({ abi, bytecode, args: args as never[] })
  } catch {
    // Mantle L2 gas-estimation gotcha — retry with explicit limit
    console.log(`  Gas estimation failed — retrying with gas: 5_000_000 ...`)
    hash = await wc.deployContract({ abi, bytecode, args: args as never[], gas: 5_000_000n })
  }

  console.log(`  tx   : ${hash}`)
  console.log('  waiting for receipt ...')
  const receipt = await pc.waitForTransactionReceipt({ hash })
  const address = receipt.contractAddress!

  console.log(`  addr : ${address}`)
  console.log(`  link : ${EXPLORER}/address/${address}`)
  return { address, txHash: hash }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  // ── 0. Resolve deployer key & clients ─────────────────────────────────────
  const rawKey = process.env.MAINNET_PRIVATE_KEY
  if (!rawKey) throw new Error('MAINNET_PRIVATE_KEY is not set in .env')
  const key     = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`
  const account = privateKeyToAccount(key)

  const pc = createPublicClient({
    chain:     mantle,
    transport: http('https://rpc.mantle.xyz'),
  })
  const wc = createWalletClient({
    account,
    chain:     mantle,
    transport: http('https://rpc.mantle.xyz'),
  })

  const deployerAddr = account.address
  console.log('=== Crucible — Mantle Mainnet Deploy ===')
  console.log(`Network  : Mantle (chainId ${mantle.id})`)
  console.log(`Deployer : ${deployerAddr}`)
  console.log(`Explorer : ${EXPLORER}`)
  console.log('Deploying 5 contracts sequentially ...')

  const deployedAt = new Date().toISOString()
  const out: Record<string, unknown> = {}

  // ── 1. ValidationRegistry ──────────────────────────────────────────────────
  console.log('\n--- 1/5 ---')
  console.log('Compiling ValidationRegistry.sol ...')
  const vr = compile('ValidationRegistry.sol', 'ValidationRegistry')
  console.log('  OK')
  const vrResult = await deploy('ValidationRegistry', pc, wc, vr.abi, vr.bytecode, [])
  out['ValidationRegistry'] = {
    address:    vrResult.address,
    txHash:     vrResult.txHash,
    chainId:    mantle.id,
    deployedAt,
  }
  // Persist after each contract in case of later failure
  fs.mkdirSync('artifacts', { recursive: true })
  fs.writeFileSync(MAINNET_ARTIFACTS, JSON.stringify(out, null, 2))

  // ── 2. CrucibleScoreboard ──────────────────────────────────────────────────
  console.log('\n--- 2/5 ---')
  console.log('Compiling CrucibleScoreboard.sol ...')
  const sb = compile('CrucibleScoreboard.sol', 'CrucibleScoreboard')
  console.log('  OK')
  const sbResult = await deploy('CrucibleScoreboard', pc, wc, sb.abi, sb.bytecode, [deployerAddr])
  out['CrucibleScoreboard'] = {
    address:    sbResult.address,
    txHash:     sbResult.txHash,
    chainId:    mantle.id,
    verifier:   deployerAddr,
    deployedAt,
  }
  fs.writeFileSync(MAINNET_ARTIFACTS, JSON.stringify(out, null, 2))

  // ── 3. CrucibleAttestation ─────────────────────────────────────────────────
  console.log('\n--- 3/5 ---')
  console.log('Compiling CrucibleAttestation.sol ...')
  const att = compile('CrucibleAttestation.sol', 'CrucibleAttestation')
  console.log('  OK')
  const attResult = await deploy('CrucibleAttestation', pc, wc, att.abi, att.bytecode, [deployerAddr])
  out['CrucibleAttestation'] = {
    address:        attResult.address,
    txHash:         attResult.txHash,
    chainId:        mantle.id,
    crucibleSigner: deployerAddr,
    deployedAt,
  }
  fs.writeFileSync(MAINNET_ARTIFACTS, JSON.stringify(out, null, 2))

  // ── 4. DelegationVault ─────────────────────────────────────────────────────
  console.log('\n--- 4/5 ---')
  const sbAddr         = sbResult.address
  const MIN_SCORE      = 6000   // 60.00 out of 10000
  const PERF_FEE_BPS   = 1000   // 10 %
  console.log('Compiling DelegationVault.sol ...')
  const dv = compile('DelegationVault.sol', 'DelegationVault')
  console.log('  OK')
  console.log(`  scoreboard = ${sbAddr}`)
  console.log(`  minScore   = ${MIN_SCORE}  feeBps = ${PERF_FEE_BPS}`)
  const dvResult = await deploy('DelegationVault', pc, wc, dv.abi, dv.bytecode, [sbAddr, MIN_SCORE, PERF_FEE_BPS])
  out['DelegationVault'] = {
    address:          dvResult.address,
    txHash:           dvResult.txHash,
    chainId:          mantle.id,
    scoreboard:       sbAddr,
    minScore:         MIN_SCORE,
    performanceFeeBps: PERF_FEE_BPS,
    deployedAt,
  }
  fs.writeFileSync(MAINNET_ARTIFACTS, JSON.stringify(out, null, 2))

  // ── 5. DisputeManager ──────────────────────────────────────────────────────
  console.log('\n--- 5/5 ---')
  const MIN_BOND   = parseEther('0.005')  // 0.005 MNT
  const REWARD_BPS = 5000                 // 50 %
  // Treasury = deployer for now (no multisig specified; change post-deploy if needed)
  const TREASURY   = deployerAddr
  console.log('Compiling DisputeManager.sol ...')
  const dm = compile('DisputeManager.sol', 'DisputeManager')
  console.log('  OK')
  console.log(`  arbiter  = ${deployerAddr}`)
  console.log(`  treasury = ${TREASURY}`)
  console.log(`  minBond  = 0.005 MNT   rewardBps = ${REWARD_BPS}`)
  const dmResult = await deploy(
    'DisputeManager', pc, wc, dm.abi, dm.bytecode,
    [deployerAddr, TREASURY, MIN_BOND, REWARD_BPS],
  )
  out['DisputeManager'] = {
    address:    dmResult.address,
    txHash:     dmResult.txHash,
    chainId:    mantle.id,
    arbiter:    deployerAddr,
    treasury:   TREASURY,
    minBond:    MIN_BOND.toString(),
    rewardBps:  REWARD_BPS,
    deployedAt,
  }
  fs.writeFileSync(MAINNET_ARTIFACTS, JSON.stringify(out, null, 2))

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n\n=== All 5 contracts deployed ===')
  for (const [name, data] of Object.entries(out)) {
    const d = data as { address: string }
    console.log(`  ${name.padEnd(22)} ${d.address}`)
    console.log(`    ${EXPLORER}/address/${d.address}`)
  }
  console.log(`\nWritten → artifacts/deployed.mainnet.json`)
  console.log('\nNext: npm run verify:contracts -- --mainnet')
}

main().catch(err => { console.error(err); process.exit(1) })
