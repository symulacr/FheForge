// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PriceOracle} from "../contracts/PriceOracle.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

/// @notice Expose internal functions for testing.
contract PriceOracleHarness is PriceOracle {
    constructor(address pyth_, uint256 defaultStaleThreshold_) PriceOracle(pyth_, defaultStaleThreshold_) {}

    function exposedNormalizePythPrice(PythStructs.Price calldata p) external pure returns (uint256 priceWad) {
        return _normalizePythPrice(p);
    }

    function exposedIsPythStale(bytes32 id, address token) external view returns (bool stale) {
        return _isPythStale(id, token);
    }
}
