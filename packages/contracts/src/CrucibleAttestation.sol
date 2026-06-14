// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title  CrucibleAttestation
 * @notice EIP-712 signed verdicts — anyone can verify that Crucible issued a
 *         given verdict for a specific on-chain transaction.
 *
 * Domain:
 *   name    = "Crucible"
 *   version = "1"
 *   chainId = block.chainid (set at deploy time)
 *   verifyingContract = address(this)
 *
 * Verdict struct:
 *   agentId      uint256  — ERC-8004 agent identity
 *   txHash       bytes32  — the on-chain tx that was verified
 *   verdict      uint8    — 1=VERIFIED 2=EXAGGERATED 3=FALSE_CLAIM 4=UNVERIFIABLE
 *   truthScore   uint16   — Math.round(truthScore * 10000), so 10000 → 1.0000
 *   evidenceHash bytes32  — sha256 of the off-chain evidence JSON
 */
contract CrucibleAttestation {
    // ── EIP-712 ───────────────────────────────────────────────────────────────
    bytes32 private immutable _DOMAIN_SEPARATOR;

    bytes32 private constant _VERDICT_TYPEHASH = keccak256(
        "Verdict(uint256 agentId,bytes32 txHash,uint8 verdict,uint16 truthScore,bytes32 evidenceHash)"
    );

    struct Verdict {
        uint256 agentId;
        bytes32 txHash;
        uint8   verdict;
        uint16  truthScore;
        bytes32 evidenceHash;
    }

    // ── Authorisation ────────────────────────────────────────────────────────
    address public immutable crucibleSigner;

    // ── Constructor ────────────────────────────────────────────────────────────
    constructor(address _crucibleSigner) {
        require(_crucibleSigner != address(0), "CA: zero address");
        crucibleSigner = _crucibleSigner;
        _DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("Crucible")),
            keccak256(bytes("1")),
            block.chainid,
            address(this)
        ));
    }

    // ── Public interface ───────────────────────────────────────────────────────

    /**
     * @notice Returns the EIP-712 digest that the Crucible verifier signs.
     *         Off-chain signers should produce a signature over this value.
     */
    function hashVerdict(Verdict calldata v) public view returns (bytes32) {
        return keccak256(abi.encodePacked(
            "\x19\x01",
            _DOMAIN_SEPARATOR,
            keccak256(abi.encode(
                _VERDICT_TYPEHASH,
                v.agentId,
                v.txHash,
                v.verdict,
                v.truthScore,
                v.evidenceHash
            ))
        ));
    }

    /**
     * @notice Recovers the signer of a verdict and checks whether it is Crucible.
     * @param v         The Verdict struct.
     * @param signature 65-byte (r || s || v) ECDSA signature.
     * @return signer     Recovered signer address.
     * @return isCrucible true iff signer == crucibleSigner.
     */
    function verify(Verdict calldata v, bytes calldata signature)
        external view
        returns (address signer, bool isCrucible)
    {
        signer     = _recover(hashVerdict(v), signature);
        isCrucible = (signer == crucibleSigner);
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    function _recover(bytes32 hash, bytes memory sig) internal pure returns (address) {
        require(sig.length == 65, "CA: bad sig length");
        bytes32 r;
        bytes32 s;
        uint8   v_val;
        assembly {
            r     := mload(add(sig, 32))
            s     := mload(add(sig, 64))
            v_val := byte(0, mload(add(sig, 96)))
        }
        // Normalise to 27/28 (some signers emit 0/1)
        if (v_val < 27) v_val += 27;
        require(v_val == 27 || v_val == 28, "CA: bad v");
        address recovered = ecrecover(hash, v_val, r, s);
        require(recovered != address(0), "CA: ecrecover failed");
        return recovered;
    }
}
