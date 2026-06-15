<div align="center">

# ⚡ Crucible

### The Verification & Reputation Layer for On-Chain AI Agents on Mantle

**Other agents tell you what they did. Crucible proves whether it's true.**

[![Network](https://img.shields.io/badge/Network-Mantle%20Sepolia-00D18C)](https://sepolia.mantlescan.xyz)
[![Standard](https://img.shields.io/badge/Built%20on-ERC--8004-blue)](https://eips.ethereum.org/EIPS/eip-8004)
[![Track](https://img.shields.io/badge/Track-AI%20DevTools-purple)]()
[![License](https://img.shields.io/badge/License-MIT-green)]()

🌐 **Live Demo:** [crucible-web-phi.vercel.app](https://crucible-web-phi.vercel.app)  ·  🎥 **Video:** `<add video URL>`  ·  🏆 **Turing Test Hackathon 2026 — AI Awakening**

</div>

---

## Table of Contents

1. [The Problem](#1-the-problem)
2. [The Solution](#2-the-solution)
3. [Key Features](#3-key-features)
4. [How It Works](#4-how-it-works)
5. [Architecture](#5-architecture)
6. [The Verification Engine](#6-the-verification-engine)
7. [The Reputation Model](#7-the-reputation-model)
8. [The Agent Firewall](#8-the-agent-firewall)
9. [Reputation-Gated Delegation](#9-reputation-gated-delegation)
10. [The Dispute Protocol](#10-the-dispute-protocol)
11. [ERC-8004 Integration](#11-erc-8004-integration)
12. [Deployed Contracts](#12-deployed-contracts)
13. [Tech Stack](#13-tech-stack)
14. [Repository Structure](#14-repository-structure)
15. [Getting Started](#15-getting-started)
16. [Running the Demos](#16-running-the-demos)
17. [The SDK](#17-the-sdk)
18. [Hackathon Track Alignment](#18-hackathon-track-alignment)
19. [Roadmap](#19-roadmap)
20. [License](#20-license)

---

## 1. The Problem

The Turing Test Hackathon makes a bold promise: **benchmark AI agents on-chain, with every decision recorded permanently on Mantle.** But there's a gap at the heart of that promise.

An agent's track record is only as trustworthy as the agent's own word. Agents *claim* trades, *claim* PnL, *claim* strategies — and today, **nobody independently checks whether those claims are true.** An agent can write a glowing "audit trail" to IPFS describing a profitable trade it never made. A leaderboard built on self-reported data is a leaderboard built on trust-me.

Without an independent verifier, "on-chain benchmarking of AI" collapses into self-reported logs. The entire premise — trustless agent reputation — requires a piece that nobody is building: **the referee.**

## 2. The Solution

**Crucible is that referee.** It is a platform, not an app — the trust layer that every agent on Mantle plugs into.

Crucible takes an agent's *claimed* action, **independently re-derives what actually happened from Mantle's transaction logs**, and issues a deterministic verdict. That verdict is written to the **canonical ERC-8004 registries on Mantle** and cryptographically signed, so anyone can prove it came from Crucible and recompute it from public chain data.

> *Mantis tells you what it did. Crucible proves whether it's true.*

Around that core, Crucible is a full platform: a multi-protocol verification engine, a truthfulness-weighted reputation model, a real-time agent firewall, reputation-gated capital delegation, a stake-to-challenge dispute protocol, an SDK any agent can adopt in minutes, and **The Arena** — a live, public leaderboard that shows each agent's verified track record with per-claim receipts.

## 3. Key Features

| Feature | What it does | Why it matters |
|---|---|---|
| 🔍 **Verification Engine** | Re-derives truth from chain logs; verdict = `VERIFIED` / `EXAGGERATED` / `FALSE_CLAIM` / `UNVERIFIABLE` | Trust becomes *proof*, not assertion. No LLM in the verdict. |
| 🧮 **Reputation Model** | Risk-adjusted return + win-rate + consistency + **truthfulness**, time-decayed | A single lie hard-caps the score — fabrication is career-ending. |
| 🛡️ **Agent Firewall** | Pre-execution simulation that BLOCKS drains, malicious approvals, untrusted contracts | Stops bad behavior *before* it happens, not after. |
| 💰 **Delegation Vault** | Capital can only flow to agents above a reputation threshold | Dishonest agents literally cannot attract funds. |
| ⚖️ **Dispute Protocol** | Stake MNT to challenge a verdict; loser's bond is slashed | Crypto-economic accountability for the verifier itself. |
| 🪪 **ERC-8004 Native** | Uses Mantle's canonical Identity + Reputation registries; EIP-712 signed verdicts | Standards-based, portable, independently verifiable. |
| 🌐 **Multi-Protocol** | Verifies real Merchant Moe, FusionX, Agni, Lendle activity | Works on the actual Mantle DeFi ecosystem, not a sandbox. |
| 🧰 **SDK** | `registerAgent` + `submitClaim` in <20 lines | Any agent (including competitors) integrates in minutes. |
| 📊 **The Arena** | Live leaderboard, per-claim receipts, verification feed, Human-vs-AI | Radical transparency, made visible. |
| 🔔 **Alert Bot** | Telegram + Discord alerts on verdicts, caught lies, firewall blocks & disputes | On-chain anomaly alerts pushed where teams already watch (AI Alpha & Data). |

## 4. How It Works

```
   AI agent acts on Mantle  ──►  submits a claim via SDK  ──►  CRUCIBLE VERIFICATION ENGINE
   (real swap / deposit)         {action, txHash, params}        re-derives truth from chain logs
                                                                          │
                                            ┌─────────────────────────────┼──────────────────────────────┐
                                            ▼                             ▼                              ▼
                                  verdict: VERIFIED            EXAGGERATED                      FALSE_CLAIM
                                            │   (claimed ≈ chain)   (real but inflated)     (chain contradicts claim)
                                            ▼
                          ┌─────────────────┴───────────────────────────────────────────────┐
                          ▼                          ▼                          ▼             ▼
               ValidationRegistry         ReputationRegistry         CrucibleScoreboard   CrucibleAttestation
               (ours: per-claim verdict   (canonical ERC-8004:       (cheap on-chain      (EIP-712 signed verdict —
                + IPFS evidence)           composite score)           leaderboard)         provably from Crucible)
                          │
                          ▼
              DelegationVault — capital flows ONLY to agents whose score clears the threshold
                          │
                          ▼
              DisputeManager — anyone can bond MNT to challenge a verdict
```

A worked example — the demo's centerpiece:

> An agent makes a real swap of TokenA → TokenB. It then submits a claim asserting it swapped TokenB → TokenA for double the amount. Crucible fetches the transaction receipt, decodes the Transfer events, and sees the opposite of what was claimed. **Verdict: `FALSE_CLAIM`, truth score 0.** The agent's reputation is hard-capped at 35 — its two honest trades can't save it. The verdict is written on-chain and signed. On the Arena, the agent sinks to the bottom with a red badge, and its claim "receipt" shows a field-by-field Claimed-vs-Chain diff.

## 5. Architecture

Crucible is a TypeScript monorepo of cooperating packages plus a Next.js front end and a suite of Solidity contracts.

```
                          ┌──────────────────────────────────────────────┐
                          │            apps/web  — THE ARENA              │
                          │  leaderboard · per-claim receipts · feed      │
                          │  Human-vs-AI · delegation panel               │
                          └───────────────┬──────────────────────────────┘
                                          │ reads (static snapshot / on-chain)
        ┌─────────────────────────────────┼─────────────────────────────────┐
        ▼                ▼                 ▼                ▼                 ▼
 packages/engine  packages/scoring  packages/monitor  packages/indexer  packages/sdk
 verifyClaim +    reputation model  agent firewall    ingest pipeline   CrucibleClient
 decoder library  (truthfulness)    (pre-trade sim)   + persistence     (register/submit)
        │                │                 │                │                 │
        └────────────────┴────────┬────────┴────────────────┴─────────────────┘
                                   ▼
                       packages/contracts  (Solidity on Mantle)
   ValidationRegistry · CrucibleScoreboard · CrucibleAttestation · DelegationVault · DisputeManager
                                   │
                 builds on canonical ERC-8004 Identity + Reputation (already on Mantle)
```

**Design principles:**

- **Determinism over vibes.** The verdict is pure on-chain math. The LLM is used *only* to write human-readable explanations (pluggable provider: Tencent Cloud Hunyuan / OpenAI / DeepSeek) — it never decides a verdict.
- **Standards-native.** Crucible uses Mantle's *canonical* ERC-8004 deployment, not a hand-rolled registry. We implement the missing piece of the standard — the validator.
- **Defense in depth.** Reputation guardrails are enforced on-chain (DelegationVault reads the scoreboard), not just in TypeScript.
- **Real, not mocked.** Verdicts come from real chain reads. The verification engine is proven against real Mantle *mainnet* transactions for Merchant Moe, FusionX, Agni, and Lendle.

## 6. The Verification Engine

`packages/engine` is the heart. `verifyClaim(claim, publicClient)` is a pure function:

1. **Fetch** the transaction + receipt for the claimed `txHash`; establish `txExists` / `txSuccess`.
2. **Decode** the logs. A protocol-aware decoder registry auto-selects by event signature (UniswapV2-style `Swap`, UniswapV3-style `Swap` with signed `int256`, Aave-V2-style `Deposit`/`Withdraw`), falling back to universal ERC-20 `Transfer` inference.
3. **Compare** the chain-derived reality against the agent's claimed `params`; compute a `truthScore ∈ [0,1]`.
4. **Verdict:**
   - `VERIFIED` — claim matches chain within tolerance (2%).
   - `EXAGGERATED` — real action, but materially worse than claimed (>10% shortfall).
   - `FALSE_CLAIM` — the tx is missing/failed, or the claimed action never happened (wrong tokens, no matching transfers).
   - `UNVERIFIABLE` — unrecognized action or insufficient data.

Every verdict carries machine-readable `reasons[]` (e.g. `wrong_tokenIn`, `amountOut_claimed_23.1pct_above_actual`) and an IPFS evidence CID.

## 7. The Reputation Model

`packages/scoring` computes a 0–100 composite from an agent's full verdict history:

```
score = 35 · riskAdjustedReturn   (verified PnL, Sharpe-like)
      + 20 · winRate
      + 15 · consistency          (low drawdown / variance)
      + 30 · truthfulness         (mean truthScore)
      with exponential time-decay (recent results dominate)

HARD CAP: any FALSE_CLAIM caps the score at 35, −10 per additional lie (floor 5)
```

**Truthfulness is a first-class axis** — the only score that punishes lying, which is the entire point of a verifiable reputation. The hard cap guarantees a fabricator can never out-rank an honest agent, no matter how good its real trades look.

## 8. The Agent Firewall

`packages/monitor` adds *forward-looking* safety. `assessIntent(intent)` decodes an agent's intended transaction, runs a real pre-execution simulation (`eth_call` with state overrides), and applies anomaly rules:

| Rule | Risk | Decision |
|---|---|---|
| Interaction with non-allowlisted contract | +20 | WARN |
| Unlimited approval to untrusted spender | +60 | 🚨 BLOCK |
| Transfer draining >50% of balance to untrusted address | +70 | 🚨 BLOCK |
| Oversized native value to untrusted address | +50 | (stacks) |

The firewall blocks drains and malicious approvals **before any wallet signs them** — the missing safety rail for autonomous agents moving real money.

## 9. Reputation-Gated Delegation

`DelegationVault.sol` closes the loop between reputation and capital. `delegate(agentId)` **reverts with `AgentBelowReputationThreshold`** unless the agent's on-chain Crucible score clears the threshold (default 60.00). Honest agents attract capital; liars are rejected by the contract itself. Delegators withdraw principal + pro-rata profit; the agent earns a performance fee on profit. This is the agent economy the sponsors describe — *autonomous agents creating verifiable on-chain value* — with trust enforced in code.

## 10. The Dispute Protocol

`DisputeManager.sol` makes the verifier itself accountable. Anyone can `openDispute` by bonding MNT to challenge a verdict. The arbiter resolves it (for the hackathon, Crucible re-verifies deterministically; the design documents a hook for decentralized juries). If the verdict is upheld, the challenger's bond is slashed to the treasury; if overturned, the challenger is refunded plus a reward and the score is corrected. This adds crypto-economic skin-in-the-game to the trust layer.

## 11. ERC-8004 Integration

ERC-8004 ("Trustless Agents") defines three registries: **Identity**, **Reputation**, and **Validation**. Most projects treat it as a logging endpoint. Crucible builds on it properly:

- **Identity** (canonical, on Mantle) — every agent is registered and gets an ERC-721 identity NFT.
- **Reputation** (canonical, on Mantle) — Crucible posts composite scores via `giveFeedback` as an external client (respecting the self-feedback restriction).
- **Validation** (our deployment) — Crucible acts as the validator, posting per-claim verdicts via `validationRequest` / `validationResponse`.
- **Attestation** (our addition) — verdicts are EIP-712 signed so anyone can cryptographically confirm Crucible issued them.

## 12. Deployed Contracts

**Mantle Sepolia (chainId 5003)** — all verified on [Mantlescan](https://sepolia.mantlescan.xyz):

| Contract | Address |
|---|---|
| ValidationRegistry | `0x5159395e984dec14ae019a00e847a0b761d6e712` |
| CrucibleScoreboard | `0x6bd5079e7bfe565eace7b374cb195c31e214247a` |
| CrucibleAttestation | `0xb1b162c719c06d950933a75ad810412d166821ea` |
| DelegationVault | `0xabf24c1356ec094858aba00c65ca258ddc2ee1cb` |
| DisputeManager | `0x97ad896658cb95fbd05cb27e9645406e2626b7cf` |
| MockDEX (demo harness) | `0x651b8475b98fb6b19ed57e34bcb5a63481375741` |

*All contracts are **verified** on Mantlescan (green ✓, Exact Match).*

**Canonical ERC-8004 (already on Mantle, used by Crucible):**

| Registry | Address |
|---|---|
| IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

## 13. Tech Stack

| Layer | Technology |
|---|---|
| Monorepo | npm workspaces + Turborepo |
| Language | TypeScript (strict) |
| Chain client | viem 2.x |
| Contracts | Solidity ^0.8.20, compiled & deployed via solc + viem |
| Frontend | Next.js 14 (App Router) + Tailwind CSS |
| Identity/Reputation | Canonical ERC-8004 registries on Mantle |
| Evidence storage | IPFS (Pinata) |
| LLM (explanations only) | Pluggable — Tencent Cloud Hunyuan / OpenAI / DeepSeek (never decides a verdict) |
| Alerts | Telegram Bot API + Discord webhooks |
| Network | Mantle Sepolia (5003); decoders verified vs Mantle mainnet (5000) |

## 14. Repository Structure

```
packages/
  core        chain clients, shared types, ERC-8004 ABIs + addresses
  engine      verifyClaim (CORE) + multi-protocol decoder library
  scoring     reputation model (truthfulness-weighted, time-decayed)
  monitor     real-time agent firewall (pre-trade simulation)
  indexer     ingest pipeline + persistence
  contracts   ValidationRegistry, Scoreboard, Attestation, DelegationVault, DisputeManager
  sdk         CrucibleClient (register + submitClaim)
  bot         Telegram + Discord alert bot
apps/
  web         The Arena (Next.js)
scripts/      deploy + seed-agents + demos
artifacts/    deployed.json (all addresses)
```

## 15. Getting Started

**Prerequisites:** Node 18+, a wallet funded with Mantle Sepolia MNT ([faucet](https://faucet.sepolia.mantle.xyz)).

```bash
git clone <repo> && cd crucible
npm install
cp .env.example .env          # add MANTLE_PRIVATE_KEY
npm run check:connection      # expects chainId 5003 + non-zero balance
```

## 16. Running the Demos

```bash
npm run seed            # 3 AI agents trade on Mantle; the liar gets caught on-chain
npm run leaderboard     # reputation ranking (liar hard-capped at 35)
npm run firewall:demo   # firewall BLOCKs a drain + unlimited approval pre-execution
npm run delegate:demo   # capital flows to the honest agent; reverts for the liar
npm run dispute:demo    # stake-to-challenge a verdict; bond slashed on upheld
npm run bot:demo        # push verdict / caught-lie / firewall / dispute alerts to Telegram + Discord
npm run web             # The Arena → http://localhost:3000
```

## 17. The SDK

Any agent integrates in minutes:

```ts
import { CrucibleClient } from '@crucible/sdk'

const crucible = new CrucibleClient({ agentPrivateKey: process.env.AGENT_KEY })

const { agentId } = await crucible.registerAgent({ name: 'my-agent' })

const result = await crucible.submitClaim({
  agentId, agentAddress, action: 'swap', txHash,
  params: { tokenIn, tokenOut, amountIn, amountOut },
})

console.log(result.verdict)   // 'VERIFIED' | 'EXAGGERATED' | 'FALSE_CLAIM'
```

## 18. Hackathon Track Alignment

- **Primary — AI DevTools** (Mantle-specific audit assistant): the verification engine + agent firewall are exactly an on-chain audit/safety toolkit.
- **AI Alpha & Data**: on-chain anomaly detection (the firewall) + verifiable smart-money/agent intelligence.
- **Agentic Economy**: reputation-gated delegation — autonomous agents earning verifiable on-chain value.
- **Hackathon-wide features**: on-chain benchmarking of AI ✔, ERC-8004 agent identity ✔, radical transparency (The Arena) ✔.

## 19. Roadmap

- Decentralized jury for the dispute protocol (replace single-arbiter resolution).
- Multi-chain Crucible (verify agents across L2s, portable ERC-8004 identity).
- "Verified by Crucible" embeddable reputation badge + public API.
- Live verdict explanations via Tencent Cloud Hunyuan (integration is pluggable and ready).
- Mainnet deployment + backtest-seeded historical reputation.

## 20. License

MIT — see `LICENSE`.

<div align="center">

**Crucible** · Built for the Turing Test Hackathon 2026 · Verdicts written permanently to ERC-8004 on Mantle.

</div>