# Contract Verification — Crucible on Mantle Sepolia

All contracts were compiled with the **same settings** across every deploy script:

| Setting | Value |
|---|---|
| Compiler | `v0.8.26+commit.8a97fa7a` |
| EVM version | `cancun` (solc 0.8.26 default — no explicit override in deploy scripts) |
| Optimizer | **Enabled** |
| Optimizer runs | **200** |
| License | MIT |
| Verification target | Mantle Sepolia (chainId 5003) |
| Explorer | <https://sepolia.mantlescan.xyz> |

---

## Mantlescan Web-UI — Step-by-step

For each contract below, do the following:

1. Open `https://sepolia.mantlescan.xyz/address/<ADDRESS>`
2. Click the **Contract** tab → **Verify & Publish**
3. Choose **"Solidity (Single file)"** and click **Continue**
4. Fill in the form:
   - **Compiler version**: `v0.8.26+commit.8a97fa7a`
   - **Open source license**: `MIT License (MIT)`
   - Click **Continue**
5. Paste the **full source file** into the "Enter the Solidity Contract Code" box (path listed below)
6. Set optimization:
   - Optimization: **Yes**
   - Runs: **200**
7. Set EVM version: **cancun**
8. Paste the **constructor arguments** hex string (no `0x` prefix) into "Constructor Arguments ABI-encoded"
   — leave blank if the entry says `none`
9. Click **Verify and Publish**

Repeat for each contract.

---

## Contract Details

### 1. ValidationRegistry

| Field | Value |
|---|---|
| Address | `0x5159395e984dec14ae019a00e847a0b761d6e712` |
| Explorer | <https://sepolia.mantlescan.xyz/address/0x5159395e984dec14ae019a00e847a0b761d6e712> |
| Deploy tx | `0x71e3165f4052813e1096500f3883166931153b51e069949239a5e68caa401272` |
| Source file | `packages/contracts/src/ValidationRegistry.sol` |
| Contract name | `ValidationRegistry` |
| Constructor args | **none** (no constructor) |

---

### 2. CrucibleScoreboard

| Field | Value |
|---|---|
| Address | `0x6bd5079e7bfe565eace7b374cb195c31e214247a` |
| Explorer | <https://sepolia.mantlescan.xyz/address/0x6bd5079e7bfe565eace7b374cb195c31e214247a> |
| Deploy tx | `0xae4df5688fbf006fc26278710bd2257f740a73c6c1bf8424b6b55247cd3d8764` |
| Source file | `packages/contracts/src/CrucibleScoreboard.sol` |
| Contract name | `CrucibleScoreboard` |

**Constructor**: `constructor(address _verifier)`
- `_verifier` = `0x2010834D1aB47a121B926790F47f6947b4a8e890`

**ABI-encoded constructor arguments (no 0x prefix):**
```
0000000000000000000000002010834d1ab47a121b926790f47f6947b4a8e890
```

---

### 3. CrucibleAttestation

| Field | Value |
|---|---|
| Address | `0xb1b162c719c06d950933a75ad810412d166821ea` |
| Explorer | <https://sepolia.mantlescan.xyz/address/0xb1b162c719c06d950933a75ad810412d166821ea> |
| Deploy tx | `0xeca4c245b947b572685edbc4c35821d4c02925ffa6442edfaee0c01ded3d3b62` |
| Source file | `packages/contracts/src/CrucibleAttestation.sol` |
| Contract name | `CrucibleAttestation` |

**Constructor**: `constructor(address _crucibleSigner)`
- `_crucibleSigner` = `0x2010834D1aB47a121B926790F47f6947b4a8e890`

**ABI-encoded constructor arguments (no 0x prefix):**
```
0000000000000000000000002010834d1ab47a121b926790f47f6947b4a8e890
```

---

### 4. DelegationVault

| Field | Value |
|---|---|
| Address | `0xabf24c1356ec094858aba00c65ca258ddc2ee1cb` |
| Explorer | <https://sepolia.mantlescan.xyz/address/0xabf24c1356ec094858aba00c65ca258ddc2ee1cb> |
| Deploy tx | `0x89d2a407028391ba124b245e47dc94a4ff90cf2acadc15d35d877b6e8414f201` |
| Source file | `packages/contracts/src/DelegationVault.sol` |
| Contract name | `DelegationVault` |

**Constructor**: `constructor(address _scoreboard, uint16 _minScore, uint16 _performanceFeeBps)`
- `_scoreboard`        = `0x6bd5079e7bfe565eace7b374cb195c31e214247a`
- `_minScore`          = `6000` (= 60.00 score threshold)
- `_performanceFeeBps` = `1000` (= 10 %)

**ABI-encoded constructor arguments (no 0x prefix):**
```
0000000000000000000000006bd5079e7bfe565eace7b374cb195c31e214247a
0000000000000000000000000000000000000000000000000000000000001770
00000000000000000000000000000000000000000000000000000000000003e8
```

---

### 5. DisputeManager

