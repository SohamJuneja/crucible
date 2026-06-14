# ⚡ Crucible

**The verification & reputation layer for on-chain AI agents on Mantle.**

> Other agents tell you what they did. **Crucible proves whether it's true.**

- 🏆 **Track:** AI DevTools (Mantle-specific audit assistant) · also AI Alpha & Data · Agentic Economy
- 🌐 **Live demo:** _<add Vercel URL>_
- 🎥 **Demo video:** _<add video link>_
- 🔗 **Network:** Mantle Sepolia (chainId 5003) · built on the **canonical ERC-8004 registries**

---

## The problem

The Turing Test Hackathon benchmarks AI agents on-chain — but an agent's track record is only as trustworthy as the agent's own word. Agents *claim* trades, PnL, and strategies. Nobody independently checks whether those claims are true. Without a verifier, "on-chain benchmarking of AI" is just self-reported logs.

## What Crucible does

Crucible is the **referee**. It takes an agent's *claimed* action, **re-derives the truth from Mantle chain state**, issues a verdict, and writes that verdict to the canonical ERC-8004 registries — producing a tamper-proof, time-decayed reputation score with **truthfulness** as a first-class axis.

It does three things no trading bot does:

1. **Verifies claims against chain reality.** Every claim → `VERIFIED` / `EXAGGERATED` / `FALSE_CLAIM` / `UNVERIFIABLE`, derived deterministically from transaction logs (no LLM in the verdict). Works on real Mantle DeFi protocols (Merchant Moe, FusionX, Agni, Lendle), not just a sandbox.
2. **Blocks malicious intent before it executes.** A real-time **Agent Firewall** simulates an agent's intended transaction and blocks drains, unlimited approvals, and interactions with untrusted contracts — pre-execution.
3. **Gates capital by reputation.** A **Delegation Vault** only lets capital flow to agents whose Crucible score clears a threshold — a liar (score 35) literally cannot attract delegated funds (`AgentBelowReputationThreshold`).

## Why it matters to Mantle

Crucible is **infrastructure every agent plugs into**, not another app. It's the trust rail that makes the hackathon's own premise — benchmarking AI agents on-chain — actually verifiable. It uses the **canonical ERC-8004 deployment on Mantle** (not a hand-rolled registry), verifies real Mantle DeFi activity, and writes every verdict permanently on-chain.

---

## How it works

```
Agent acts on Mantle ─► submits a claim ─► Crucible Verification Engine
                                              │  (re-derives truth from chain logs)
                                              ▼
                    verdict: VERIFIED / EXAGGERATED / FALSE_CLAIM
                                              │
            ┌─────────────────────────────────┼─────────────────────────────────┐
            ▼                                 ▼                                 ▼
   ValidationRegistry (ours)        ReputationRegistry (canonical)      CrucibleScoreboard
   per-claim verdict + evidence     composite score via giveFeedback    cheap on-chain leaderboard
            │                                                                   │
            ▼                                                                   ▼
   CrucibleAttestation (EIP-712 signed verdict)                      DelegationVault
   anyone can verify Crucible issued it                    capital flows only to verified agents
```

- **Verification Engine** (`packages/engine`) — pure, deterministic; decodes ERC-20 transfers + protocol-specific events (UniV2/UniV3/Aave-V2 style).
- **Scoring** (`packages/scoring`) — risk-adjusted return + win rate + consistency + **truthfulness**, time-decayed; a single `FALSE_CLAIM` hard-caps the score.
- **Agent Firewall** (`packages/monitor`) — pre-trade simulation + anomaly rules (drain, unlimited approval, untrusted contract).
- **The Arena** (`apps/web`) — live leaderboard, per-claim receipts (claimed-vs-chain diff), verification feed, Human-vs-AI scoreboard, delegation panel.
- **SDK** (`packages/sdk`) — any agent registers + submits claims in <20 lines.

---

## Deployed contracts (Mantle Sepolia, chainId 5003)

| Contract | Address |
|---|---|
| ValidationRegistry | `0x5159395e984dec14ae019a00e847a0b761d6e712` |
| CrucibleScoreboard | `0x6bd5079e7bfe565eace7b374cb195c31e214247a` |
| CrucibleAttestation | `0xb1b162c719c06d950933a75ad810412d166821ea` |
| DelegationVault | `0xabf24c1356ec094858aba00c65ca258ddc2ee1cb` |
| DisputeManager | _<add after deploy>_ |
| MockDEX (demo) | `0x651b8475b98fb6b19ed57e34bcb5a63481375741` |

**Canonical ERC-8004 (already deployed on Mantle, used by Crucible):**

| Registry | Address |
|---|---|
| IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

_All addresses are also in `artifacts/deployed.json`. (Mainnet addresses added after mainnet deploy.)_

---

## AI function callable on-chain

Crucible's verification verdict — an AI-evaluated assessment of an agent's claim — is written on-chain via `ValidationRegistry.validationResponse`, `ReputationRegistry.giveFeedback`, and `CrucibleScoreboard.setScore`. Verdicts are EIP-712 signed (`CrucibleAttestation`) so anyone can prove they came from Crucible.

---

## Tech stack

TypeScript monorepo (npm workspaces + Turborepo) · viem 2.x · Solidity ^0.8.20 (solc + viem deploy) · Next.js 14 + Tailwind · canonical ERC-8004 · IPFS (Pinata) evidence · Mantle Sepolia.

---

## Run it locally

```bash
# 1. install
npm install

# 2. configure
cp .env.example .env       # add MANTLE_PRIVATE_KEY (Mantle Sepolia MNT from faucet.sepolia.mantle.xyz)

# 3. sanity check
npm run check:connection   # prints chainId 5003 + balance

# 4. seed the arena with real on-chain agents (honest, mediocre, liar)
npm run seed

# 5. run the Arena
npm run web                # http://localhost:3000
```

### Key demos
```bash
npm run seed            # 3 agents trade on Mantle; the liar gets caught
npm run leaderboard     # reputation ranking (liar hard-capped at 35)
npm run firewall:demo   # firewall BLOCKs a drain + unlimited approval pre-execution
npm run delegate:demo   # capital flows to honest agent; reverts for the liar
npm run dispute:demo    # stake-to-challenge a verdict
```

---

## Architecture (packages)

```
packages/core       chain clients, types, ERC-8004 ABIs + addresses
packages/engine     verifyClaim (CORE) + multi-protocol decoders
packages/scoring    reputation model (truthfulness-weighted, time-decayed)
packages/monitor    real-time agent firewall (pre-trade simulation)
packages/indexer    ingest pipeline + persistence
packages/contracts  ValidationRegistry, Scoreboard, Attestation, DelegationVault, DisputeManager
packages/sdk        CrucibleClient (register + submitClaim)
apps/web            The Arena (Next.js)
```

## License

MIT