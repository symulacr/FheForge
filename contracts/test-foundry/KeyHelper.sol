// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "../lib/forge-std/src/Test.sol";

/// @notice Base test contract with deterministic key/address derivation.
///         Extend this instead of `Test` to get key generation helpers.
abstract contract KeyHelper is Test {
    /// @dev Derives a deterministic private key from a seed index.
    ///      Use `deriveKey(0)`, `deriveKey(1)`, ... for unique wallets.
    function deriveKey(uint256 index) internal pure returns (uint256 key) {
        return uint256(keccak256(abi.encode(index)));
    }

    function deriveAddr(uint256 index) internal pure returns (address addr) {
        return vm.addr(deriveKey(index));
    }

    /// @dev Derives a deterministic address from a raw private key.
    function keyToAddr(uint256 pk) internal pure returns (address addr) {
        return vm.addr(pk);
    }
}
