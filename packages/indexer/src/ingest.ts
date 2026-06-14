/**
 * ingestClaim — the Crucible verification pipeline.
 *
 * Flow (all sequential, one tx at a time):
 *   1. verifyClaim      → deterministic verdict from chain state
 *   2. build + hash evidence JSON (IPFS if PINATA_JWT set, local file otherwise)
 *   3. validationRequest  ← AGENT wallet (self-feedback rules require a separate signer)
 *   4. validationResponse ← CRUCIBLE VERIFIER wallet
 *   5. computeScore from full history
 *   6. giveFeedback       ← CRUCIBLE VERIFIER wallet → ReputationRegistry
 *   7. persist to SQLite
 */
import { createHash } from 'crypto'
import fs from 'fs'
import path from 'path'
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toHex,
  type Abi,
} from 'viem'
import { mantleSepoliaTestnet } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import {
  getWalletClient,
  REPUTATION_REGISTRY_ADDRESS,
  reputationRegistryAbi,
} from '@crucible/core'
import type { AgentClaim, VerificationResult, Verdict } from '@crucible/core'
import { verifyClaim } from '@crucible/engine'
import { computeScore } from '@crucible/scoring'
import {
  upsertAgent,
  insertVerification,
  getAgentHistory,
  updateAgentScore,
} from './db.js'

// ── ValidationRegistry ABI (inline — no dependency on deploy script output) ──
const VALIDATION_REGISTRY_ABI = [
  {
    name: 'validationRequest',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'validatorAddress', type: 'address' },
      { name: 'agentId',          type: 'uint256' },
      { name: 'requestURI',       type: 'string'  },
      { name: 'requestHash',      type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'validationResponse',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'requestHash',  type: 'bytes32' },
      { name: 'response',     type: 'uint8'   },
      { name: 'responseURI',  type: 'string'  },
      { name: 'responseHash', type: 'bytes32' },
      { name: 'tag',          type: 'bytes32' },
    ],
    outputs: [],
  },
] as const satisfies Abi

// Verdict → uint8 mapping (mirrors ValidationRegistry.sol constants)
const VERDICT_CODE: Record<Verdict, number> = {
  VERIFIED:     1,
  EXAGGERATED:  2,
  FALSE_CLAIM:  3,
  UNVERIFIABLE: 4,
}

// ── helpers ────────────────────────────────────────────────────────────────────

function getValidationRegistryAddress(): `0x${string}` {
  const p = path.resolve(process.cwd(), 'artifacts/deployed.json')
  if (!fs.existsSync(p)) {
    throw new Error('artifacts/deployed.json not found — run: npm run deploy:validation')
  }
  const addr = (JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, { address?: string }>)
    .ValidationRegistry?.address
  if (!addr) {
    throw new Error('ValidationRegistry not in artifacts/deployed.json — run: npm run deploy:validation')
  }
  return addr as `0x${string}`
}

async function resolveEvidenceUri(evidenceJson: string): Promise<string> {
  if (process.env.PINATA_JWT) {
    const res = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.PINATA_JWT}` },
      body:    JSON.stringify({ pinataContent: JSON.parse(evidenceJson) }),
    })
    if (!res.ok) throw new Error(`Pinata ${res.status}: ${await res.text()}`)
    const { IpfsHash } = (await res.json()) as { IpfsHash: string }
    return `ipfs://${IpfsHash}`
  }

  const dir   = path.resolve(process.cwd(), 'evidence')
  const hash  = createHash('sha256').update(evidenceJson).digest('hex')
  const fpath = path.join(dir, `${hash.slice(0, 16)}.json`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(fpath, evidenceJson)
  return `file://${fpath}`
}

type WC = ReturnType<typeof createWalletClient>
type PC = ReturnType<typeof createPublicClient>

async function writeWithGas(
  wc: WC,
  pc: PC,
  params: Parameters<WC['writeContract']>[0],
  label: string,
): Promise<`0x${string}`> {
  console.log(`  [${label}] submitting...`)
  let hash: `0x${string}`
  try {
    hash = await wc.writeContract(params as never)
  } catch {
    hash = await wc.writeContract({ ...(params as never), gas: 500_000n })
  }
  const receipt = await pc.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') {
    console.error(`\n🚨 [${label}] TX REVERTED  hash=${hash}  block=${receipt.blockNumber}  gasUsed=${receipt.gasUsed}`)
    throw new Error(`[${label}] transaction reverted: ${hash}`)
  }
  console.log(`  [${label}] confirmed ✓  hash=${hash}`)
  return hash
}

