// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ISwapRouter {
    // Intent model
    function executeIntent(bytes32 intentId, uint256 outputAmount) external;

    function submitSwapIntent(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadlineOffset
    ) external returns (bytes32 intentId);

    // Uniswap V3 direct
    function swapViaUniswapV3Single(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOutMinimum
    ) external returns (uint256 amountOut);

    function swapViaUniswapV3MultiHop(
        bytes calldata path,
        uint256 amountIn,
        uint256 amountOutMinimum
    ) external returns (uint256 amountOut);
}
