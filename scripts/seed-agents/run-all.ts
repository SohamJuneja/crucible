/**
 * run-all.ts — runs one round for each seed bot, then prints a scored leaderboard.
 *
 * Personas:
 *   honest-bot   → truthful claims                    → expect VERIFIED
 *   mediocre-bot → inflates amountOut by 25%          → expect EXAGGERATED
 *   liar-bot     → 2 honest claims + 1 fabricated     → expect VERIFIED×2 + FALSE_CLAIM
 *
 * Usage: npm run seed   (requires .env + fixtures.json from npm run make:fixtures)
 */
import 'dotenv/config'
import {
  loadState, makeBotWallet, topUpIfNeeded, ensureRegistered, doSwap, publicClient,
  type BotName, type SeedState,
} from './agents'
import { getAgentHistory } from '@crucible/indexer'
import { REPUTATION_REGISTRY_ADDRESS, reputationRegistryAbi, getWalletClient } from '@crucible/core'
import { computeScore } from '@crucible/scoring'
import { CrucibleClient } from '@crucible/sdk'
import type { AgentClaim } from '@crucible/core'
import fixtures from '../../packages/engine/src/__tests__/fixtures.json'

// Small trade size — keep it tiny
const AMOUNT_IN = 1n * 10n ** 17n  // 0.1 tokenA per swap

const TOKEN_A = fixtures.tokenA as `0x${string}`
const TOKEN_B = fixtures.tokenB as `0x${string}`
const DEX     = fixtures.dex    as `0x${string}`

// ── honest-bot: one real swap, claim exactly what happened ─────────────────────

async function runHonestBot(state: SeedState): Promise<void> {
  console.log('\n══════ honest-bot ══════')
  await topUpIfNeeded('honest-bot', state['honest-bot'])
  const agentId = await ensureRegistered('honest-bot', state['honest-bot'], state)
  const wallet  = makeBotWallet(state['honest-bot'])

  const swap = await doSwap('honest-bot', wallet, TOKEN_A, TOKEN_B, DEX, AMOUNT_IN)

  const claim: AgentClaim = {
    agentId,
    agentAddress: wallet.account.address,
    action:       'swap',
    txHash:       swap.txHash,
    params: {
      tokenIn:   swap.tokenIn,
      tokenOut:  swap.tokenOut,
      amountIn:  swap.actualAmountIn.toString(),
      amountOut: swap.actualAmountOut.toString(),  // exact truth
    },
    timestamp: new Date().toISOString(),
  }
  console.log(`  claiming amountOut=${swap.actualAmountOut} (exact truth) → expect VERIFIED`)
  const client = new CrucibleClient({ agentPrivateKey: state['honest-bot'].privateKey })
  await client.submitClaim(claim)
}

// ── mediocre-bot: real swap, but inflates amountOut by 25% ────────────────────

async function runMediocreBot(state: SeedState): Promise<void> {
  console.log('\n══════ mediocre-bot ══════')
  await topUpIfNeeded('mediocre-bot', state['mediocre-bot'])
  const agentId = await ensureRegistered('mediocre-bot', state['mediocre-bot'], state)
  const wallet  = makeBotWallet(state['mediocre-bot'])

  const swap = await doSwap('mediocre-bot', wallet, TOKEN_A, TOKEN_B, DEX, AMOUNT_IN)

  // Inflate claimed amountOut by 25% — above EXAGGERATION_PCT(10%) threshold
  const inflatedOut = (swap.actualAmountOut * 125n / 100n).toString()

  const claim: AgentClaim = {
    agentId,
    agentAddress: wallet.account.address,
    action:       'swap',
    txHash:       swap.txHash,
    params: {
      tokenIn:   swap.tokenIn,
      tokenOut:  swap.tokenOut,
      amountIn:  swap.actualAmountIn.toString(),
      amountOut: inflatedOut,   // 25% above actual
    },
    timestamp: new Date().toISOString(),
  }
  console.log(`  actual=${swap.actualAmountOut}  claimed=${inflatedOut} (+25%) → expect EXAGGERATED`)
  const client = new CrucibleClient({ agentPrivateKey: state['mediocre-bot'].privateKey })
  await client.submitClaim(claim)
}

// ── liar-bot: 2 honest claims, then one fabricated (reversed token pair) ───────

async function runLiarBot(state: SeedState): Promise<void> {
  console.log('\n══════ liar-bot ══════')
  await topUpIfNeeded('liar-bot', state['liar-bot'])
  const agentId = await ensureRegistered('liar-bot', state['liar-bot'], state)
  const wallet  = makeBotWallet(state['liar-bot'])

  const client = new CrucibleClient({ agentPrivateKey: state['liar-bot'].privateKey })

  // ── Claim 1: honest → VERIFIED (builds apparent trust) ──────────────────────
  const swap1 = await doSwap('liar-bot', wallet, TOKEN_A, TOKEN_B, DEX, AMOUNT_IN)
  await client.submitClaim({
    agentId,
    agentAddress: wallet.account.address,
    action:       'swap',
    txHash:       swap1.txHash,
    params: {
      tokenIn:   swap1.tokenIn,
      tokenOut:  swap1.tokenOut,
      amountIn:  swap1.actualAmountIn.toString(),
      amountOut: swap1.actualAmountOut.toString(),
    },
    timestamp: new Date().toISOString(),
  } satisfies AgentClaim)
  console.log(`  claim 1 (truthful) → expect VERIFIED`)

  // ── Claim 2: honest → VERIFIED ────────────────────────────────────────────────
  const swap2 = await doSwap('liar-bot', wallet, TOKEN_A, TOKEN_B, DEX, AMOUNT_IN)
  await client.submitClaim({
    agentId,
    agentAddress: wallet.account.address,
    action:       'swap',
    txHash:       swap2.txHash,
    params: {
      tokenIn:   swap2.tokenIn,
      tokenOut:  swap2.tokenOut,
      amountIn:  swap2.actualAmountIn.toString(),
      amountOut: swap2.actualAmountOut.toString(),
    },
    timestamp: new Date().toISOString(),
  } satisfies AgentClaim)
  console.log(`  claim 2 (truthful) → expect VERIFIED`)

  // ── Claim 3: FABRICATED — reuse swap2's txHash but assert REVERSED token pair
  //    Engine will decode actual tokenIn=TOKEN_A, but claim says tokenIn=TOKEN_B
  //    → wrong_tokenIn → FALSE_CLAIM
  console.log(`  claim 3 (FABRICATED: reversed token pair on real tx) → expect FALSE_CLAIM`)
  await client.submitClaim({
    agentId,
    agentAddress: wallet.account.address,
    action:       'swap',
    txHash:       swap2.txHash,   // real tx — but claimed action never happened
    params: {
      tokenIn:   TOKEN_B,         // LIE: claim tokenB was the input
      tokenOut:  TOKEN_A,         // LIE: claim tokenA was the output
      amountIn:  swap2.actualAmountOut.toString(),
      amountOut: swap2.actualAmountIn.toString(),
    },
    timestamp: new Date().toISOString(),
  } satisfies AgentClaim)
}

