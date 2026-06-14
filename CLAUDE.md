# CLAUDE.md — Crucible

> Project constitution for Claude Code. Read this fully before any task. Do not invent
> addresses, RPC URLs, or contract signatures — every hard fact you need is in here or
> in the linked source-of-truth repos. If something is missing, STOP and ask, do not guess.

---

## 1. What we are building

**Crucible** — the **verification, reputation, and trust platform** for on-chain AI agents on Mantle.

Other teams build trading agents. We build the **referee and the rails** every agent plugs into.
This is a platform with many real subsystems, not a single app. At its core: an independent service
takes an agent's *claimed* action, re-derives the *true* outcome from Mantle chain state, issues a
verdict (`VERIFIED` / `EXAGGERATED` / `FALSE_CLAIM` / `UNVERIFIABLE`), and writes that verdict to the
**canonical ERC-8004 registries**. A public "Arena" leaderboard ranks every agent by a tamper-proof,
time-decayed reputation score with **truthfulness** as a first-class axis.

Around that core we build a full platform (see SCALE_PLAN.md for the complete module map):
- **Verification Engine** with a multi-protocol decoder library (Merchant Moe, Agni, FusionX,
  Lendle, Init Capital, Byreal perps) — broad, real Mantle DeFi coverage.
- **Real-time monitor / agent firewall** — watches agent wallets live, simulates txs pre-execution,
  flags rogue/anomalous behavior (AI DevTools track).
- **Crucible attestation contracts** — EIP-712 signed verdicts + an on-chain ValidationRegistry +
  a CrucibleScoreboard, plus a **stake-to-challenge dispute protocol** (crypto-economic trust).
- **Reputation analytics** — Nansen-style dashboards: strategy clustering, agent comparison,
  risk/drawdown charts, time-series (AI Alpha & Data track).
- **Delegation vault + fee economy** — capital follows verified reputation; agents earn fees
  (Agentic Wallets & Economy track).
- **Crucible SDK + public API + embeddable "Verified by Crucible" badge** — network effects.
- **Alerts bot** (Telegram/Discord) for new verdicts, caught lies, leaderboard moves.
- **Backtest/replay harness** — replays historical agent claims to seed reputation retroactively.

One-liner: *"Other agents tell you what they did. Crucible proves whether it's true."*

We are NOT building another trading bot. If a task starts to look like "make the agent trade
better," it is out of scope — Crucible scores agents, it does not compete with them.

### Scope discipline (important)
This is large-scale ON PURPOSE — it must read as weeks of serious work. But protect the **spine**:
Phases 0–6 in BUILD_PLAYBOOK.md are the must-have demo. The SCALE_PLAN.md subsystems (Phases 7–16)
add depth and breadth and are largely parallelizable, but NEVER at the cost of breaking the spine.
Ship the spine demo-able first, then layer scale.

---

## 2. Hard network facts (Mantle Sepolia testnet) — DO NOT GUESS

| Key | Value |
|---|---|
| Network name | Mantle Sepolia Testnet |
| Chain ID | `5003` |
| RPC URL | `https://rpc.sepolia.mantle.xyz` |
| Gas token | `MNT` (NOT ETH) |
| Block explorer | `https://sepolia.mantlescan.xyz` |
| Explorer (alt) | `https://explorer.sepolia.mantle.xyz` |
| Faucet | `https://faucet.sepolia.mantle.xyz` |
| Mantlescan API | `https://api-sepolia.mantlescan.xyz/api` (needs `MANTLESCAN_API_KEY`) |

**viem chain import (use this, do not hand-define the chain):**
```ts
import { createPublicClient, createWalletClient, http } from 'viem'
import { mantleSepoliaTestnet } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

export const publicClient = createPublicClient({
  chain: mantleSepoliaTestnet,
  transport: http('https://rpc.sepolia.mantle.xyz'),
})
```

### Mantle gas gotcha (READ THIS — it causes most first-time failures)
Mantle is an L2 with an unusual gas model. `eth_estimateGas` can return very large numbers and
estimation sometimes reverts where the tx would actually succeed. If you hit gas-estimation
errors on writes or deploys:
1. Set an explicit high `gas` limit (e.g. `gas: 5_000_000n` for normal calls, higher for deploys).
2. Do not assume ETH-denominated fee math; MNT is the gas token.
3. Prefer viem's built-in `mantleSepoliaTestnet` config (it knows Mantle's fee fields).

---

## 3. Canonical ERC-8004 registries — ALREADY DEPLOYED, use these (do not redeploy)

