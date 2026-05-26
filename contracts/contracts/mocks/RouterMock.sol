// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ISwapRouter } from "../interfaces/ISwapRouter.sol";

/// @notice Mock router that returns a pre-configured intentId from submitSwapIntent.
contract RouterMock is ISwapRouter {
    error NotMocked();

    bytes32 public intentId;

    constructor(bytes32 _intentId) {
        intentId = _intentId;
    }

    function setIntentId(bytes32 _intentId) external {
        intentId = _intentId;
    }

    function submitSwapIntent(
        address,
        address,
        uint256,
        uint256,
        uint256
    ) external view returns (bytes32 id) {
        return intentId;
    }

    function executeIntent(bytes32, uint256) external pure {
        revert NotMocked();
    }

    function swapViaUniswapV3Single(
        address,
        address,
        uint24,
        uint256,
        uint256
    ) external pure returns (uint256 amountOut) {
        revert NotMocked();
    }

    function swapViaUniswapV3MultiHop(
        bytes calldata,
        uint256,
        uint256
    ) external pure returns (uint256 amountOut) {
        revert NotMocked();
    }
}
