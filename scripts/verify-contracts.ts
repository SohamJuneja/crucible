/**
 * verify-contracts.ts — submits source verification for all Crucible contracts
 * to the Mantlescan API (Etherscan-compatible verifysourcecode endpoint).
 *
 * Reads MANTLESCAN_API_KEY from .env.
 * Compiler settings must exactly match what the deploy scripts used:
 *   - solc v0.8.26+commit.8a97fa7a
 *   - optimizer: enabled, 200 runs
 *   - evmVersion: cancun (solc 0.8.26 default)
 *
 * Usage: npm run verify:contracts
 *
 * If the API returns ALREADY_VERIFIED, the contract is already verified — no action needed.
 * If it returns PENDING, poll with the returned guid using:
 *   npm run verify:contracts -- --check <guid>
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { encodeAbiParameters, parseAbiParameters } from 'viem'

// ── Config ──────────────────────────────────────────────────────────────────

const API_URL      = 'https://api-sepolia.mantlescan.xyz/api'
const COMPILER_VER = 'v0.8.26+commit.8a97fa7a'
const EVM_VERSION  = 'cancun'
const OPT_RUNS     = 200

const CONTRACTS_DIR = path.resolve(process.cwd(), 'packages/contracts/src')
const ARTIFACTS     = path.resolve(process.cwd(), 'artifacts/deployed.json')
const FIXTURES      = path.resolve(process.cwd(), 'packages/engine/src/__tests__/fixtures.json')

// ── Helpers ──────────────────────────────────────────────────────────────────

function readSource(filename: string): string {
  return fs.readFileSync(path.join(CONTRACTS_DIR, filename), 'utf8')
}

function hex(encoded: `0x${string}`): string {
  return encoded.slice(2)   // strip 0x prefix for Mantlescan
}

async function post(params: Record<string, string>): Promise<{ status: string; result: string; message: string }> {
  const body = new URLSearchParams({ module: 'contract', ...params })
  const res = await fetch(API_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  })
  return res.json() as Promise<{ status: string; result: string; message: string }>
}

async function verify(opts: {
  address:     string
  name:        string
  source:      string
  constructorArgs: string   // hex, no 0x
  label:       string
}) {
  console.log(`\n──── ${opts.label} ────`)
  console.log(`  address : ${opts.address}`)

  const apiKey = process.env.MANTLESCAN_API_KEY
  if (!apiKey) throw new Error('MANTLESCAN_API_KEY not set in .env')

  const res = await post({
    action:                     'verifysourcecode',
    apikey:                     apiKey,
    contractaddress:            opts.address,
    sourceCode:                 opts.source,
    contractname:               opts.name,
    compilerversion:            COMPILER_VER,
    optimizationUsed:           '1',
    runs:                       String(OPT_RUNS),
    evmversion:                 EVM_VERSION,
    licenseType:                '3',    // MIT = 3 in Etherscan's scheme
    constructorArguements:      opts.constructorArgs,  // note: Etherscan's typo in field name
  })

  if (res.result === 'Already Verified') {
    console.log('  ✓ Already verified')
    return
  }

  if (res.status === '1') {
    console.log(`  ✓ Submitted  guid=${res.result}`)
    console.log(`    Poll:  npm run verify:contracts -- --check ${res.result}`)
  } else {
    console.error(`  ✗ Error: ${res.result} (message: ${res.message})`)
  }
}

// ── Poll helper ──────────────────────────────────────────────────────────────

async function checkGuid(guid: string) {
  const apiKey = process.env.MANTLESCAN_API_KEY
  if (!apiKey) throw new Error('MANTLESCAN_API_KEY not set in .env')

  const res = await post({
    action: 'checkverifystatus',
    apikey: apiKey,
    guid,
  })
  console.log(`guid ${guid}: status=${res.status}  result=${res.result}`)
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // --check <guid> mode
  const checkIdx = process.argv.indexOf('--check')
  if (checkIdx !== -1) {
    const guid = process.argv[checkIdx + 1]
    if (!guid) { console.error('Usage: --check <guid>'); process.exit(1) }
    await checkGuid(guid)
    return
  }

  if (!fs.existsSync(ARTIFACTS)) {
    throw new Error('artifacts/deployed.json not found')
  }
  const deployed = JSON.parse(fs.readFileSync(ARTIFACTS, 'utf8')) as Record<string, { address: string }>

  // fixtures.json holds MockERC20 + MockDEX addresses
  const fixtures = fs.existsSync(FIXTURES)
    ? JSON.parse(fs.readFileSync(FIXTURES, 'utf8')) as { tokenA: string; tokenB: string; dex: string }
    : null

  console.log('Crucible — contract verification via Mantlescan API')
  console.log(`Compiler : ${COMPILER_VER}`)
  console.log(`EVM      : ${EVM_VERSION}   Optimizer: enabled, ${OPT_RUNS} runs`)

  // ── 1. ValidationRegistry ─────────────────────────────────────────────────

  await verify({
    label:           '1. ValidationRegistry',
    address:         deployed['ValidationRegistry'].address,
    name:            'ValidationRegistry',
    source:          readSource('ValidationRegistry.sol'),
    constructorArgs: '',   // no constructor
  })

  // ── 2. CrucibleScoreboard ─────────────────────────────────────────────────

  const sbDeployed = deployed['CrucibleScoreboard'] as { address: string; verifier: string }
  await verify({
    label:   '2. CrucibleScoreboard',
    address: sbDeployed.address,
    name:    'CrucibleScoreboard',
    source:  readSource('CrucibleScoreboard.sol'),
    constructorArgs: hex(encodeAbiParameters(
      parseAbiParameters('address'),
      [sbDeployed.verifier as `0x${string}`],
    )),
  })

  // ── 3. CrucibleAttestation ────────────────────────────────────────────────

  const attDeployed = deployed['CrucibleAttestation'] as { address: string; crucibleSigner: string }
  await verify({
    label:   '3. CrucibleAttestation',
    address: attDeployed.address,
    name:    'CrucibleAttestation',
    source:  readSource('CrucibleAttestation.sol'),
    constructorArgs: hex(encodeAbiParameters(
      parseAbiParameters('address'),
      [attDeployed.crucibleSigner as `0x${string}`],
    )),
  })

  // ── 4. DelegationVault ────────────────────────────────────────────────────

  const dvDeployed = deployed['DelegationVault'] as {
    address: string; scoreboard: string; minScore: number; performanceFeeBps: number
  }
  await verify({
    label:   '4. DelegationVault',
    address: dvDeployed.address,
    name:    'DelegationVault',
    source:  readSource('DelegationVault.sol'),
    constructorArgs: hex(encodeAbiParameters(
      parseAbiParameters('address,uint16,uint16'),
      [dvDeployed.scoreboard as `0x${string}`, dvDeployed.minScore, dvDeployed.performanceFeeBps],
    )),
  })

  // ── 5. DisputeManager ────────────────────────────────────────────────────

  const dmDeployed = deployed['DisputeManager'] as {
    address: string; arbiter: string; treasury: string; minBond: string; rewardBps: number
  }
  await verify({
    label:   '5. DisputeManager',
    address: dmDeployed.address,
    name:    'DisputeManager',
    source:  readSource('DisputeManager.sol'),
    constructorArgs: hex(encodeAbiParameters(
      parseAbiParameters('address,address,uint256,uint256'),
      [
        dmDeployed.arbiter  as `0x${string}`,
        dmDeployed.treasury as `0x${string}`,
        BigInt(dmDeployed.minBond),
        BigInt(dmDeployed.rewardBps),
      ],
    )),
  })

  // ── 6 & 7. MockERC20s ────────────────────────────────────────────────────

  if (fixtures) {
    const erc20Source = readSource('MockERC20.sol')

    await verify({
      label:   '6. MockERC20 (TOKEN_A — CrucibleTokenA)',
      address: fixtures.tokenA,
      name:    'MockERC20',
      source:  erc20Source,
      constructorArgs: hex(encodeAbiParameters(
        parseAbiParameters('string,string'),
        ['CrucibleTokenA', 'CTKA'],
      )),
    })

    await verify({
      label:   '7. MockERC20 (TOKEN_B — CrucibleTokenB)',
      address: fixtures.tokenB,
      name:    'MockERC20',
      source:  erc20Source,
      constructorArgs: hex(encodeAbiParameters(
        parseAbiParameters('string,string'),
        ['CrucibleTokenB', 'CTKB'],
      )),
    })

    // ── 8. MockDEX ───────────────────────────────────────────────────────

    await verify({
      label:           '8. MockDEX',
      address:         fixtures.dex,
      name:            'MockDEX',
      source:          readSource('MockDEX.sol'),
      constructorArgs: '',   // no constructor
    })
  } else {
    console.log('\n  (fixtures.json not found — skipping MockERC20/MockDEX)')
  }

  console.log('\n\nDone. If any show PENDING, poll with:')
  console.log('  npm run verify:contracts -- --check <guid>')
}

main().catch(err => { console.error(err); process.exit(1) })
