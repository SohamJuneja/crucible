// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ── Custom errors ──────────────────────────────────────────────────────────────

error OnlyArbiter();
error BondTooLow(uint256 sent, uint256 required);
error DisputeNotOpen(uint256 disputeId);
error TransferFailed();

// ── Types ──────────────────────────────────────────────────────────────────────

enum DisputeStatus { Open, Upheld, Overturned }

struct Dispute {
    address       challenger;
    uint256       agentId;
    bytes32       verdictRef;  // requestHash from ValidationRegistry or any evidence CID hash
    uint256       bond;
    DisputeStatus status;
    uint256       openedAt;
}

// ── Contract ───────────────────────────────────────────────────────────────────

/**
 * @title  DisputeManager
 * @notice Crypto-economic dispute protocol for Crucible verdicts.
 *
 * Anyone can bond MNT to challenge a Crucible verdict.  The arbiter
 * (Crucible verifier) re-verifies the claim deterministically and resolves:
 *
 *   upheld     — original verdict stands; challenger was wrong; bond is slashed
 *                to the treasury address.
 *   overturned — challenger was right; bond is refunded plus a configurable
 *                reward (paid from the contract's reward pool, funded by prior
 *                slash proceeds or direct deposits).
 *
 * Design note — arbiter is the Crucible verifier key for the hackathon because
 * Crucible's verification is deterministic: same claim + same chain state always
 * produces the same verdict.  The hook for a decentralised jury (token-weighted
 * vote, optimistic challenge window, etc.) is the `resolveDispute` signature —
 * replace the single-key arbiter with a governance contract to upgrade to v2
 * without changing the dispute data model.
 *
 * Scoreboard correction — when a verdict is overturned the arbiter should also
 * call CrucibleScoreboard.setScore directly (DisputeManager is not authorised as
 * the scoreboard verifier in v1).  This contract emits `correctedScore` in the
 * DisputeResolved event so off-chain indexers can react immediately.
 */
contract DisputeManager {
    // ── Immutables ────────────────────────────────────────────────────────────────
    address public immutable arbiter;    // Crucible verifier — sole resolver for v1
    address public immutable treasury;   // receives slashed bonds
    uint256 public immutable minBond;    // e.g. 0.005 MNT
    uint256 public immutable rewardBps;  // bonus to winning challenger (e.g. 5000 = 50 %)

    // ── State ─────────────────────────────────────────────────────────────────────
    uint256 public disputeCount;
    mapping(uint256 => Dispute) private _disputes;
    uint256 public rewardPool;  // accumulated from the contract's own balance for challenger rewards

    // ── Events ────────────────────────────────────────────────────────────────────
    event DisputeOpened(
        uint256 indexed disputeId,
        uint256 indexed agentId,
        address indexed challenger,
        bytes32 verdictRef,
        uint256 bond
    );

    event DisputeResolved(
        uint256 indexed disputeId,
        uint256 indexed agentId,
        bool    upheld,
        uint256 bondSlashed,     // non-zero when upheld  — goes to treasury
        uint256 refund,          // non-zero when overturned — returned to challenger
        uint16  correctedScore   // arbiter hint; 0 = no correction; apply via scoreboard.setScore
    );

    // ── Constructor ───────────────────────────────────────────────────────────────

    constructor(
        address _arbiter,
        address _treasury,
        uint256 _minBond,
        uint256 _rewardBps
    ) {
        require(_arbiter  != address(0), "DM: zero arbiter");
        require(_treasury != address(0), "DM: zero treasury");
        require(_rewardBps < 10_000,     "DM: reward >= 100%");
        arbiter    = _arbiter;
        treasury   = _treasury;
        minBond    = _minBond;
        rewardBps  = _rewardBps;
    }

    // ── Writes ─────────────────────────────────────────────────────────────────────

    /**
     * @notice Open a dispute against a Crucible verdict by posting a bond.
     * @param agentId    ERC-8004 agent whose verdict is being challenged.
     * @param verdictRef Evidence reference — typically the ValidationRegistry
     *                   requestHash or keccak256 of the evidence CID.
     * @return disputeId Assigned dispute identifier.
     */
    function openDispute(uint256 agentId, bytes32 verdictRef)
        external
        payable
        returns (uint256 disputeId)
    {
        if (msg.value < minBond) revert BondTooLow(msg.value, minBond);

        disputeId = disputeCount++;
        _disputes[disputeId] = Dispute({
            challenger: msg.sender,
            agentId:    agentId,
            verdictRef: verdictRef,
            bond:       msg.value,
            status:     DisputeStatus.Open,
            openedAt:   block.timestamp
        });

        emit DisputeOpened(disputeId, agentId, msg.sender, verdictRef, msg.value);
    }

    /**
     * @notice Resolve a dispute.  Only callable by the arbiter.
     *
     * @param disputeId      The dispute to resolve.
     * @param upheld         true  → original verdict stands; challenger loses bond.
     *                       false → verdict overturned; challenger refunded + reward.
     * @param correctedScore Suggested replacement score if overturned (0 = no change).
     *                       Arbiter should call CrucibleScoreboard.setScore separately.
     *
     * Arbiter guidance: re-run verifyClaim against current chain state.  Because
     * Crucible's engine is deterministic the result should be identical to the
     * original verdict unless the challenger identified a genuine indexing error.
     */
    function resolveDispute(
        uint256 disputeId,
        bool    upheld,
        uint16  correctedScore
    ) external {
        if (msg.sender != arbiter) revert OnlyArbiter();
        Dispute storage d = _disputes[disputeId];
        if (d.status != DisputeStatus.Open) revert DisputeNotOpen(disputeId);

        d.status       = upheld ? DisputeStatus.Upheld : DisputeStatus.Overturned;
        uint256 bond   = d.bond;

        if (upheld) {
            // Challenger was wrong — slash bond to treasury
            (bool ok,) = treasury.call{value: bond}("");
            if (!ok) revert TransferFailed();
            emit DisputeResolved(disputeId, d.agentId, true, bond, 0, correctedScore);
        } else {
            // Challenger was right — refund bond + reward from rewardPool
            uint256 reward = (bond * rewardBps) / 10_000;
            uint256 available = reward <= rewardPool ? reward : rewardPool;
            rewardPool -= available;
            uint256 refund = bond + available;
            (bool ok,) = d.challenger.call{value: refund}("");
            if (!ok) revert TransferFailed();
            emit DisputeResolved(disputeId, d.agentId, false, 0, refund, correctedScore);
        }
    }

    // ── Views ──────────────────────────────────────────────────────────────────────

    function getDispute(uint256 disputeId) external view returns (Dispute memory) {
        return _disputes[disputeId];
    }

    // ── Reward pool funding ────────────────────────────────────────────────────────

    /**
     * @notice Fund the challenger reward pool (arbiter or anyone can deposit).
     */
    receive() external payable {
        rewardPool += msg.value;
    }
}
