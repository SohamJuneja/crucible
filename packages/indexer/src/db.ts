/**
 * Lightweight JSON-file store.
 * Replaces better-sqlite3 (fails to compile on Node 24 / MSVC on Windows).
 * Same external API — drop-in for any future migration to SQLite/Postgres.
 */
import fs from 'fs'
import path from 'path'
import type { VerificationResult } from '@crucible/core'

const DB_PATH = process.env.CRUCIBLE_DB_PATH ?? path.resolve(process.cwd(), 'crucible-db.json')

interface Store {
  agents: Record<string, { walletAddress: string; score: number; updatedAt: number }>
  verifications: Array<{
    id:                   number
    agentId:              string
    txHash:               string
    verdict:              string
    truthScore:           number
    resultJson:           string
    evidenceUri:          string | null
    requestHash:          string | null
    validationTxHash:     string | null
    feedbackTxHash:       string | null
    scoreboardTxHash:     string | null   // CrucibleScoreboard.setScore tx
    attestationSignature: string | null   // EIP-712 verdict signature
    createdAt:            number
  }>
}

function load(): Store {
  if (fs.existsSync(DB_PATH)) {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) as Store
  }
  return { agents: {}, verifications: [] }
}

function save(store: Store): void {
  fs.writeFileSync(DB_PATH, JSON.stringify(store, null, 2))
}

export function upsertAgent(agentId: string, walletAddress: string): void {
  const store = load()
  store.agents[agentId] = {
    walletAddress,
    score:     store.agents[agentId]?.score ?? 0,
    updatedAt: Math.floor(Date.now() / 1000),
  }
  save(store)
}

export function insertVerification(row: {
  agentId:               string
  txHash:                string
  verdict:               string
  truthScore:            number
  result:                VerificationResult
  evidenceUri?:          string
  requestHash?:          string
  validationTxHash?:     string
  feedbackTxHash?:       string
  scoreboardTxHash?:     string   // CrucibleScoreboard.setScore tx (Phase 8)
  attestationSignature?: string   // EIP-712 verdict signature (Phase 8)
}): void {
  const store = load()
  store.verifications.push({
    id:                   store.verifications.length + 1,
    agentId:              row.agentId,
    txHash:               row.txHash,
    verdict:              row.verdict,
    truthScore:           row.truthScore,
    resultJson:           JSON.stringify(row.result),
    evidenceUri:          row.evidenceUri          ?? null,
    requestHash:          row.requestHash          ?? null,
    validationTxHash:     row.validationTxHash     ?? null,
    feedbackTxHash:       row.feedbackTxHash       ?? null,
    scoreboardTxHash:     row.scoreboardTxHash     ?? null,
    attestationSignature: row.attestationSignature ?? null,
    createdAt:            Math.floor(Date.now() / 1000),
  })
  save(store)
}

export function updateAgentScore(agentId: string, score: number): void {
  const store = load()
  if (store.agents[agentId]) {
    store.agents[agentId].score     = score
    store.agents[agentId].updatedAt = Math.floor(Date.now() / 1000)
  }
  save(store)
}

/** Returns full VerificationResult history for an agent, oldest first. */
export function getAgentHistory(agentId: string): VerificationResult[] {
  const store = load()
  return store.verifications
    .filter(v => v.agentId === agentId)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(v => JSON.parse(v.resultJson) as VerificationResult)
}
