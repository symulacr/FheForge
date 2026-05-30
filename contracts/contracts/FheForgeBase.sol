// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { FHE, euint128, ebool } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { FHESafeMath128 } from "./libraries/FHESafeMath128.sol";

/// @notice Abstract base contract for all FheForge contracts.
///         Provides shared ownership, pausability, FHE helpers, errors, and constants.
abstract contract FheForgeBase {
    // Bit 0: paused flag (1=paused, 0=active)
    // Bit 1: reentered flag (1=reentered, 0=normal)
    uint256 private _poolGuard;

    uint256 private constant _PAUSED = 1;
    uint256 private constant _REENTERED = 2;

    error GuardReentrantCall();
    error GuardEnforcedPause();
    error GuardExpectedPause();

    event Paused(address indexed account);
    event Unpaused(address indexed account);

    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    modifier whenNotPaused() {
        _requireNotPaused();
        _;
    }

    modifier whenPaused() {
        _requirePaused();
        _;
    }

    function _nonReentrantBefore() private {
        if (_poolGuard & _REENTERED != 0) revert GuardReentrantCall();
        _poolGuard |= _REENTERED;
    }

    function _nonReentrantAfter() private {
        _poolGuard &= ~_REENTERED;
    }

    function _requireNotPaused() private view {
        if (_poolGuard & _PAUSED != 0) revert GuardEnforcedPause();
    }

    function _requirePaused() private view {
        if (_poolGuard & _PAUSED == 0) revert GuardExpectedPause();
    }

    function paused() public view returns (bool isPaused) {
        return _poolGuard & _PAUSED != 0;
    }

    function _pause() internal whenNotPaused {
        _poolGuard |= _PAUSED;
        emit Paused(msg.sender);
    }

    function _unpause() internal whenPaused {
        _poolGuard &= ~_PAUSED;
        emit Unpaused(msg.sender);
    }

    /// @dev Replacement for OZ Context._msgSender() to avoid the Context dependency.
    function _msgSender() internal view returns (address sender) {
        return msg.sender;
    }

    address private _owner;
    address public pendingOwner;

    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    euint128 internal immutable _ZERO;

    uint256 public constant BPS_DEN = 1e4;
    uint256 public constant WAD = 1e18;

    error ZeroAddress();
    error ZeroAmount();
    error OnlyOwner();
    error TokenMismatch();
    error EthTransferFailed();
    error InvalidCiphertext();

    modifier onlyOwner() {
        _onlyOwner();
        _;
    }

    function _onlyOwner() internal view {
        if (msg.sender != _owner) revert OnlyOwner();
    }

    constructor() {
        _poolGuard = 0;
        _owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
        euint128 z = FHE.asEuint128(0);
        FHE.allowThis(z);
        _ZERO = z;
    }

    function owner() public view returns (address owner_) {
        return _owner;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(_owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert OnlyOwner();
        address prevOwner = _owner;
        _owner = pendingOwner;
        delete pendingOwner;
        emit OwnershipTransferred(prevOwner, _owner);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _ensureInitialized(euint128 handle) internal view returns (euint128 result) {
        return FHE.isInitialized(handle) ? handle : _ZERO;
    }

    function _grantAcl(euint128 handle, address user) internal {
        FHE.allowThis(handle);
        FHE.allow(handle, user);
    }

    function _safeIncrease(
        euint128 stored,
        euint128 delta,
        address user
    ) internal returns (euint128 newBalance) {
        (, newBalance) = FHESafeMath128.tryIncrease(stored, delta);
        _grantAcl(newBalance, user);
    }

    function _safeDecrease(
        euint128 stored,
        euint128 delta,
        address user
    ) internal returns (euint128 newBalance) {
        (, newBalance) = FHESafeMath128.tryDecrease(stored, delta);
        _grantAcl(newBalance, user);
        return newBalance;
    }

    function _verifyEquality(
        euint128 incoming,
        uint256 claimedPlain
    ) internal returns (euint128 result) {
        _validateCiphertext(incoming);
        euint128 claimedEnc = FHE.asEuint128(claimedPlain);
        ebool match_ = FHE.eq(incoming, claimedEnc);
        result = FHE.select(match_, incoming, _ZERO);
        FHE.allowThis(result);
        return result;
    }

    function _validateCiphertext(euint128 handle) internal view {
        if (!FHE.isInitialized(handle)) revert InvalidCiphertext();
    }
}