// ── Public API ─────────────────────────────────────────────────────────────────

export interface IngestResult {
  verificationResult: VerificationResult
  requestHash:        `0x${string}`
  validationTxHash:   `0x${string}`
  feedbackTxHash:     `0x${string}`
  score:              number
  evidenceUri:        string
}

export async function ingestClaim(
  claim:           AgentClaim,
  agentPrivateKey: `0x${string}`,
): Promise<IngestResult> {
  const pc = createPublicClient({
    chain:     mantleSepoliaTestnet,
    transport: http(process.env.MANTLE_RPC_URL ?? 'https://rpc.sepolia.mantle.xyz'),
  })

  // 1. Deterministic verification — pure chain read, no LLM
  console.log(`\n[ingest] verifying ${claim.action} tx=${claim.txHash}`)
  const result = await verifyClaim(claim, pc)
  console.log(`[ingest] verdict=${result.verdict}  truthScore=${result.truthScore.toFixed(3)}`)

  // 2. Build + hash evidence
  const crucibleWallet  = getWalletClient()
  const verifierAddress = crucibleWallet.account.address
  const evidenceJson    = JSON.stringify({ claim, result, verifier: verifierAddress, generatedAt: new Date().toISOString() }, null, 2)
  const evidenceBytes32 = ('0x' + createHash('sha256').update(evidenceJson).digest('hex')) as `0x${string}`

  // 3. Persist evidence (IPFS or local file — hash is written on-chain either way)
  const evidenceUri = await resolveEvidenceUri(evidenceJson)
  console.log(`[ingest] evidence → ${evidenceUri}`)

  // 4. Deterministic requestHash (unique per agent × claim)
  const requestHash = keccak256(toHex(`crucible:${claim.agentId}:${claim.txHash}:${claim.timestamp}`))

  const validationRegistryAddress = getValidationRegistryAddress()

  // 5. validationRequest — MUST come from the AGENT wallet
  //    (self-feedback rule: crucible verifier ≠ agent owner)
  const agentWallet = createWalletClient({
    account:   privateKeyToAccount(agentPrivateKey),
    chain:     mantleSepoliaTestnet,
    transport: http(process.env.MANTLE_RPC_URL ?? 'https://rpc.sepolia.mantle.xyz'),
  })
  await writeWithGas(agentWallet, pc, {
    address:      validationRegistryAddress,
    abi:          VALIDATION_REGISTRY_ABI,
    functionName: 'validationRequest',
    args:         [verifierAddress, BigInt(claim.agentId), evidenceUri, requestHash],
  }, 'validationRequest')

  // 6. validationResponse — from CRUCIBLE VERIFIER
  const verdictCode = VERDICT_CODE[result.verdict]
  const verdictTag  = keccak256(toHex(result.verdict))  // bytes32 tag
  const validationTxHash = await writeWithGas(crucibleWallet, pc, {
    address:      validationRegistryAddress,
    abi:          VALIDATION_REGISTRY_ABI,
    functionName: 'validationResponse',
    args:         [requestHash, verdictCode, evidenceUri, evidenceBytes32, verdictTag],
  }, 'validationResponse')

  // 7. Compute composite score over full agent history
  const history = getAgentHistory(claim.agentId)
  history.push(result)
  const score = computeScore(history)
  console.log(`[ingest] agent ${claim.agentId} → score ${score.toFixed(2)}/100`)

  // 8. giveFeedback — from CRUCIBLE VERIFIER → canonical ReputationRegistry
  //    value = round(score * 100), valueDecimals = 2  (so 9250 → 92.50)
  //    tag1 = "crucible", tag2 = "score" (constant — keeps aggregate queryable)
  //    The per-claim verdict lives in evidenceURI/evidence JSON, not in tag2.
  const FEEDBACK_TAG1 = 'crucible'
  const FEEDBACK_TAG2 = 'score'      // single constant so getSummary queries always match

  const feedbackValue = BigInt(Math.round(score * 100))
  const feedbackHash  = ('0x' + createHash('sha256')
    .update(`${claim.agentId}:${score}:${validationTxHash}`)
    .digest('hex')) as `0x${string}`

  // ── diagnostic: confirm address and exact args before writing ────────────────
  console.log(`\n  [diag] REPUTATION_REGISTRY_ADDRESS = ${REPUTATION_REGISTRY_ADDRESS}`)
  console.log(`  [diag]   (canonical from CLAUDE.md §3: 0x8004B663056A597Dffe9eCcC1965A193B7388713)`)
  console.log(`  [giveFeedback] writer (verifier) = ${verifierAddress}`)
  console.log(`  [giveFeedback] agentId=${claim.agentId}  value=${feedbackValue}  decimals=2  tag1="${FEEDBACK_TAG1}"  tag2="${FEEDBACK_TAG2}"`)
  console.log(`  [giveFeedback] endpoint=""  feedbackURI=${evidenceUri}  feedbackHash=${feedbackHash}`)

  // ── simulate first so we get the revert reason if it would fail ───────────
  console.log(`  [giveFeedback] simulating...`)
  try {
    await pc.simulateContract({
      address:      REPUTATION_REGISTRY_ADDRESS,
      abi:          reputationRegistryAbi,
      functionName: 'giveFeedback',
      account:      verifierAddress,
      args: [
        BigInt(claim.agentId),
        feedbackValue,
        2,
        FEEDBACK_TAG1,
        FEEDBACK_TAG2,
        '',
        evidenceUri,
        feedbackHash,
      ],
    })
    console.log(`  [giveFeedback] simulation OK — proceeding to write`)
  } catch (simErr) {
    console.error(`\n🚨 [giveFeedback] SIMULATION REVERTED — revert reason:`, simErr)
    throw simErr
  }

  const feedbackTxHash = await writeWithGas(crucibleWallet, pc, {
    address:      REPUTATION_REGISTRY_ADDRESS,
    abi:          reputationRegistryAbi,
    functionName: 'giveFeedback',
    args: [
      BigInt(claim.agentId),
      feedbackValue,
      2,              // valueDecimals
      FEEDBACK_TAG1,
      FEEDBACK_TAG2,
      '',             // endpoint (unused per spec)
      evidenceUri,    // feedbackURI
      feedbackHash,   // feedbackHash
    ],
  }, 'giveFeedback')

  // ── diagnostic: read back ALL stored feedback to see exact on-chain state ──
  console.log(`\n  [diag] readAllFeedback(agentId=${claim.agentId}, clients=[${verifierAddress}], tag1="", tag2="", includeRevoked=true)`)
  try {
    type RawFeedback = [string[], bigint[], bigint[], number[], string[], string[], boolean[]]
    const raw = await pc.readContract({
      address:      REPUTATION_REGISTRY_ADDRESS,
      abi:          reputationRegistryAbi,
      functionName: 'readAllFeedback',
      args:         [BigInt(claim.agentId), [verifierAddress], '', '', true],
    }) as RawFeedback
    const [clients, indexes, values, decimals, t1s, t2s, revoked] = raw
    console.log(`  [diag] readAllFeedback: ${clients.length} entr${clients.length === 1 ? 'y' : 'ies'} found`)
    for (let i = 0; i < clients.length; i++) {
      console.log(`    [${i}] client=${clients[i]}  index=${indexes[i]}  value=${values[i]}  decimals=${decimals[i]}  tag1="${t1s[i]}"  tag2="${t2s[i]}"  revoked=${revoked[i]}`)
    }
  } catch (readErr) {
    console.error(`  [diag] readAllFeedback threw:`, readErr)
  }

  // 9. Persist to SQLite
  upsertAgent(claim.agentId, claim.agentAddress)
  insertVerification({
    agentId:           claim.agentId,
    txHash:            claim.txHash,
    verdict:           result.verdict,
    truthScore:        result.truthScore,
    result,
    evidenceUri,
    requestHash,
    validationTxHash,
    feedbackTxHash,
  })
  updateAgentScore(claim.agentId, score)

  console.log(`[ingest] persisted. validationTx=${validationTxHash}  feedbackTx=${feedbackTxHash}`)

  return { verificationResult: result, requestHash, validationTxHash, feedbackTxHash, score, evidenceUri }
}
