// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import { euint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";

interface IStrategyRegistry {
    function incrementTvl(uint256 strategyId, euint128 amount) external;

    function decrementTvl(uint256 strategyId, euint128 amount) external;
}
