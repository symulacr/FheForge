// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

interface ISwapRouter {
    function submitSwapIntent(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadlineOffset
    ) external returns (bytes32 intentId);
}
