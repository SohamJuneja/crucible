// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title  CrucibleScoreboard
 * @notice Stores each agent's latest composite reputation score on-chain for
 *         cheap leaderboard reads.
 *
 * Score encoding: uint16 = Math.round(score * 100), so 9250 → 92.50.
 *
 * Only the authorised Crucible verifier address (set in the constructor and
 * immutable thereafter) may write scores.  Reads are permissionless.
 */
contract CrucibleScoreboard {
    // ── Authorisation ────────────────────────────────────────────────────────
    address public immutable verifier;

    modifier onlyVerifier() {
        require(msg.sender == verifier, "CS: not verifier");
        _;
    }

    // ── Storage ───────────────────────────────────────────────────────────────
    mapping(uint256 => uint16) private _scores;
    uint256[]                  private _agentIds;
    mapping(uint256 => bool)   private _registered;

    // ── Events ────────────────────────────────────────────────────────────────
    event ScoreUpdated(uint256 indexed agentId, uint16 score, uint256 updatedAt);

    // ── Constructor ────────────────────────────────────────────────────────────
    constructor(address _verifier) {
        require(_verifier != address(0), "CS: zero address");
        verifier = _verifier;
    }

    // ── Writes (verifier only) ─────────────────────────────────────────────────

    /**
     * @notice Records (or updates) an agent's reputation score.
     * @param agentId  ERC-8004 agent identity token id.
     * @param score    Composite score encoded as Math.round(score * 100).
     */
    function setScore(uint256 agentId, uint16 score) external onlyVerifier {
        if (!_registered[agentId]) {
            _agentIds.push(agentId);
            _registered[agentId] = true;
        }
        _scores[agentId] = score;
        emit ScoreUpdated(agentId, score, block.timestamp);
    }

    // ── Reads ──────────────────────────────────────────────────────────────────

    function getScore(uint256 agentId) external view returns (uint16) {
        return _scores[agentId];
    }

    function getAgentCount() external view returns (uint256) {
        return _agentIds.length;
    }

    /**
     * @notice Returns all scored agents and their scores in insertion order.
     *         O(n) — intended for off-chain reads, not on-chain loops.
     */
    function getAllScores()
        external view
        returns (uint256[] memory agentIds, uint16[] memory scores)
    {
        agentIds = _agentIds;
        scores   = new uint16[](_agentIds.length);
        for (uint256 i = 0; i < _agentIds.length; i++) {
            scores[i] = _scores[_agentIds[i]];
        }
    }
}
