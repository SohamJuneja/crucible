// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title  ValidationRegistry
 * @notice Crucible's per-claim validation ledger.
 *         Agent owners submit claims via validationRequest(); Crucible posts
 *         verdicts via validationResponse().  Non-upgradeable by design.
 *
 * Verdict codes (uint8 response field):
 *   1 = VERIFIED  |  2 = EXAGGERATED  |  3 = FALSE_CLAIM  |  4 = UNVERIFIABLE
 */
contract ValidationRegistry {
    uint8 public constant VERDICT_VERIFIED     = 1;
    uint8 public constant VERDICT_EXAGGERATED  = 2;
    uint8 public constant VERDICT_FALSE_CLAIM  = 3;
    uint8 public constant VERDICT_UNVERIFIABLE = 4;

    struct Request {
        address  validator;
        uint256  agentId;
        address  requester;
        string   requestURI;
        bool     responded;
        uint8    response;
        string   responseURI;
        bytes32  responseHash;
        bytes32  tag;
        uint256  timestamp;
    }

    mapping(bytes32 => Request)    private _requests;
    mapping(uint256 => bytes32[])  private _agentValidations;
    mapping(address => bytes32[])  private _validatorRequests;

    event ValidationRequested(
        bytes32 indexed requestHash,
        address indexed validator,
        uint256 indexed agentId,
        string  requestURI,
        address requester
    );
    event ValidationResponded(
        bytes32 indexed requestHash,
        uint256 indexed agentId,
        uint8   response,
        string  responseURI,
        bytes32 responseHash,
        bytes32 tag
    );

    // ── writes ────────────────────────────────────────────────────────────────

    function validationRequest(
        address validatorAddress,
        uint256 agentId,
        string  calldata requestURI,
        bytes32 requestHash
    ) external {
        require(_requests[requestHash].timestamp == 0, "VR: request exists");

        _requests[requestHash] = Request({
            validator:    validatorAddress,
            agentId:      agentId,
            requester:    msg.sender,
            requestURI:   requestURI,
            responded:    false,
            response:     0,
            responseURI:  "",
            responseHash: bytes32(0),
            tag:          bytes32(0),
            timestamp:    block.timestamp
        });

        _agentValidations[agentId].push(requestHash);
        _validatorRequests[validatorAddress].push(requestHash);

        emit ValidationRequested(requestHash, validatorAddress, agentId, requestURI, msg.sender);
    }

    function validationResponse(
        bytes32 requestHash,
        uint8   response,
        string  calldata responseURI,
        bytes32 responseHash,
        bytes32 tag
    ) external {
        Request storage req = _requests[requestHash];
        require(req.timestamp != 0,          "VR: unknown request");
        require(!req.responded,              "VR: already responded");
        require(msg.sender == req.validator, "VR: not validator");

        req.responded    = true;
        req.response     = response;
        req.responseURI  = responseURI;
        req.responseHash = responseHash;
        req.tag          = tag;

        emit ValidationResponded(
            requestHash, req.agentId, response, responseURI, responseHash, tag
        );
    }

    // ── reads ─────────────────────────────────────────────────────────────────

    function getValidationStatus(bytes32 requestHash)
        external view
        returns (
            bool    exists,
            bool    responded,
            uint8   response,
            address validator,
            uint256 agentId
        )
    {
        Request storage req = _requests[requestHash];
        exists    = req.timestamp != 0;
        responded = req.responded;
        response  = req.response;
        validator = req.validator;
        agentId   = req.agentId;
    }

    function getAgentValidations(uint256 agentId)
        external view returns (bytes32[] memory)
    {
        return _agentValidations[agentId];
    }

    function getValidatorRequests(address validator)
        external view returns (bytes32[] memory)
    {
        return _validatorRequests[validator];
    }

    function getSummary(uint256 agentId)
        external view
        returns (
            uint256 total,
            uint256 verified,
            uint256 exaggerated,
            uint256 falseClaim,
            uint256 unverifiable
        )
    {
        bytes32[] storage hashes = _agentValidations[agentId];
        total = hashes.length;
        for (uint256 i = 0; i < hashes.length; i++) {
            Request storage req = _requests[hashes[i]];
            if (!req.responded) continue;
            if      (req.response == VERDICT_VERIFIED)     verified++;
            else if (req.response == VERDICT_EXAGGERATED)  exaggerated++;
            else if (req.response == VERDICT_FALSE_CLAIM)  falseClaim++;
            else if (req.response == VERDICT_UNVERIFIABLE) unverifiable++;
        }
    }
}
