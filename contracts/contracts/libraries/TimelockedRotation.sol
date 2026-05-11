// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import { FheForgeBase } from "../FheForgeBase.sol";

/// @notice Abstract mixin for timelocked role rotation (vault, executor, etc.).
///         Provides propose/accept pattern with configurable delay.
abstract contract TimelockedRotation is FheForgeBase {
    uint256 public immutable ROTATION_DELAY;

    address public pendingRole;
    uint256 public pendingRoleEarliest;

    error NoPendingRole();
    error TimelockNotElapsed();

    constructor(uint256 rotationDelay_) {
        ROTATION_DELAY = rotationDelay_;
    }

    /// @dev Propose a new address for the role. Must be accepted after delay.
    function _proposeRole(address newAddr) internal {
        if (newAddr == address(0)) revert ZeroAddress();
        pendingRole = newAddr;
        pendingRoleEarliest = block.timestamp + ROTATION_DELAY;
    }

    /// @dev Accept the pending role after timelock elapsed.
    ///      Returns the new address (caller must assign it to the appropriate slot).
    function _acceptRole() internal returns (address) {
        if (pendingRole == address(0)) revert NoPendingRole();
        if (block.timestamp < pendingRoleEarliest) revert TimelockNotElapsed();
        address newAddr = pendingRole;
        pendingRole = address(0);
        pendingRoleEarliest = 0;
        return newAddr;
    }
}
