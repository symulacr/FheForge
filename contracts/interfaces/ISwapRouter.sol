// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

interface ISwapRouter {
    function executeIntent(bytes32 intentId, uint256 outputAmount) external;
}