| Field | Value |
|---|---|
| Address | `0x97ad896658cb95fbd05cb27e9645406e2626b7cf` |
| Explorer | <https://sepolia.mantlescan.xyz/address/0x97ad896658cb95fbd05cb27e9645406e2626b7cf> |
| Deploy tx | `0x1eba24ffc8cdb98bc3467ce4cd60d00b4f4cd0a03b8e0dfe2fb79b2e85a23876` |
| Source file | `packages/contracts/src/DisputeManager.sol` |
| Contract name | `DisputeManager` |

**Constructor**: `constructor(address _arbiter, address _treasury, uint256 _minBond, uint256 _rewardBps)`
- `_arbiter`   = `0x2010834D1aB47a121B926790F47f6947b4a8e890`
- `_treasury`  = `0xdeadc0ffee0000000000000000000000000000ff`
- `_minBond`   = `5000000000000000` (= 0.005 MNT, `parseEther('0.005')`)
- `_rewardBps` = `5000` (= 50 % reward for winning challenger)

**ABI-encoded constructor arguments (no 0x prefix):**
```
0000000000000000000000002010834d1ab47a121b926790f47f6947b4a8e890
000000000000000000000000deadc0ffee0000000000000000000000000000ff
0000000000000000000000000000000000000000000000000011c37937e08000
0000000000000000000000000000000000000000000000000000000000001388
```

---

### 6. MockERC20 — TOKEN\_A ("CrucibleTokenA")

> Test fixture only. Deployed by `npm run make:fixtures`. Address comes from `packages/engine/src/__tests__/fixtures.json`.

| Field | Value |
|---|---|
| Address | `0x96329c3b644851692e4af18e8ec029ca6db4e35b` |
| Explorer | <https://sepolia.mantlescan.xyz/address/0x96329c3b644851692e4af18e8ec029ca6db4e35b> |
| Source file | `packages/contracts/src/MockERC20.sol` |
| Contract name | `MockERC20` |

**Constructor**: `constructor(string memory _name, string memory _symbol)`
- `_name`   = `"CrucibleTokenA"`
- `_symbol` = `"CTKA"`

**ABI-encoded constructor arguments (no 0x prefix):**
```
0000000000000000000000000000000000000000000000000000000000000040
0000000000000000000000000000000000000000000000000000000000000080
000000000000000000000000000000000000000000000000000000000000000e
4372756369626c65546f6b656e41000000000000000000000000000000000000
0000000000000000000000000000000000000000000000000000000000000004
43544b4100000000000000000000000000000000000000000000000000000000
```

---

### 7. MockERC20 — TOKEN\_B ("CrucibleTokenB")

| Field | Value |
|---|---|
| Address | `0xfa6b6299127b64dcded5f33e473b4714430d87aa` |
| Explorer | <https://sepolia.mantlescan.xyz/address/0xfa6b6299127b64dcded5f33e473b4714430d87aa> |
| Source file | `packages/contracts/src/MockERC20.sol` |
| Contract name | `MockERC20` |

**Constructor**: `constructor(string memory _name, string memory _symbol)`
- `_name`   = `"CrucibleTokenB"`
- `_symbol` = `"CTKB"`

**ABI-encoded constructor arguments (no 0x prefix):**
```
0000000000000000000000000000000000000000000000000000000000000040
0000000000000000000000000000000000000000000000000000000000000080
000000000000000000000000000000000000000000000000000000000000000e
4372756369626c65546f6b656e42000000000000000000000000000000000000
0000000000000000000000000000000000000000000000000000000000000004
43544b4200000000000000000000000000000000000000000000000000000000
```

---

### 8. MockDEX

| Field | Value |
|---|---|
| Address | `0x651b8475b98fb6b19ed57e34bcb5a63481375741` |
| Explorer | <https://sepolia.mantlescan.xyz/address/0x651b8475b98fb6b19ed57e34bcb5a63481375741> |
| Source file | `packages/contracts/src/MockDEX.sol` |
| Contract name | `MockDEX` |
| Constructor args | **none** (no constructor) |

---

## Troubleshooting

**"Bytecode does not match"** — Most likely causes in order:
1. Wrong EVM version. Try `paris` then `shanghai` if `cancun` fails. The deploy scripts omit `evmVersion`, so solc uses its version-default; if Mantlescan's `cancun` target produces different push offsets, switching to the next lower version usually fixes it.
2. Wrong optimizer runs count. Confirm it is exactly `200`.
3. Trailing newline difference in pasted source. Paste the file contents exactly — no added blank lines.

**"Invalid constructor arguments"** — The hex must be pasted without the `0x` prefix. The multi-line blocks above are formatted for readability; paste them **as a single continuous hex string** with all newlines removed.

For example, DelegationVault's args pasted correctly:
```
0000000000000000000000006bd5079e7bfe565eace7b374cb195c31e214247a00000000000000000000000000000000000000000000000000000000000017700000000000000000000000000000000000000000000000000000000000003e8
```

---

## Automated fallback — `npm run verify:contracts`

See `scripts/verify-contracts.ts` for a script that submits all contracts via the Mantlescan API
(Etherscan-compatible `verifysourcecode` endpoint). Requires `MANTLESCAN_API_KEY` in `.env`.
