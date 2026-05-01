// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import { euint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title  IStrategyRegistry
/// @notice Subset of StrategyRegistry consumed by StrategyVault for
///         encrypted-TVL bookkeeping.
interface IStrategyRegistry {
    /// @notice Add `amount` to a strategy's TVL. Caller must hold FHE
    ///         permission on `amount`.
    function incrementTvl(uint256 strategyId, euint128 amount) external;

    /// @notice Subtract `amount` from a strategy's TVL with underflow clamping.
    ///         Caller must hold FHE permission on `amount`.
    function decrementTvl(uint256 strategyId, euint128 amount) external;
}
