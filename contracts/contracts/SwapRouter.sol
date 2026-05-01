// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import { FHE, InEuint128, euint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title  SwapRouter
/// @notice Confidential swap-intent router. Users submit intents with
///         encrypted amounts; a trusted off-chain executor decrypts via FHE
///         permits, performs the swap off-chain, and settles the output
///         on-chain. The executor is fully trusted — the contract cannot
///         enforce that it honours the encrypted minAmountOut.
contract SwapRouter is Pausable {
    using SafeERC20 for IERC20;

    uint256 public immutable MIN_DEADLINE_OFFSET;
    uint256 public immutable MAX_DEADLINE_OFFSET;
    uint256 public immutable EXECUTOR_ROTATION_DELAY;

    struct SwapIntent {
        address tokenIn;
        address tokenOut;
        euint128 amountIn;
        euint128 minAmountOut;
        address user;
        uint256 deadline;
    }

    mapping(bytes32 => SwapIntent) private intents;
    mapping(address => uint256) private nonces;

    address public executor;
    address public immutable OWNER;
    address public pendingExecutor;
    /// @notice Earliest `block.timestamp` at which `acceptExecutor` may be called.
    uint256 public pendingExecutorEarliest;

    error SameToken();
    error UnknownIntent();
    error NotCreator();
    error NotExecutor();
    error IntentExpired();
    error ZeroOutput();
    error ZeroAddress();
    error FhePermissionDenied();
    error DeadlineTooShort();
    error DeadlineTooLong();
    error OnlyOwner();
    error NoPendingExecutor();
    error TimelockNotElapsed();

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
    event Paused();
    event Unpaused();

    modifier onlyOwner() {
        _onlyOwner();
        _;
    }

    function _onlyOwner() internal view {
        if (msg.sender != OWNER) revert OnlyOwner();
    }

    constructor(
        address executor_,
        uint256 minDeadlineOffset_,
        uint256 maxDeadlineOffset_,
        uint256 executorRotationDelay_
    ) {
        if (executor_ == address(0)) revert ZeroAddress();
        if (minDeadlineOffset_ == 0) revert DeadlineTooShort();
        if (maxDeadlineOffset_ < minDeadlineOffset_) revert DeadlineTooLong();
        executor = executor_;
        MIN_DEADLINE_OFFSET = minDeadlineOffset_;
        MAX_DEADLINE_OFFSET = maxDeadlineOffset_;
        EXECUTOR_ROTATION_DELAY = executorRotationDelay_;
        OWNER = msg.sender;
    }

    /// @notice Propose a new executor. Starts the rotation timelock.
    function proposeExecutor(address newExecutor) external onlyOwner {
        if (newExecutor == address(0)) revert ZeroAddress();
        pendingExecutor = newExecutor;
        pendingExecutorEarliest = block.timestamp + EXECUTOR_ROTATION_DELAY;
        emit ExecutorProposed(newExecutor, pendingExecutorEarliest);
    }

    /// @notice Finalise an executor rotation after the timelock has elapsed.
    function acceptExecutor() external {
        if (pendingExecutor == address(0)) revert NoPendingExecutor();
        if (block.timestamp < pendingExecutorEarliest) revert TimelockNotElapsed();
        address oldExec = executor;
        executor = pendingExecutor;
        pendingExecutor = address(0);
        pendingExecutorEarliest = 0;
        emit ExecutorRotated(oldExec, executor);
    }

    function pause() external onlyOwner {
        _pause();
        emit Paused();
    }

    function unpause() external onlyOwner {
        _unpause();
        emit Unpaused();
    }

    /// @notice Submit a new swap intent with encrypted amounts.
    /// @return intentId Deterministic id derived from (chainid, this, user, nonce).
    function submitSwapIntent(
        address tokenIn,
        address tokenOut,
        InEuint128 calldata amountIn,
        InEuint128 calldata minAmountOut,
        uint256 deadlineOffset
    ) external whenNotPaused returns (bytes32 intentId) {
        if (tokenIn == address(0) || tokenOut == address(0)) revert ZeroAddress();
        if (tokenIn == tokenOut) revert SameToken();
        if (deadlineOffset < MIN_DEADLINE_OFFSET) revert DeadlineTooShort();
        if (deadlineOffset > MAX_DEADLINE_OFFSET) revert DeadlineTooLong();

        uint256 currentNonce = nonces[msg.sender];
        nonces[msg.sender] = currentNonce + 1;
        intentId = keccak256(abi.encode(block.chainid, address(this), msg.sender, currentNonce));

        euint128 a = FHE.asEuint128(amountIn);
        euint128 m = FHE.asEuint128(minAmountOut);
        FHE.allowThis(a);
        FHE.allowSender(a);
        FHE.allowThis(m);
        FHE.allowSender(m);

        uint256 deadline = block.timestamp + deadlineOffset;
        intents[intentId] = SwapIntent({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: a,
            minAmountOut: m,
            user: msg.sender,
            deadline: deadline
        });

        emit IntentSubmitted(intentId, msg.sender, tokenIn, tokenOut, deadline);
    }

    /// @return tokenIn  Input token.
    /// @return tokenOut Output token.
    /// @return user     Intent creator.
    /// @return deadline Expiry timestamp.
    function getIntentMeta(
        bytes32 intentId
    ) external view returns (address tokenIn, address tokenOut, address user, uint256 deadline) {
        SwapIntent storage i = intents[intentId];
        return (i.tokenIn, i.tokenOut, i.user, i.deadline);
    }

    /// @notice Return the encrypted input amount; caller must be the creator.
    function getAmountIn(bytes32 intentId) external returns (euint128) {
        SwapIntent storage i = intents[intentId];
        if (i.user != msg.sender) revert NotCreator();
        if (!FHE.isAllowed(i.amountIn, msg.sender)) revert FhePermissionDenied();
        FHE.allowSender(i.amountIn);
        return i.amountIn;
    }

    /// @notice Cancel a pending intent; only the original creator may call.
    function cancelIntent(bytes32 intentId) external {
        if (intents[intentId].user != msg.sender) revert NotCreator();
        delete intents[intentId];
        emit IntentCancelled(intentId, msg.sender);
    }

    /// @notice Execute an intent and forward `outputAmount` of `tokenOut` from
    ///         the executor (msg.sender) to the user. Only the current
    ///         executor may call.
    function executeIntent(bytes32 intentId, uint256 outputAmount) external whenNotPaused {
        if (msg.sender != executor) revert NotExecutor();
        SwapIntent storage i = intents[intentId];
        if (i.user == address(0)) revert UnknownIntent();
        if (block.timestamp > i.deadline) revert IntentExpired();
        if (outputAmount == 0) revert ZeroOutput();

        address user = i.user;
        address tokenOut = i.tokenOut;

        IERC20(tokenOut).safeTransferFrom(msg.sender, user, outputAmount);
        delete intents[intentId];
        emit IntentExecuted(intentId, user, outputAmount);
    }
}
