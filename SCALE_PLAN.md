# Crucible — Scale Plan (large-scale architecture, roadmap, commit strategy)

This document turns Crucible from "a strong demo" into a project that visibly represents **weeks of
serious engineering** across many real subsystems — built fast with AI, but genuinely deep. It layers
on top of `BUILD_PLAYBOOK.md` (Phases 0–6 = the spine) with Phases 7–16 (the scale layers).

**Read order:** CLAUDE.md → BUILD_PLAYBOOK.md (spine) → this file (scale).

---

## 1. Why this is legitimately large-scale (not padding)

A platform that ranks *all* agents naturally needs many parts, each of which is real work:
contracts + a verification engine + a multi-protocol decoder library + a scoring model + an indexer
+ a real-time monitor + analytics + an SDK + a public API + a bot + an economy layer + two frontends.
Mantis is one app. Crucible is **eleven cooperating packages**. That breadth is the moat *and* the
"weeks of work" signal — and it maps to **four of the six hackathon tracks** at once.

### Track coverage (submit the same repo to multiple tracks)
| Track | Crucible subsystem that wins it |
|---|---|
| **AI DevTools** (audit assistants) | Verification Engine + real-time Agent Firewall/Monitor |
| **AI Alpha & Data** (anomaly detection, Telegram/Discord) | Reputation Analytics + Alerts Bot |
| **Agentic Wallets & Economy** (Byreal) | Delegation Vault + reputation-weighted fee economy |
| **(Meta) on-chain benchmarking of AI** | the whole platform + ERC-8004 attestations + disputes |

---

## 2. Full module map (the eleven packages)

```
                          ┌──────────────────────────────────────────────┐
                          │            apps/web  — THE ARENA              │
                          │ leaderboard · receipts · feed · Human-vs-AI   │
                          │ analytics dashboards · delegation UI          │
                          └───────────────┬──────────────────────────────┘
                                          │  reads
   apps/docs ◄── badge ───┐   ┌───────────┴───────────┐   ┌── bot (TG/Discord alerts)
                          │   │     packages/api      │   │
                          └──►│  REST/GraphQL + badge  │◄──┘
                              └───────────┬───────────┘
                                          │
        ┌─────────────────┬───────────────┼───────────────┬──────────────────┐
        ▼                 ▼               ▼               ▼                  ▼
 packages/indexer   packages/engine  packages/scoring packages/monitor  packages/analytics
 ingest + watcher   verifyClaim +    reputation model  agent firewall:   clustering, risk
 SQLite/Postgres    decoder library  + truthfulness    pre-sim + anomaly  time-series
        │                 │               │               │                  │
        └─────────────────┴───────┬───────┴───────────────┴──────────────────┘
                                   ▼
                         packages/contracts (on Mantle Sepolia)
        ValidationRegistry · CrucibleScoreboard · CrucibleAttestation(EIP-712)
        DisputeManager (stake-to-challenge) · DelegationVault (fee economy)
                                   │
                  uses canonical ERC-8004 Identity + Reputation (already deployed)
                                   ▲
                         packages/sdk ── any external agent (incl. Mantis) registers + submits
                                   ▲
                         scripts/seed-agents + scripts/backtest-replay (seed real history)
```

---

## 3. Subsystem specs (what each scale package actually does)

**packages/engine — multi-protocol decoder library.** Beyond Phase 2's swap/lending core, add a
decoder per major Mantle protocol so verification works across the ecosystem: Merchant Moe & Agni &
FusionX (DEX swaps + LP), Lendle & Init Capital (lending), Byreal/Hyperliquid (perps via the CLI +
on-chain settlement reads). Each decoder is its own file with its own tests. This breadth is what
makes Crucible credible as *the* universal verifier.

**packages/monitor — real-time Agent Firewall (AI DevTools track).** A block-watcher that subscribes
to registered agents' wallets, runs `eth_call`/state-override **pre-trade simulation** on pending
intents, and flags rogue/anomalous behavior (sudden leverage spikes, draining patterns, interaction
with unaudited contracts, guardrail breaches). Emits alerts and can pre-emptively lower an agent's
reputation. This is the "audit assistant" the track asks for, generalized.

**packages/scoring — reputation model.** The Section-6 formula plus richer risk metrics: Sharpe/Sortino,
max drawdown, volatility, recovery factor, consistency, and the hard truthfulness penalty. Fully
deterministic and unit-tested (incl. the invariant: a liar never out-ranks an honest agent).

**packages/contracts — the on-chain trust layer.** Five contracts with full Foundry test suites:
- `ValidationRegistry` — per-claim verdicts (our deploy of the ERC-8004 reference interface).
- `CrucibleScoreboard` — ranked composite scores, cheap leaderboard reads.
- `CrucibleAttestation` — EIP-712 signed verdicts so anyone can verify Crucible actually issued a verdict.
- `DisputeManager` — **stake-to-challenge**: anyone can bond MNT to dispute a verdict; resolution
  updates reputation and slashes the loser. This adds crypto-economic trust (an ERC-8004 trust model)
  and real game-theoretic depth judges respect.
