// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import { FHE, euint128, ebool } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { FHESafeMath128 } from "./libraries/FHESafeMath128.sol";

/// @notice Abstract base contract for all FheForge contracts.
///         Provides shared ownership, pausability, FHE helpers, errors, and constants.
abstract contract FheForgeBase is ReentrancyGuard, Pausable {
    // ────────── Shared immutables ──────────
    address public immutable OWNER;
    euint128 internal immutable _ZERO;

    // ────────── Shared constants ──────────
    uint256 public constant BPS_DEN = 1e4;
    uint256 public constant WAD = 1e18;

    // ────────── Shared errors ──────────
    error ZeroAddress();
    error ZeroAmount();
    error OnlyOwner();
    error TokenMismatch();
    error EthTransferFailed();

    // ────────── Modifiers ──────────
    modifier onlyOwner() {
        _onlyOwner();
        _;
    }

    function _onlyOwner() internal view {
        if (msg.sender != OWNER) revert OnlyOwner();
    }

    // ────────── Constructor ──────────
    constructor() {
        OWNER = msg.sender;
        euint128 z = FHE.asEuint128(0);
        FHE.allowThis(z);
        _ZERO = z;
    }

    // ────────── Pause / Unpause (use OZ events) ──────────
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ────────── FHE helpers ──────────

    /// @dev Substitute _ZERO for uninitialized handles (bytes32(0)).
    ///      Default mapping values are not registered with the FHE coprocessor,
    ///      so any ACL/FHE operation on them reverts with SenderNotAllowed(0xd0d25976).
    function _ensureInitialized(euint128 handle) internal view returns (euint128) {
        return FHE.isInitialized(handle) ? handle : _ZERO;
    }

    /// @dev Grant persistent ACL: allowThis + allow(user).
    function _grantAcl(euint128 handle, address user) internal {
        FHE.allowThis(handle);
        FHE.allow(handle, user);
    }

    /// @dev Safe increase with overflow detection via FHESafeMath128.
    ///      Returns the new balance with ACL already granted.
    function _safeIncrease(euint128 stored, euint128 delta, address user) internal returns (euint128) {
        (, euint128 newBalance) = FHESafeMath128.tryIncrease(stored, delta);
        _grantAcl(newBalance, user);
        return newBalance;
    }

    /// @dev Safe decrease with underflow detection via FHESafeMath128.
    ///      Returns the new balance with ACL already granted.
    function _safeDecrease(euint128 stored, euint128 delta, address user) internal returns (euint128) {
        (, euint128 newBalance) = FHESafeMath128.tryDecrease(stored, delta);
        _grantAcl(newBalance, user);
        return newBalance;
    }

    /// @dev Equality verification: returns verifiedIncoming if enc==plain, else _ZERO.
    function _verifyEquality(euint128 incoming, uint256 claimedPlain) internal returns (euint128) {
        euint128 claimedEnc = FHE.asEuint128(claimedPlain);
        ebool match_ = FHE.eq(incoming, claimedEnc);
        return FHE.select(match_, incoming, _ZERO);
    }
}
