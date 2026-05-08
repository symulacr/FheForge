// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ISwapRouter } from "../interfaces/ISwapRouter.sol";

contract ExecutorContract is Ownable {
    using SafeERC20 for IERC20;

    error TransferFailed();

    event IntentExecuted(bytes32 indexed intentId, address indexed user, uint256 outputAmount);
    event TokensWithdrawn(address indexed token, uint256 amount);

    constructor() Ownable(msg.sender) {}

    /// @notice Execute a swap intent on behalf of the protocol.
    /// @dev Router must be funded with tokenOut and approved by this contract beforehand.
    function executeIntent(
        address router,
        bytes32 intentId,
        uint256 outputAmount
    ) external onlyOwner {
        ISwapRouter(router).executeIntent(intentId, outputAmount);
        emit IntentExecuted(intentId, msg.sender, outputAmount);
    }

    /// @notice Approve a spender (typically the SwapRouter) to spend a token from this contract.
    function approveToken(address token, address spender, uint256 amount) external onlyOwner {
        IERC20(token).forceApprove(spender, amount);
    }

    /// @notice Withdraw tokens from this contract to the owner.
    function withdrawTokens(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
        emit TokensWithdrawn(token, amount);
    }
}