// ── Leaderboard ────────────────────────────────────────────────────────────────

async function printLeaderboard(state: SeedState): Promise<void> {
  const verifier = getWalletClient().account.address
  const BOTS: BotName[] = ['honest-bot', 'mediocre-bot', 'liar-bot']

  const rows: Array<{
    rank:         number
    bot:          BotName
    agentId:      string
    trades:       number
    lastVerdict:  string
    localScore:   number    // computeScore(fullHistory) — used for ranking
    onChainScore: string    // getSummary value — informational only
  }> = []

  for (const bot of BOTS) {
    const agentId = state[bot].agentId ?? '—'
    const history  = agentId !== '—' ? getAgentHistory(agentId) : []

    // ── Ranking score: recompute from full local verdict history ──────────────
    const localScore = computeScore(history)

    // ── On-chain score: raw getSummary snapshot (informational) ──────────────
    let onChainScore = 'n/a'
    if (agentId !== '—') {
      try {
        const [count, summaryValue, summaryDecimals] = await publicClient.readContract({
          address:      REPUTATION_REGISTRY_ADDRESS,
          abi:          reputationRegistryAbi,
          functionName: 'getSummary',
          args:         [BigInt(agentId), [verifier], 'crucible', 'score'],
        }) as [bigint, bigint, number]
        if (count > 0n) {
          onChainScore = (Number(summaryValue) / 10 ** summaryDecimals).toFixed(2)
        }
      } catch {}
    }

    rows.push({
      rank: 0, bot, agentId,
      trades: history.length,
      lastVerdict: history.at(-1)?.verdict ?? '—',
      localScore,
      onChainScore,
    })
  }

  // ── Sort by recomputed local score (NOT getSummary average) ──────────────
  rows.sort((a, b) => b.localScore - a.localScore)
  rows.forEach((r, i) => { r.rank = i + 1 })

  // ── Print table ────────────────────────────────────────────────────────────
  const C   = [5, 14, 10, 7, 15, 14, 12]
  const sep = C.map(w => '─'.repeat(w)).join('─┼─')
  const hdr = ['Rank', 'Agent', 'AgentId', 'Trades', 'Last Verdict', 'Score (local)', 'On-chain avg']
    .map((h, i) => h.padEnd(C[i])).join(' │ ')

  console.log('\n\n╔══ LEADERBOARD ════════════════════════════════════════════════════════╗')
  console.log(`  ${hdr}`)
  console.log(`  ${sep}`)
  rows.forEach(r => {
    const icon = r.lastVerdict === 'FALSE_CLAIM' ? '🚨' : r.lastVerdict === 'VERIFIED' ? '✓' : '≈'
    const line = [
      `#${r.rank}`.padEnd(C[0]),
      r.bot.padEnd(C[1]),
      r.agentId.padEnd(C[2]),
      String(r.trades).padEnd(C[3]),
      (`${icon} ${r.lastVerdict}`).padEnd(C[4] + 2),
      r.localScore.toFixed(2).padEnd(C[5]),
      r.onChainScore,
    ].join(' │ ')
    console.log(`  ${line}`)
  })
  console.log('╚═══════════════════════════════════════════════════════════════════════╝')
  console.log('  Ranking: computeScore(full history).  On-chain avg = ReputationRegistry.getSummary.')

  // ── Scoring integrity check ────────────────────────────────────────────────
  const honest  = rows.find(r => r.bot === 'honest-bot')!
  const liar    = rows.find(r => r.bot === 'liar-bot')!
  const mediocre = rows.find(r => r.bot === 'mediocre-bot')!

  if (honest.rank === 1 && liar.rank === rows.length) {
    console.log('\n✅ Invariant holds: honest #1, liar last.')
  } else if (liar.localScore > mediocre.localScore) {
    console.log(`\n⚠️  liar (${liar.localScore.toFixed(2)}) outranks mediocre (${mediocre.localScore.toFixed(2)}) — steepen FALSE_CLAIM_CAP_BASE in computeScore.ts`)
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  if (fixtures.honestSwap.txHash.startsWith('0x0000')) {
    console.error('fixtures.json is a placeholder — run: npm run make:fixtures first')
    process.exit(1)
  }

  const state = loadState()

  await runHonestBot(state)
  await runMediocreBot(state)
  await runLiarBot(state)

  await printLeaderboard(state)
}

main().catch(err => { console.error(err); process.exit(1) })