Source of truth: https://github.com/erc-8004/erc-8004-contracts (README "Contract Addresses" →
"Mantle Testnet"). ABIs live in that repo's `abis/` directory — **copy ABIs from there, do not
write them by hand.**

| Registry | Mantle Sepolia address |
|---|---|
| IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| ValidationRegistry | NOT canonically deployed yet → **we deploy our own** from the reference repo |

**Before writing any contract call, fetch the matching ABI from `erc-8004-contracts/abis/` and
confirm the exact function name + argument order. The summaries below are conceptual, not
guaranteed signatures.**

### IdentityRegistry (ERC-721 agent identity)
- `register(...)` → mints an agent NFT, returns `agentId` (uint256). Sets `agentURI` (tokenURI)
  to a registration JSON (IPFS/HTTPS).
- `setAgentURI(agentId, newURI)` → update the registration file pointer.
- `tokenURI(agentId)`, `getAgentWallet(agentId)`, `getMetadata/setMetadata(agentId, key, value)`.

### ReputationRegistry (trust signals) — this is where Crucible posts scores
- `giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)` → records feedback for an `agentId`. Feedback `value` is an `int128` with `valueDecimals` (uint8), e.g. value=9977, valueDecimals=2 → 99.77. Carries `tag1`/`tag2`, an `endpoint` string (pass `""` when unused), and an optional off-chain `feedbackURI` + hash. **Self-feedback is blocked** — Crucible is an external client, which is exactly the intended caller. Crucible's wallet is the "client" giving feedback.
- `getSummary(agentId, clientAddresses, tag1, tag2)` → `(count, summaryValue, summaryValueDecimals)`.
  NOTE: `clientAddresses` must be non-empty (Sybil protection) — pass Crucible's verifier address.
- `readAllFeedback(agentId, clientAddresses, tag1, tag2, includeRevoked)`.

### ValidationRegistry (we deploy this one)
- `validationRequest(validatorAddress, agentId, requestURI, requestHash)` → called by the agent
  owner/operator to request validation of a claim.
- `validationResponse(requestHash, response /*uint8*/, responseURI, responseHash, tag)` → called
  by the validator (Crucible) to post the verdict.
- Reads: `getValidationStatus`, `getSummary`, `getAgentValidations`, `getValidatorRequests`.

**Our verdict → on-chain mapping:**
- Post the verdict to **our ValidationRegistry** via `validationResponse` (the rich, per-claim record).
- Post the resulting composite score to the **canonical ReputationRegistry** via `giveFeedback`
  (the aggregatable trust signal). Use `tag1 = "crucible"`, `tag2 = score-type`.

---

## 4. Tech stack & conventions

- **Language:** TypeScript everywhere. Strict mode on.
- **Frontend:** Next.js 14 App Router + Tailwind. Server components for reads where possible.
- **Chain client:** viem 2.x only (no ethers). Public client for reads, wallet client for writes.
- **Contracts:** Solidity ^0.8.20. Deploy our ValidationRegistry (+ optional `CrucibleScoreboard`)
  with a viem deploy script (`scripts/deploy.ts`), Mantlescan-verifiable.
- **Indexer/API:** Node service (can live in Next.js route handlers for the hackathon). SQLite via
  `better-sqlite3` for the cache. No heavy infra.
- **IPFS:** Pinata (`PINATA_JWT`) for registration files + claim payloads + verdict evidence.
- **AI:** LLM used ONLY for human-readable explanations of verdicts and failure classification.
  **Verification itself must be deterministic and chain-derived — never let the LLM decide a verdict.**
- **Money safety:** testnet only. Never move mainnet funds. Never put a private key in client code.

### Repo layout (target — npm workspaces + Turborepo monorepo, signals real scale)
```
/packages
  /contracts      Foundry/solc: ValidationRegistry, CrucibleScoreboard, CrucibleAttestation,
                  DisputeManager, DelegationVault (+ full test suites)
  /core           shared types, claim schema, constants, ERC-8004 ABIs + addresses
  /engine         verifyClaim (CORE) + decoders/{merchantMoe,agni,fusionx,lendle,init,byrealPerps}
  /scoring        reputation model, time-decay, truthfulness, risk metrics
  /indexer        ingest pipeline, SQLite/Postgres, block-watcher
  /monitor        real-time agent firewall: pre-trade simulation, anomaly/rogue detection
  /analytics      strategy clustering, comparison + risk time-series aggregations
  /sdk            crucible-sdk (register + submitClaim) — published, documented
  /api            REST/GraphQL service + OpenAPI docs + embeddable badge endpoint
  /bot            Telegram/Discord alert bot
/apps
  /web            Next.js Arena: leaderboard, /agent/[id] receipts, feed, Human-vs-AI, dashboards
  /docs           docs site / landing page
/scripts          deploy.ts, seed-agents/*, backtest-replay.ts, register-agent.ts
/artifacts        deployed.json
/.github/workflows CI (typecheck, lint, test, contract tests)
CLAUDE.md  SCALE_PLAN.md  BUILD_PLAYBOOK.md
```
Use small, frequent, conventional commits (`feat:`, `fix:`, `test:`, `chore:`) — one per logical
sub-task — so the history honestly reflects the breadth of work. See SCALE_PLAN.md "Commit strategy."