- `DelegationVault` — users delegate test capital to top-verified agents; agents earn a performance
  fee; allocations are reputation-weighted. Closes the loop into the agent economy.

**packages/analytics — Nansen-style intelligence (AI Alpha & Data track).** Aggregations powering
dashboards: agent comparison, strategy clustering (group agents by behavior), risk surfaces,
PnL/drawdown time-series, "smart agent" cohort tracking. Recharts on the frontend.

**packages/api — public API + badge.** REST + GraphQL over the indexer with OpenAPI docs, plus an
embeddable SVG badge endpoint (`/badge/:agentId` → "Verified by Crucible: 87.4"). Network-effect surface.

**packages/bot — alerts (AI Alpha & Data track).** Telegram + Discord bot pushing: new verdicts,
caught lies, leaderboard moves, dispute events. The track literally names Telegram/Discord bots.

**packages/sdk — adoption layer.** `registerAgent` + `submitClaim` + `getReputation`, published and
documented so any hackathon team (Mantis included) integrates in minutes.

**scripts/backtest-replay — retroactive seeding.** Replays historical Mantle txs/claims through the
engine to seed reputation history, so the Arena launches with depth instead of an empty board.

---

## 4. Milestones

- **M1 — Spine (Phases 0–6):** end-to-end demo works. Agents trade → claims verified → liar caught →
  verdicts on-chain → Arena leaderboard + receipts + Human-vs-AI. **This must be done first and stay
  green.** Everything below is additive.
- **M2 — Depth & breadth (Phases 7–11):** decoder library, contracts suite (attestation + scoreboard),
  real-time monitor/firewall, analytics dashboards, public API + badge.
- **M3 — Economy & polish (Phases 12–16):** dispute protocol, delegation vault + fees, alerts bot,
  backtest seeding, docs site + landing + CI + demo recording.

Parallelize within a milestone (the packages are loosely coupled). Gate each phase as in the playbook.

---

## 5. Expanded phases (7–16) — same gated format as the playbook

For each: paste the prompt to Claude Code, run the PROOF, paste output back to me, I confirm before next.
Each prompt should still end with *"print exactly the PROOF OF DONE and nothing else; do not start the
next phase."*

### Phase 7 — Multi-protocol decoder library
**Prompt:** Extend `packages/engine` with a decoder per protocol (Merchant Moe, Agni, FusionX, Lendle,
Init Capital, Byreal perps). Each decoder: input a receipt, output the canonical derived action.
Add a registry that auto-selects the decoder by target address/event signatures, falling back to raw
ERC-20 `Transfer` decoding. Unit-test each decoder against ≥1 real Mantle Sepolia tx.
**PROOF:** `vitest run packages/engine` green; print the decoder→protocol table and one decoded result
per protocol with its explorer tx link.
**I check:** real txs per protocol, not stubs; fallback path works on an unknown protocol.

### Phase 8 — Contracts suite: CrucibleScoreboard + CrucibleAttestation (Foundry)
**Prompt:** In `packages/contracts` add `CrucibleScoreboard.sol` (store/read ranked scores) and
`CrucibleAttestation.sol` (EIP-712 signed verdicts; `verify(verdict, signature)` returns the signer).
Full Foundry tests (`forge test`) incl. signature verification and access control. Deploy both to
Mantle Sepolia; record in `artifacts/deployed.json`.
**PROOF:** `forge test` summary (all passing, show count); deploy tx links; a script that writes a
score and reads it back, and one that verifies a signed verdict on-chain.
**I check:** forge test count is substantial; attestation signature recovers Crucible's address.

### Phase 9 — Real-time monitor / Agent Firewall
**Prompt:** Build `packages/monitor`: a block-watcher over registered agent wallets + a pre-trade
simulator (viem `call` with state overrides) that scores an intended tx for risk BEFORE execution,
and an anomaly detector (leverage spikes, drain patterns, unaudited-contract interaction). Emit events
the indexer + bot consume; optionally push a reputation penalty.
**PROOF:** run `scripts/firewall-demo.ts` that simulates a malicious intent and prints the BLOCK
decision + reason, and a benign intent that passes. Show a real flagged on-chain example.
**I check:** the firewall blocks a genuinely bad simulated tx and passes a good one (not hard-coded).

### Phase 10 — Reputation analytics + dashboards
**Prompt:** Build `packages/analytics` aggregations (comparison, clustering, risk time-series) and add
dashboard pages to `apps/web` using Recharts: agent comparison, risk/drawdown over time, strategy
clusters, smart-agent cohort. Real data from the indexer.
**PROOF:** screenshots of each dashboard with real seed-agent data; the underlying aggregation unit tests pass.
**I check:** charts reflect real verdicts/scores; clustering separates the liar/mediocre/honest cohorts.

### Phase 11 — Public API + OpenAPI + embeddable badge
**Prompt:** Build `packages/api` (REST + GraphQL) over the indexer with OpenAPI docs, plus
`GET /badge/:agentId` returning an SVG "Verified by Crucible: <score>". Document in `apps/docs`.
**PROOF:** `curl` outputs for 3 endpoints + the rendered badge SVG for a seed agent; OpenAPI served.
**I check:** endpoints return real data; badge score matches the leaderboard.

