// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { FheForgeBase } from "./FheForgeBase.sol";
import { TimelockedRotation } from "./libraries/TimelockedRotation.sol";

/// @notice Uniswap V3 SwapRouter02 interface (minimal — only what we need)
interface IUniswapV3SwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }
    function exactInputSingle(
        ExactInputSingleParams calldata params
    ) external payable returns (uint256 amountOut);
    function exactInput(
        ExactInputParams calldata params
    ) external payable returns (uint256 amountOut);
}

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
    address public immutable UNISWAP_V3_ROUTER;

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
    event UniswapV3SingleSwap(
        address indexed user,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );
    event UniswapV3MultiHopSwap(
        address indexed user,
        uint256 indexed amountIn,
        uint256 indexed amountOut
    );

    constructor(
        address executor_,
        uint256 minDeadlineOffset_,
        uint256 maxDeadlineOffset_,
        uint256 executorRotationDelay_,
        address uniswapV3Router_
    ) TimelockedRotation(executorRotationDelay_) {
        if (executor_ == address(0)) revert ZeroAddress();
        if (minDeadlineOffset_ == 0) revert DeadlineTooShort();
        if (maxDeadlineOffset_ < minDeadlineOffset_) revert DeadlineTooLong();
        executor = executor_;
        MIN_DEADLINE_OFFSET = minDeadlineOffset_;
        MAX_DEADLINE_OFFSET = maxDeadlineOffset_;
        UNISWAP_V3_ROUTER = uniswapV3Router_;
    }

    /// @notice Propose a new executor address with timelock.
    function proposeExecutor(address newExecutor) external onlyOwner whenNotPaused {
        _proposeRole(newExecutor);
        emit ExecutorProposed(newExecutor, pendingRoleEarliest);
    }

    /// @notice Accept the pending executor role after timelock expires.
    function acceptExecutor() external whenNotPaused {
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
    ) external nonReentrant whenNotPaused returns (bytes32 intentId) {
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

    /// @notice Cancel a pending swap intent and return escrowed tokens.
    function cancelIntent(bytes32 intentId) external nonReentrant {
        if (intents[intentId].user != _msgSender()) revert NotCreator();
        // C-04: Return escrowed tokensIn to user
        address tokenIn = intents[intentId].tokenIn;
        uint256 amountIn = intents[intentId].amountIn;
        delete intents[intentId];
        IERC20(tokenIn).safeTransfer(_msgSender(), amountIn);
        emit IntentCancelled(intentId, msg.sender);
    }

    /// @notice Execute a swap intent (executor only).
    function executeIntent(
        bytes32 intentId,
        uint256 outputAmount
    ) external nonReentrant whenNotPaused {
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

        // CEI: delete state before external calls
        delete intents[intentId];
        emit IntentExecuted(intentId, user, outputAmount);

        IERC20(tokenOut).safeTransferFrom(msg.sender, user, outputAmount);
        // C-04: Release escrowed tokenIn to executor
        IERC20(tokenIn).safeTransfer(msg.sender, amountIn);
    }

    /// @notice Swap via Uniswap V3 single-hop exactInputSingle
    function swapViaUniswapV3Single(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOutMinimum
    ) external nonReentrant whenNotPaused returns (uint256 amountOut) {
        if (tokenIn == address(0) || tokenOut == address(0)) revert ZeroAddress();
        if (amountIn == 0) revert ZeroAmount();

        IERC20(tokenIn).safeTransferFrom(_msgSender(), address(this), amountIn);
        IERC20(tokenIn).forceApprove(UNISWAP_V3_ROUTER, amountIn);

        amountOut = IUniswapV3SwapRouter(UNISWAP_V3_ROUTER).exactInputSingle(
            IUniswapV3SwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: _msgSender(),
                deadline: block.timestamp,
                amountIn: amountIn,
                amountOutMinimum: amountOutMinimum,
                sqrtPriceLimitX96: 0
            })
        );

        emit UniswapV3SingleSwap(_msgSender(), tokenIn, tokenOut, amountIn, amountOut);
    }

    /// @notice Swap via Uniswap V3 multi-hop exactInput
    /// @param path Encoded as abi.encodePacked(tokenAddr, fee, tokenAddr, fee, ...)
    function swapViaUniswapV3MultiHop(
        bytes calldata path,
        uint256 amountIn,
        uint256 amountOutMinimum
    ) external nonReentrant whenNotPaused returns (uint256 amountOut) {
        if (amountIn == 0) revert ZeroAmount();

        // Decode first token from path for transferFrom
        address tokenIn = address(bytes20(path[:20]));
        IERC20(tokenIn).safeTransferFrom(_msgSender(), address(this), amountIn);
        IERC20(tokenIn).forceApprove(UNISWAP_V3_ROUTER, amountIn);

        amountOut = IUniswapV3SwapRouter(UNISWAP_V3_ROUTER).exactInput(
            IUniswapV3SwapRouter.ExactInputParams({
                path: path,
                recipient: _msgSender(),
                deadline: block.timestamp,
                amountIn: amountIn,
                amountOutMinimum: amountOutMinimum
            })
        );

        emit UniswapV3MultiHopSwap(_msgSender(), amountIn, amountOut);
    }
}
