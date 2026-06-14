// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title  DelegationVault
 * @notice Reputation-gated capital delegation.
 *
 * Capital can only flow to agents whose CrucibleScoreboard.getScore() clears
 * the minScore threshold — otherwise delegate() reverts with
 * AgentBelowReputationThreshold.
 *
 * Accounting model:
 *   - Delegators deposit MNT via delegate().  Principal stays in this vault.
 *   - The agent returns PROFIT (not principal) via agentReturn().
 *   - On withdraw():  payout = principal + profitShare - performanceFee
 *   - Agent claims accrued fees via claimFees().
 *
 * Score encoding: same as CrucibleScoreboard — uint16 = score × 100
 *   e.g. minScore = 6000 means "score >= 60.00".
 */

interface ICrucibleScoreboard {
    function getScore(uint256 agentId) external view returns (uint16);
}

// ── Custom errors ──────────────────────────────────────────────────────────────

error AgentBelowReputationThreshold(uint256 agentId, uint16 score, uint16 minScore);
error NothingToWithdraw();
error NotAgentFeeRecipient();
error NoFeesToClaim();
error TransferFailed();

// ── Contract ───────────────────────────────────────────────────────────────────

contract DelegationVault {
    // ── Immutables ───────────────────────────────────────────────────────────────
    ICrucibleScoreboard public immutable scoreboard;
    uint16              public immutable minScore;          // e.g. 6000 = 60.00
    uint16              public immutable performanceFeeBps; // e.g. 1000 = 10 %

    // ── State ────────────────────────────────────────────────────────────────────
    /// @notice delegator → agentId → delegated principal
    mapping(address => mapping(uint256 => uint256)) public delegationOf;

    /// @notice agentId → total principal currently delegated
    mapping(uint256 => uint256) public agentPool;

    /// @notice agentId → total profit returned by the agent
    mapping(uint256 => uint256) public agentReturnPool;

    /// @notice agentId → accrued performance fees (claimable by agent)
    mapping(uint256 => uint256) public accruedFees;

    /// @notice agentId → wallet address entitled to claim fees (first agentReturn caller)
    mapping(uint256 => address) public agentFeeRecipient;

    // ── Events ────────────────────────────────────────────────────────────────────
    event Delegated(
        uint256 indexed agentId,
        address indexed delegator,
        uint256         amount
    );

    event AgentReturn(
        uint256 indexed agentId,
        address indexed returner,
        uint256         amount
    );

    event Withdrawn(
        uint256 indexed agentId,
        address indexed delegator,
        uint256         principal,
        uint256         profitShare,
        uint256         fee,
        uint256         payout
    );

    event FeesClaimed(
        uint256 indexed agentId,
        address indexed agent,
        uint256         amount
    );

    // ── Constructor ────────────────────────────────────────────────────────────────

    constructor(
        address _scoreboard,
        uint16  _minScore,
        uint16  _performanceFeeBps
    ) {
        require(_scoreboard != address(0), "DV: zero scoreboard");
        require(_performanceFeeBps < 10_000, "DV: fee >= 100%");
        scoreboard        = ICrucibleScoreboard(_scoreboard);
        minScore          = _minScore;
        performanceFeeBps = _performanceFeeBps;
    }

    // ── Writes ─────────────────────────────────────────────────────────────────────

    /**
     * @notice Delegate MNT to an agent.
     * @dev    Reverts unless the agent's on-chain score meets the minScore threshold.
     */
    function delegate(uint256 agentId) external payable {
        uint16 score = scoreboard.getScore(agentId);
        if (score < minScore) {
            revert AgentBelowReputationThreshold(agentId, score, minScore);
        }
        require(msg.value > 0, "DV: zero value");

        delegationOf[msg.sender][agentId] += msg.value;
        agentPool[agentId]                += msg.value;

        emit Delegated(agentId, msg.sender, msg.value);
    }

    /**
     * @notice Agent deposits profit (above principal) back into the vault.
     *         The first caller for a given agentId becomes the fee recipient.
     */
    function agentReturn(uint256 agentId) external payable {
        require(msg.value > 0, "DV: zero value");
        if (agentFeeRecipient[agentId] == address(0)) {
            agentFeeRecipient[agentId] = msg.sender;
        }
        agentReturnPool[agentId] += msg.value;
        emit AgentReturn(agentId, msg.sender, msg.value);
    }

    /**
     * @notice Delegator withdraws their principal + pro-rata profit, minus
     *         a performance fee that accrues to the agent.
     *         If the agent has not returned any profit yet, the delegator
     *         receives their exact principal back.
     */
    function withdraw(uint256 agentId) external {
        uint256 principal = delegationOf[msg.sender][agentId];
        if (principal == 0) revert NothingToWithdraw();

        uint256 pool       = agentPool[agentId];
        uint256 returnPool = agentReturnPool[agentId];

        // Pro-rata share of returns (0 when agent hasn't returned yet)
        uint256 profitShare = (pool > 0 && returnPool > 0)
            ? (principal * returnPool) / pool
            : 0;

        uint256 fee    = (profitShare * performanceFeeBps) / 10_000;
        uint256 payout = principal + profitShare - fee;

        // Update state before external call (re-entrancy guard)
        delegationOf[msg.sender][agentId] = 0;
        agentPool[agentId]                = pool - principal;
        agentReturnPool[agentId]          = returnPool - profitShare;
        accruedFees[agentId]             += fee;

        emit Withdrawn(agentId, msg.sender, principal, profitShare, fee, payout);

        (bool ok,) = payable(msg.sender).call{value: payout}("");
        if (!ok) revert TransferFailed();
    }

    /**
     * @notice Agent claims their accumulated performance fees.
     * @dev    Only the wallet that first called agentReturn() for this agentId
     *         may claim fees.
     */
    function claimFees(uint256 agentId) external {
        if (msg.sender != agentFeeRecipient[agentId]) revert NotAgentFeeRecipient();
        uint256 amount = accruedFees[agentId];
        if (amount == 0) revert NoFeesToClaim();

        accruedFees[agentId] = 0;

        emit FeesClaimed(agentId, msg.sender, amount);

        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
