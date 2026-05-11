// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { FheForgeBase } from "./FheForgeBase.sol";
import { TimelockedRotation } from "./libraries/TimelockedRotation.sol";

contract SwapRouter is FheForgeBase, TimelockedRotation {
    using SafeERC20 for IERC20;

    uint256 public immutable MIN_DEADLINE_OFFSET;
    uint256 public immutable MAX_DEADLINE_OFFSET;

    struct SwapIntent {
        uint256 amountIn;
        uint256 minAmountOut;
        uint256 deadline;
        address tokenIn;
        address tokenOut;
        address user;
    }

    mapping(bytes32 => SwapIntent) private intents;
    mapping(address => uint256) private nonces;

    address public executor;

    error SameToken();
    error UnknownIntent();
    error NotCreator();
    error NotExecutor();
    error IntentExpired();
    error ZeroOutput();
    error InsufficientOutput();
    error DeadlineTooShort();
    error DeadlineTooLong();

    event IntentSubmitted(
        bytes32 indexed intentId,
        address indexed user,
        address indexed tokenIn,
        address tokenOut,
        uint256 deadline
    );
    event IntentExecuted(
        bytes32 indexed intentId,
        address indexed user,
        uint256 indexed outputAmount
    );
    event IntentCancelled(bytes32 indexed intentId, address indexed user);
    event ExecutorProposed(address indexed newExecutor, uint256 indexed earliest);
    event ExecutorRotated(address indexed previousExecutor, address indexed newExecutor);

    constructor(
        address executor_,
        uint256 minDeadlineOffset_,
        uint256 maxDeadlineOffset_,
        uint256 executorRotationDelay_
    ) FheForgeBase() TimelockedRotation(executorRotationDelay_) {
        if (executor_ == address(0)) revert ZeroAddress();
        if (minDeadlineOffset_ == 0) revert DeadlineTooShort();
        if (maxDeadlineOffset_ < minDeadlineOffset_) revert DeadlineTooLong();
        executor = executor_;
        MIN_DEADLINE_OFFSET = minDeadlineOffset_;
        MAX_DEADLINE_OFFSET = maxDeadlineOffset_;
    }

    function proposeExecutor(address newExecutor) external onlyOwner {
        _proposeRole(newExecutor);
        emit ExecutorProposed(newExecutor, pendingRoleEarliest);
    }

    function acceptExecutor() external {
        address oldExec = executor;
        executor = _acceptRole();
        emit ExecutorRotated(oldExec, executor);
    }

    function submitSwapIntent(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadlineOffset
    ) external whenNotPaused returns (bytes32 intentId) {
        if (tokenIn == address(0) || tokenOut == address(0)) revert ZeroAddress();
        if (tokenIn == tokenOut) revert SameToken();
        if (amountIn == 0) revert ZeroAmount();
        if (deadlineOffset < MIN_DEADLINE_OFFSET) revert DeadlineTooShort();
        if (deadlineOffset > MAX_DEADLINE_OFFSET) revert DeadlineTooLong();

        uint256 currentNonce = nonces[_msgSender()];
        nonces[_msgSender()] = currentNonce + 1;
        intentId = keccak256(abi.encode(block.chainid, address(this), _msgSender(), currentNonce));

        uint256 deadline = block.timestamp + deadlineOffset;
        intents[intentId] = SwapIntent({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            minAmountOut: minAmountOut,
            user: _msgSender(),
            deadline: deadline
        });

        // C-04: Escrow tokenIn from user
        IERC20(tokenIn).safeTransferFrom(_msgSender(), address(this), amountIn);

        emit IntentSubmitted(intentId, msg.sender, tokenIn, tokenOut, deadline);
    }

    function getIntentMeta(
        bytes32 intentId
    ) external view returns (address tokenIn, address tokenOut, address user, uint256 deadline) {
        SwapIntent storage i = intents[intentId];
        return (i.tokenIn, i.tokenOut, i.user, i.deadline);
    }

    function cancelIntent(bytes32 intentId) external {
        if (intents[intentId].user != _msgSender()) revert NotCreator();
        // C-04: Return escrowed tokensIn to user
        address tokenIn = intents[intentId].tokenIn;
        uint256 amountIn = intents[intentId].amountIn;
        delete intents[intentId];
        IERC20(tokenIn).safeTransfer(_msgSender(), amountIn);
        emit IntentCancelled(intentId, msg.sender);
    }

    function executeIntent(bytes32 intentId, uint256 outputAmount) external whenNotPaused {
        if (msg.sender != executor) revert NotExecutor();
        SwapIntent storage i = intents[intentId];
        if (i.user == address(0)) revert UnknownIntent();
        if (block.timestamp > i.deadline) revert IntentExpired();
        if (outputAmount == 0) revert ZeroOutput();
        // C-03: Enforce minAmountOut
        if (outputAmount < i.minAmountOut) revert InsufficientOutput();

        address user = i.user;
        address tokenOut = i.tokenOut;
        address tokenIn = i.tokenIn;
        uint256 amountIn = i.amountIn;

        IERC20(tokenOut).safeTransferFrom(msg.sender, user, outputAmount);
        // C-04: Release escrowed tokenIn to executor
        IERC20(tokenIn).safeTransfer(msg.sender, amountIn);
        delete intents[intentId];
        emit IntentExecuted(intentId, user, outputAmount);
    }
}
