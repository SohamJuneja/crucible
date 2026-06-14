/**
 * Phase 8 contract suite — CrucibleScoreboard + CrucibleAttestation.
 * Runs against Mantle Sepolia (live RPC).
 *
 * Pre-requisite: npm run deploy:suite   (populates artifacts/deployed.json)
 * Run:           npx vitest run packages/contracts
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { createPublicClient, createWalletClient, http, type Abi } from 'viem'
import { mantleSepoliaTestnet } from 'viem/chains'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { describe, it, expect } from 'vitest'

// ── Load deployed addresses ─────────────────────────────────────────────────

interface DeployedJson {
  CrucibleScoreboard?:  { address: string }
  CrucibleAttestation?: { address: string }
}

const ARTIFACTS = path.resolve(process.cwd(), 'artifacts/deployed.json')
const deployed: DeployedJson = fs.existsSync(ARTIFACTS)
  ? (JSON.parse(fs.readFileSync(ARTIFACTS, 'utf8')) as DeployedJson)
  : {}

const SB_ADDRESS  = deployed.CrucibleScoreboard?.address  as `0x${string}` | undefined
const ATT_ADDRESS = deployed.CrucibleAttestation?.address as `0x${string}` | undefined

// ── Clients ─────────────────────────────────────────────────────────────────

const RPC = process.env.MANTLE_RPC_URL ?? 'https://rpc.sepolia.mantle.xyz'

const pc = createPublicClient({ chain: mantleSepoliaTestnet, transport: http(RPC) })

function verifierWalletClient() {
  const key = process.env.MANTLE_PRIVATE_KEY as `0x${string}` | undefined
  if (!key) throw new Error('MANTLE_PRIVATE_KEY not set in .env')
  return createWalletClient({ account: privateKeyToAccount(key), chain: mantleSepoliaTestnet, transport: http(RPC) })
}

// ── ABIs ─────────────────────────────────────────────────────────────────────

const SCOREBOARD_ABI = [
  {
    name: 'setScore', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'agentId', type: 'uint256' }, { name: 'score', type: 'uint16' }],
    outputs: [],
  },
  {
    name: 'getScore', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint16' }],
  },
] as const satisfies Abi

const ATTESTATION_VERIFY_ABI = [
  {
    name: 'verify', type: 'function', stateMutability: 'view',
    inputs: [
      {
        name: 'v', type: 'tuple',
        components: [
          { name: 'agentId',      type: 'uint256' },
          { name: 'txHash',       type: 'bytes32' },
          { name: 'verdict',      type: 'uint8'   },
          { name: 'truthScore',   type: 'uint16'  },
          { name: 'evidenceHash', type: 'bytes32' },
        ],
      },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [
      { name: 'signer',     type: 'address' },
      { name: 'isCrucible', type: 'bool'    },
    ],
  },
] as const satisfies Abi

const VERDICT_TYPES = {
  Verdict: [
    { name: 'agentId',      type: 'uint256' },
    { name: 'txHash',       type: 'bytes32' },
    { name: 'verdict',      type: 'uint8'   },
    { name: 'truthScore',   type: 'uint16'  },
    { name: 'evidenceHash', type: 'bytes32' },
  ],
} as const

// ── Shared test message ───────────────────────────────────────────────────────

const TEST_VERDICT_MSG = {
  agentId:      9001n,
  txHash:       '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as `0x${string}`,
  verdict:      1,     // VERIFIED
  truthScore:   9500,  // 0.9500 × 10000
  evidenceHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as `0x${string}`,
} as const

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CrucibleScoreboard', () => {
  it('setScore → getScore round-trip', async () => {
    if (!SB_ADDRESS) throw new Error('CrucibleScoreboard not deployed — run: npm run deploy:suite')

    const wc        = verifierWalletClient()
    const testScore = 7350  // encodes 73.50 (Math.round(73.50 * 100))

    let hash: `0x${string}`
    try {
      hash = await wc.writeContract({
        address: SB_ADDRESS, abi: SCOREBOARD_ABI, functionName: 'setScore',
        args: [TEST_VERDICT_MSG.agentId, testScore],
      })
    } catch {
      hash = await wc.writeContract({
        address: SB_ADDRESS, abi: SCOREBOARD_ABI, functionName: 'setScore',
        args: [TEST_VERDICT_MSG.agentId, testScore], gas: 200_000n,
      })
    }

    const receipt = await pc.waitForTransactionReceipt({ hash })
    expect(receipt.status).toBe('success')

    const stored = await pc.readContract({
      address: SB_ADDRESS, abi: SCOREBOARD_ABI, functionName: 'getScore',
      args: [TEST_VERDICT_MSG.agentId],
    })
    expect(stored).toBe(testScore)
  })
})

describe('CrucibleAttestation', () => {
  it('legitimate verifier signature → isCrucible == true', async () => {
    if (!ATT_ADDRESS) throw new Error('CrucibleAttestation not deployed — run: npm run deploy:suite')

    const wc     = verifierWalletClient()
    const domain = { name: 'Crucible', version: '1', chainId: mantleSepoliaTestnet.id, verifyingContract: ATT_ADDRESS }

    const signature = await wc.signTypedData({
      domain, types: VERDICT_TYPES, primaryType: 'Verdict', message: TEST_VERDICT_MSG,
    })

    const result = await pc.readContract({
      address:      ATT_ADDRESS,
      abi:          ATTESTATION_VERIFY_ABI,
      functionName: 'verify',
      args:         [TEST_VERDICT_MSG, signature],
    }) as readonly [string, boolean]

    const [, isCrucible] = result
    expect(isCrucible).toBe(true)
  })

  it('impostor key → isCrucible == false', async () => {
    if (!ATT_ADDRESS) throw new Error('CrucibleAttestation not deployed — run: npm run deploy:suite')

    const domain = { name: 'Crucible', version: '1', chainId: mantleSepoliaTestnet.id, verifyingContract: ATT_ADDRESS }

    const impostorKey = generatePrivateKey()
    const impostor    = createWalletClient({
      account:   privateKeyToAccount(impostorKey),
      chain:     mantleSepoliaTestnet,
      transport: http(RPC),
    })

    const signature = await impostor.signTypedData({
      domain, types: VERDICT_TYPES, primaryType: 'Verdict', message: TEST_VERDICT_MSG,
    })

    const result = await pc.readContract({
      address:      ATT_ADDRESS,
      abi:          ATTESTATION_VERIFY_ABI,
      functionName: 'verify',
      args:         [TEST_VERDICT_MSG, signature],
    }) as readonly [string, boolean]

    const [, isCrucible] = result
    expect(isCrucible).toBe(false)
  })
})