### Phase 12 — Dispute protocol (stake-to-challenge)
**Prompt:** Add `DisputeManager.sol` (bond MNT to challenge a verdict; resolution path; slash loser;
update reputation) with Foundry tests, and wire a dispute UI + API. Keep resolution mechanism simple
but real (e.g. Crucible re-verification as arbiter for the hackathon, with the hook for future
decentralized juries documented).
**PROOF:** `forge test` for disputes passing; a script that opens, resolves, and shows the
reputation/slash effect with tx links.
**I check:** a successful challenge actually moves the agent's on-chain score and slashes the bond.

### Phase 13 — Delegation vault + fee economy
**Prompt:** Add `DelegationVault.sol`: users delegate test capital to a chosen top-verified agent;
agent executes within vault guardrails; performance fee accrues; reputation-weighted suggested
allocation. Foundry tests + a one-click delegate flow in `apps/web`.
**PROOF:** `forge test` passing; a delegate → (agent acts) → fee accrual → withdraw cycle with tx links;
UI screenshot of "delegate to #1".
**I check:** the full money loop works on testnet and ties allocation to reputation.

### Phase 14 — Alerts bot (Telegram + Discord)
**Prompt:** Build `packages/bot`: subscribe to indexer events; push new verdicts, caught lies,
leaderboard moves, disputes to a Telegram channel and a Discord webhook. Config via env.
**PROOF:** screenshots of a real alert in both Telegram and Discord triggered by a seed-agent verdict.
**I check:** a caught-lie event actually fires a message.

### Phase 15 — Backtest/replay seeding
**Prompt:** Build `scripts/backtest-replay.ts` that ingests a batch of historical claims/txs through
the engine to populate reputation history, so the Arena launches with a deep, believable leaderboard.
**PROOF:** run it; print before/after leaderboard depth (e.g. N agents, M verified claims) + a chart.
**I check:** the board looks alive with history, all from real verification (no fabricated rows).

### Phase 16 — Docs site, landing, CI, demo recording
**Prompt:** `apps/docs` landing + docs; `.github/workflows` CI (typecheck, lint, vitest, forge test);
top-level `README.md` + `DEMO.md` (3-min script). Record the demo.
**PROOF:** CI green badge on a pushed branch; fresh-clone quickstart works; demo video produced.
**I check:** CI passes from a clean checkout; the demo hits the north-star beats.

---

## 6. Commit & repo strategy (so the history reads as weeks of work — honestly)

- **Small, frequent, conventional commits.** One logical change per commit: `feat(engine): agni swap
  decoder`, `test(contracts): attestation signature recovery`, `fix(monitor): drain-pattern threshold`.
  A platform of this breadth naturally produces 150–300 honest commits — far past Mantis's 59.
- **Branch + PR per phase/subsystem.** Open a PR per package, let CI run, merge. PRs + CI history are
  strong "real engineering" signals to judges who open the repo.
- **Commit as you go, not in one dump.** Tell Claude Code to commit after each passing PROOF gate.
- **Keep messages truthful.** Don't inflate; the breadth is real. Squashing weeks of legitimate work
  into 3 commits would actually *hide* the scale — avoid that.
- **Tag milestones** (`v0.1-spine`, `v0.2-depth`, `v0.3-economy`) so progress is legible.
- **Document decisions** in `/docs/adr/` (short architecture decision records) — another depth signal.

Add to each phase prompt: *"After PROOF passes, commit with a conventional message and push. Do not
batch unrelated changes into one commit."*

---

## 7. Risk management for a big scope under 1 week

- **Spine is sacred.** If time gets tight, M1 (Phases 0–6) must be fully working and demo-able. Cut
  from M3 inward (drop Phase 13/15 before touching the spine).
- **Packages are loosely coupled** → parallelize with multiple Claude Code sessions if you have hands.
- **Contracts first within each milestone** (longest pole), UI last (fastest to vibe-code).
- **Every subsystem must show REAL output at its gate** — no subsystem counts as done on prose alone.
- **Don't let breadth dilute the demo.** The 3-minute story is still: trade → verify → catch the liar
  → on-chain verdict → Human-vs-AI → delegate. The extra subsystems are the "and it's a whole platform"
  backdrop, shown briefly, not narrated exhaustively.

---

## 8. Suggested 6-day mapping (strong AI-assisted team)

| Day | Focus |
|---|---|
| 1 | Phases 0–1 (scaffold, on-chain layer) + start Phase 2 engine |
| 2 | Phases 2–3 (engine core + scoring + on-chain verdicts) — spine half done |
| 3 | Phases 4–6 (seed agents incl. liar, SDK, Arena) — **spine demo-able by end of day 3** |
| 4 | Phases 7–9 (decoder library, contracts suite, firewall) |
| 5 | Phases 10–13 (analytics, API+badge, disputes, delegation vault) |
| 6 | Phases 14–16 (bot, backtest seeding, docs/CI) + polish + record demo |

Hitting "spine demo-able by end of day 3" is the key checkpoint — it means even if days 4–6 slip, you
have a winning submission, and everything after is upside.