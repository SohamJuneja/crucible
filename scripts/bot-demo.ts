/**
 * bot-demo.ts — sends one of each Crucible alert type to every configured channel.
 *
 * Reads agent data from apps/web/data/snapshot.json so names, addresses, and
 * tx hashes are real on-chain values — not invented.
 *
 * Channels are configured via .env:
 *   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID  → sends Telegram messages
 *   DISCORD_WEBHOOK_URL                    → sends Discord embeds
 *
 * Missing vars → that channel is silently skipped (no crash).
 *
 * Usage: npm run bot:demo
 */
import 'dotenv/config'
import fs   from 'fs'
import path from 'path'
import {
  sendTelegram,
  sendDiscord,
  verdictAlert,
  caughtLieAlert,
  firewallAlert,
  leaderboardAlert,
  disputeAlert,
  type AlertOutput,
} from '@crucible/bot'

// ── Load snapshot ─────────────────────────────────────────────────────────────

const SNAPSHOT_PATH = path.resolve(process.cwd(), 'apps/web/data/snapshot.json')
const ARTIFACTS     = path.resolve(process.cwd(), 'artifacts/deployed.json')

interface Snapshot {
  nameMap:       Record<string, string>
  cohortMap:     Record<string, string>
  agents:        Record<string, { walletAddress: string; score: number }>
  verifications: Array<{
    agentId:  string
    txHash:   string
    verdict:  string
    resultJson: string
  }>
}

function loadSnapshot(): Snapshot {
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    throw new Error(`snapshot.json not found — run \`npm run snapshot\` first`)
  }
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as Snapshot
}

// Reverse nameMap → { 'liar-bot': agentId, ... }
function buildNameIndex(snap: Snapshot): Record<string, string> {
  const idx: Record<string, string> = {}
  for (const [id, name] of Object.entries(snap.nameMap)) idx[name] = id
  return idx
}

function agentByName(snap: Snapshot, nameIdx: Record<string, string>, name: string) {
  const id = nameIdx[name]
  if (!id) throw new Error(`Agent "${name}" not found in snapshot`)
  return { id, address: snap.agents[id].walletAddress, score: snap.agents[id].score }
}

function firstVerdictTx(snap: Snapshot, agentId: string, verdict: string): string {
  const v = snap.verifications.find(v => v.agentId === agentId && v.verdict === verdict)
  return v?.txHash ?? '0x0000000000000000000000000000000000000000000000000000000000000000'
}

// ── Send helper ───────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

async function broadcast(label: string, alert: AlertOutput): Promise<void> {
  console.log(`\n─── ${label} ───`)
  console.log(alert.telegram.split('\n').map(l => '  ' + l).join('\n'))

  try {
    const sent = await sendTelegram(alert.telegram)
    if (sent) console.log('  [telegram] ✓ sent')
  } catch (err) {
    console.error(`  [telegram] ✗ ${(err as Error).message}`)
  }

  try {
    const sent = await sendDiscord(alert.discord)
    if (sent) console.log('  [discord]  ✓ sent')
  } catch (err) {
    console.error(`  [discord]  ✗ ${(err as Error).message}`)
  }

  // Brief pause so Discord doesn't rate-limit back-to-back webhooks
  await sleep(1_000)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Crucible alert bot — demo run')
  console.log(`Snapshot : ${SNAPSHOT_PATH}`)
  console.log()

  const snap    = loadSnapshot()
  const nameIdx = buildNameIndex(snap)

  // Real agents from snapshot
  const honest   = agentByName(snap, nameIdx, 'honest-bot')
  const liar     = agentByName(snap, nameIdx, 'liar-bot')
  const mediocre = agentByName(snap, nameIdx, 'mediocre-bot')
  const aiAlpha  = agentByName(snap, nameIdx, 'ai-alpha')

  // Real tx hashes from snapshot verifications
  const honestVerifiedTx  = firstVerdictTx(snap, honest.id, 'VERIFIED')
  const liarFalseTx       = firstVerdictTx(snap, liar.id,   'FALSE_CLAIM')
  const mediocreExaggTx   = firstVerdictTx(snap, mediocre.id, 'EXAGGERATED')

  // DisputeManager address for context
  const deployed    = fs.existsSync(ARTIFACTS)
    ? JSON.parse(fs.readFileSync(ARTIFACTS, 'utf8')) as Record<string, { address: string }>
    : null
  const disputeTx = deployed?.['DisputeManager']?.address
    ? `0x1eba24ffc8cdb98bc3467ce4cd60d00b4f4cd0a03b8e0dfe2fb79b2e85a23876`
    : liarFalseTx

  // ── Alert 1: VERIFIED verdict for honest-bot ─────────────────────────────

  await broadcast('1/5 — VERIFIED verdict', verdictAlert({
    agentName:    'honest-bot',
    agentAddress: honest.address,
    verdict:      'VERIFIED',
    truthScore:   0.98,
    score:        honest.score,
    action:       'swap',
    txHash:       honestVerifiedTx,
  }))

  // ── Alert 2: Caught lie — liar-bot FALSE_CLAIM ────────────────────────────

  await broadcast('2/5 — 🚨 Caught lie (FALSE_CLAIM)', caughtLieAlert({
    agentName:        'liar-bot',
    agentAddress:     liar.address,
    txHash:           liarFalseTx,
    claimedAmountOut: '2.40 CTKB',
    actualAmountOut:  '2.00 CTKB',
    inflatePct:       20,
    scoreBefore:      72.3,
    scoreAfter:       liar.score,
  }))

  // ── Alert 3: Firewall block ───────────────────────────────────────────────

  await broadcast('3/5 — 🛡️ Firewall block', firewallAlert({
    agentName:    'ai-alpha',
    agentAddress: aiAlpha.address,
    intent:       'swap 95% of balance to TOKEN_B in a single tx',
    risk:         'HIGH',
    reason:       'pre-trade simulation: balance drain >90% in one hop — anomaly detected',
  }))

  // ── Alert 4: Leaderboard move ─────────────────────────────────────────────

  await broadcast('4/5 — 📊 Leaderboard update', leaderboardAlert([
    { agentName: 'honest-bot',   rankBefore: 2, rankAfter: 1, score: honest.score   },
    { agentName: 'mediocre-bot', rankBefore: 1, rankAfter: 3, score: mediocre.score },
    { agentName: 'liar-bot',     rankBefore: 5, rankAfter: 7, score: liar.score     },
  ]))

  // ── Alert 5: Dispute opened → resolved (two alerts) ──────────────────────

  await broadcast('5a/5 — ⚖️ Dispute opened', disputeAlert({
    type:         'opened',
    agentName:    'liar-bot',
    agentAddress: liar.address,
    claimIndex:   3,
    bond:         '0.005 MNT',
  }))

  await broadcast('5b/5 — ⚖️ Dispute resolved', disputeAlert({
    type:         'resolved',
    agentName:    'liar-bot',
    agentAddress: liar.address,
    claimIndex:   3,
    bond:         '0.005 MNT',
    outcome:      'Challenger wins — FALSE_CLAIM confirmed, bond forfeited',
    txHash:       disputeTx,
  }))

  console.log('\n✅ Demo complete — check your Telegram and Discord channels.')
  console.log('\nTo re-run: npm run bot:demo')
}

main().catch(err => { console.error(err); process.exit(1) })
