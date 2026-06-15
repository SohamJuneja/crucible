/**
 * verify-contracts.ts — submits source verification for all Crucible contracts
 * via Etherscan API V2.
 *
 * Reads ETHERSCAN_API_KEY from .env (falls back to MANTLESCAN_API_KEY).
 * Compiler settings must exactly match what the deploy scripts used:
 *   - solc v0.8.26+commit.8a97fa7a
 *   - optimizer: enabled, 200 runs
 *   - evmVersion: cancun (solc 0.8.26 default)
 *
 * Usage:
 *   npm run verify:contracts                      — Sepolia (chainid 5003)
 *   npm run verify:contracts -- --mainnet         — Mainnet (chainid 5000)
 *   npm run verify:contracts -- --check <guid>    — re-poll one guid (Sepolia)
 *   npm run verify:contracts -- --mainnet --check <guid>  — re-poll (mainnet)
 *
 * Throttled to 1200ms between submissions to stay under Etherscan's 3 req/sec limit.
 * After each submission the script auto-polls checkverifystatus every 5s until done.
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { encodeAbiParameters, parseAbiParameters } from 'viem'

// ── Mode detection ───────────────────────────────────────────────────────────

const IS_MAINNET   = process.argv.includes('--mainnet')
const CHAIN_ID     = IS_MAINNET ? '5000' : '5003'
const CHAIN_LABEL  = IS_MAINNET ? 'Mantle Mainnet' : 'Mantle Sepolia'

// ── Config ──────────────────────────────────────────────────────────────────

const API_URL      = 'https://api.etherscan.io/v2/api'
const COMPILER_VER = 'v0.8.26+commit.8a97fa7a'
const EVM_VERSION  = 'cancun'
const OPT_RUNS     = 200

const CONTRACTS_DIR = path.resolve(process.cwd(), 'packages/contracts/src')
const ARTIFACTS     = IS_MAINNET
  ? path.resolve(process.cwd(), 'artifacts/deployed.mainnet.json')
  : path.resolve(process.cwd(), 'artifacts/deployed.json')
const FIXTURES      = path.resolve(process.cwd(), 'packages/engine/src/__tests__/fixtures.json')

// ── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

function readSource(filename: string): string {
  return fs.readFileSync(path.join(CONTRACTS_DIR, filename), 'utf8')
}

function hex(encoded: `0x${string}`): string {
  return encoded.slice(2)   // strip 0x prefix
}

function apiKey(): string {
  const key = process.env.ETHERSCAN_API_KEY ?? process.env.MANTLESCAN_API_KEY
  if (!key) throw new Error('Neither ETHERSCAN_API_KEY nor MANTLESCAN_API_KEY is set in .env')
  return key
}

async function post(params: Record<string, string>): Promise<{ status: string; result: string; message: string }> {
  // V2: chainid goes on the query string; body carries module/action/payload
  const url  = `${API_URL}?chainid=${CHAIN_ID}`
  const body = new URLSearchParams({ module: 'contract', ...params })
  const res  = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  })
  return res.json() as Promise<{ status: string; result: string; message: string }>
}

// Polls checkverifystatus every 5s until Etherscan returns a definitive result.
async function pollUntilDone(guid: string): Promise<string> {
  process.stdout.write('  Polling')
  for (;;) {
    await sleep(5_000)
    const res = await post({ action: 'checkverifystatus', apikey: apiKey(), guid })
    const result: string = res.result ?? res.message
    if (result !== 'Pending') {
      process.stdout.write('\n')
      return result
    }
    process.stdout.write('.')
  }
}

async function verify(opts: {
  address:         string
  name:            string
  source:          string
  constructorArgs: string   // hex, no 0x
  label:           string
}) {
  console.log(`\n──── ${opts.label} ────`)
  console.log(`  address : ${opts.address}`)

  const res = await post({
    action:                'verifysourcecode',
    apikey:                apiKey(),
    contractaddress:       opts.address,
    codeformat:            'solidity-single-file',
    sourceCode:            opts.source,
    contractname:          opts.name,
    compilerversion:       COMPILER_VER,
    optimizationUsed:      '1',
    runs:                  String(OPT_RUNS),
    evmversion:            EVM_VERSION,
    licenseType:           '3',    // MIT = 3 in Etherscan's scheme
    constructorArguements: opts.constructorArgs,  // note: Etherscan's typo in field name
  })

  // Already verified — nothing to do
  if (
    res.result === 'Already Verified' ||
    (res.message ?? '').toLowerCase().includes('already verified')
  ) {
    console.log('  ✓ Already verified')
    return
  }

  if (res.status !== '1') {
    console.error(`  ✗ Submit error: ${res.result} (message: ${res.message})`)
    return
  }

  const guid = res.result
  console.log(`  ✓ Submitted  guid=${guid}`)

  const final = await pollUntilDone(guid)

  if (final.toLowerCase().startsWith('pass')) {
    console.log(`  ✓ Verified!  (${final})`)
  } else {
    console.error(`  ✗ Verification failed: ${final}`)
    console.error(`    Re-poll manually: npm run verify:contracts -- --check ${guid}`)
  }
}

// ── Manual poll mode ──────────────────────────────────────────────────────────

async function checkGuid(guid: string) {
  const res = await post({ action: 'checkverifystatus', apikey: apiKey(), guid })
  const label = (res.result ?? res.message)
  if (label.toLowerCase().startsWith('pass')) {
    console.log(`✓ Verified!  guid=${guid}  (${label})`)
  } else if (label === 'Pending') {
    console.log(`⏳ Still pending — run again in a few seconds.`)
  } else {
    console.log(`ℹ  guid=${guid}: ${label}`)
  }
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

  const artifactPath = IS_MAINNET
    ? 'artifacts/deployed.mainnet.json'
    : 'artifacts/deployed.json'
  if (!fs.existsSync(ARTIFACTS)) {
    throw new Error(`${artifactPath} not found`)
  }
  const deployed = JSON.parse(fs.readFileSync(ARTIFACTS, 'utf8')) as Record<string, { address: string }>

  // fixtures.json holds MockERC20 + MockDEX addresses (Sepolia testnet only)
  const fixtures = !IS_MAINNET && fs.existsSync(FIXTURES)
    ? JSON.parse(fs.readFileSync(FIXTURES, 'utf8')) as { tokenA: string; tokenB: string; dex: string }
    : null

  console.log(`Crucible — contract verification via Etherscan API V2 (chainid=${CHAIN_ID}, ${CHAIN_LABEL})`)
  console.log(`Artifacts: ${artifactPath}`)
  console.log(`Compiler : ${COMPILER_VER}`)
  console.log(`EVM      : ${EVM_VERSION}   Optimizer: enabled, ${OPT_RUNS} runs`)
  console.log(`Throttle : 1200ms between submissions  |  Polling every 5s per contract`)

  // ── 1. ValidationRegistry ─────────────────────────────────────────────────

  await verify({
    label:           '1. ValidationRegistry',
    address:         deployed['ValidationRegistry'].address,
    name:            'ValidationRegistry',
    source:          readSource('ValidationRegistry.sol'),
    constructorArgs: '',   // no constructor
  })
  await sleep(1_200)

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
  await sleep(1_200)

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
  await sleep(1_200)

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
  await sleep(1_200)

  // ── 5. DisputeManager ─────────────────────────────────────────────────────

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

  // ── 6 & 7. MockERC20s ─────────────────────────────────────────────────────

  if (fixtures) {
    const erc20Source = readSource('MockERC20.sol')
    await sleep(1_200)

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
    await sleep(1_200)

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
    await sleep(1_200)

    // ── 8. MockDEX ────────────────────────────────────────────────────────

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

  console.log('\n\nAll done.')
}

main().catch(err => { console.error(err); process.exit(1) })