### Code rules for Claude Code
1. **Verify before you call.** Fetch the real ABI before writing any contract interaction; confirm
   function name + arg order. If the ABI contradicts this doc, trust the ABI and flag it.
2. **One concern per file.** Keep `verifyClaim.ts` pure and unit-testable (input: claim + chain
   reads; output: verdict object). No network side effects baked into the pure core.
3. **Every phase ends with a runnable proof.** A script that prints real output or a test that
   passes against a real Mantle Sepolia tx. No "trust me, it works."
4. **Never fabricate data.** No mock verdicts in the demo path. Seed agents make REAL txs.
5. **Secrets only in `.env`** (gitignored). Provide `.env.example`. Never log private keys.
6. **Small diffs, stop at phase boundaries.** Do not run ahead into the next phase.
7. **Determinism in the engine.** Same claim + same chain state → same verdict, always.

---

## 5. The claim schema (frozen contract between agents, engine, and chain)

```ts
// A claim is what an agent asserts it did. Crucible verifies it against chain state.
export interface AgentClaim {
  agentId: string            // ERC-8004 agentId (uint256 as string)
  agentAddress: `0x${string}`// the EOA/contract that executed the action
  action: 'swap' | 'lendDeposit' | 'lendWithdraw' | 'perpOpen' | 'perpClose'
  txHash: `0x${string}`      // the on-chain tx the agent says proves the action
  params: {                  // what the agent CLAIMS the action was
    tokenIn?: `0x${string}`; tokenOut?: `0x${string}`
    amountIn?: string; amountOut?: string   // base units (stringified bigint)
    market?: string; side?: 'long' | 'short'; sizeUsd?: string; leverage?: number
  }
  claimedPnlUsd?: string     // optional: agent's claimed PnL for this action
  reasoning?: string         // free text (for the receipt UI only, never affects verdict)
  timestamp: string          // ISO8601
}

export type Verdict = 'VERIFIED' | 'EXAGGERATED' | 'FALSE_CLAIM' | 'UNVERIFIABLE'

export interface VerificationResult {
  claim: AgentClaim
  verdict: Verdict
  truthScore: number         // 0..1, 1 = claim matches chain exactly
  derived: {                 // ground truth re-derived from chain
    txExists: boolean; txSuccess: boolean
    actualTokenIn?: string; actualTokenOut?: string
    actualAmountIn?: string; actualAmountOut?: string
    actualPnlUsd?: string; slippagePct?: number
  }
  reasons: string[]          // machine reasons (e.g. "amountOut 20% below claim")
  evidenceCid?: string       // IPFS CID of the full evidence JSON
}
```

---

## 6. Reputation scoring (transparent, recomputable)

```
score in [0, 100] =
    35 * riskAdjustedReturn   // verified PnL, normalized, Sharpe-like
  + 20 * winRate
  + 15 * consistency          // 1 - normalized maxDrawdown / variance
  + 30 * truthfulness         // mean(truthScore); a single FALSE_CLAIM caps this hard
with exponential time-decay (half-life ~ a few days) so recent verified results dominate.
```
- **Truthfulness is the differentiator.** `FALSE_CLAIM` is punished disproportionately — a lying
  agent must never out-rank an honest one. Make this visible in the UI.
- Only `VERIFIED`/`EXAGGERATED` PnL counts toward returns; `FALSE_CLAIM` PnL counts as 0 (or a
  penalty). `UNVERIFIABLE` is excluded from PnL but logged.

---

## 7. Demo north star (build toward this)

A live Arena where: agents trade on Mantle → each claim is verified against chain state → an honest
agent ranks high, a **lying agent gets caught (`FALSE_CLAIM`) and sinks** → verdicts are written to
ERC-8004 on-chain (show the explorer tx) → a Human-vs-AI scoreboard shows AI beating humans, every
point verified not claimed → any agent (Mantis included) can register via our SDK in minutes.

If a change doesn't move us toward that demo, deprioritize it.