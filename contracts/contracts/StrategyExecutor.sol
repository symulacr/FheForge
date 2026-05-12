// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { FHE, InEuint128, euint128, ebool } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { FheForgeBase } from "./FheForgeBase.sol";
import { ILendingPool } from "./interfaces/ILendingPool.sol";
import { IStrategyVault } from "./interfaces/IStrategyVault.sol";
import { ISwapRouter } from "./interfaces/ISwapRouter.sol";

contract StrategyExecutor is FheForgeBase {
    using SafeERC20 for IERC20;

    ILendingPool public immutable POOL;
    IStrategyVault public immutable VAULT;
    ISwapRouter public immutable ROUTER;

    // Action type selectors
    bytes4 public constant SHIELD_SUPPLY = 0x00000001;
    bytes4 public constant BORROW_LTV = 0x00000002;
    bytes4 public constant SWAP_INTENT = 0x00000003;
    bytes4 public constant REPAY_DEBT = 0x00000004;
    bytes4 public constant DEPOSIT_VAULT = 0x00000005;
    bytes4 public constant ADD_COLLATERAL = 0x00000006;
    bytes4 public constant WITHDRAW_VAULT = 0x00000007;
    bytes4 public constant SWAP_UNISWAP_V3 = 0x00000008;

    struct Action {
        bytes4 actionType;
        bytes params;
        InEuint128 encAmount; // encrypted amount for FHE operations
    }

    struct Checkpoint {
        uint256 actionIndex;
        bool completed;
    }

    mapping(bytes32 => Checkpoint) public checkpoints;

    event PipelineExecuted(bytes32 indexed strategyId, uint256 stepsCompleted, bool completed);
    event ActionExecuted(bytes32 indexed strategyId, uint256 indexed index, bytes4 actionType);

    constructor(address pool_, address vault_, address router_) FheForgeBase() {
        if (pool_ == address(0) || vault_ == address(0) || router_ == address(0)) revert ZeroAddress();
        POOL = ILendingPool(pool_);
        VAULT = IStrategyVault(vault_);
        ROUTER = ISwapRouter(router_);
    }

    /// @notice Execute a pipeline of actions. Saves checkpoint if gas runs out.
    function executePipeline(
        bytes32 strategyId,
        Action[] calldata actions
    ) external nonReentrant whenNotPaused returns (bool completed) {
        Checkpoint storage cp = checkpoints[strategyId];
        uint256 startIdx = cp.completed ? 0 : cp.actionIndex;

        for (uint256 i = startIdx; i < actions.length; i++) {
            // Gas check: leave 100K for finalization
            if (gasleft() < 100_000) {
                cp.actionIndex = i;
                cp.completed = false;
                emit PipelineExecuted(strategyId, i - startIdx, false);
                return false;
            }

            _executeAction(strategyId, i, actions[i]);
        }

        cp.completed = true;
        cp.actionIndex = actions.length;
        emit PipelineExecuted(strategyId, actions.length - startIdx, true);
        return true;
    }

    function _executeAction(bytes32 strategyId, uint256 index, Action calldata action) internal {
        emit ActionExecuted(strategyId, index, action.actionType);

        if (action.actionType == SHIELD_SUPPLY) {
            (address token, uint256 amount) = abi.decode(action.params, (address, uint256));
            IERC20(token).safeTransferFrom(_msgSender(), address(this), amount);
            _ensureApproval(token, address(POOL), amount);
            POOL.depositFor(token, amount, FHE.asEuint128(action.encAmount), _msgSender());
        } else if (action.actionType == BORROW_LTV) {
            (address token, uint256 amount) = abi.decode(action.params, (address, uint256));
            POOL.borrowFor(token, amount, FHE.asEuint128(action.encAmount), _msgSender());
        } else if (action.actionType == SWAP_INTENT) {
            (address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, uint256 deadline) =
                abi.decode(action.params, (address, address, uint256, uint256, uint256));
            IERC20(tokenIn).safeTransferFrom(_msgSender(), address(this), amountIn);
            _ensureApproval(tokenIn, address(ROUTER), amountIn);
            ROUTER.submitSwapIntent(tokenIn, tokenOut, amountIn, minOut, deadline);
        } else if (action.actionType == REPAY_DEBT) {
            (address token, uint256 amount) = abi.decode(action.params, (address, uint256));
            IERC20(token).safeTransferFrom(_msgSender(), address(this), amount);
            _ensureApproval(token, address(POOL), amount);
            POOL.repayFor(token, amount, FHE.asEuint128(action.encAmount), _msgSender());
        } else if (action.actionType == SWAP_UNISWAP_V3) {
            (address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint256 minOut) =
                abi.decode(action.params, (address, address, uint24, uint256, uint256));
            IERC20(tokenIn).safeTransferFrom(_msgSender(), address(this), amountIn);
            _ensureApproval(tokenIn, address(ROUTER), amountIn);
            ROUTER.swapViaUniswapV3Single(tokenIn, tokenOut, fee, amountIn, minOut);
        } else if (action.actionType == DEPOSIT_VAULT) {
            (address token, uint256 amount, uint256 strategyId_) =
                abi.decode(action.params, (address, uint256, uint256));
            IERC20(token).safeTransferFrom(_msgSender(), address(this), amount);
            _ensureApproval(token, address(VAULT), amount);
            VAULT.openPosition(token, amount, FHE.asEuint128(action.encAmount), strategyId_, _msgSender());
        } else if (action.actionType == ADD_COLLATERAL) {
            (bytes32 positionId, address token, uint256 amount) =
                abi.decode(action.params, (bytes32, address, uint256));
            IERC20(token).safeTransferFrom(_msgSender(), address(this), amount);
            _ensureApproval(token, address(VAULT), amount);
            VAULT.addCollateral(positionId, token, amount, FHE.asEuint128(action.encAmount), _msgSender());
        } else if (action.actionType == WITHDRAW_VAULT) {
            (bytes32 positionId, uint256 amount) =
                abi.decode(action.params, (bytes32, uint256));
            VAULT.closePosition(positionId, amount, FHE.asEuint128(action.encAmount));
        }
    }

    function _ensureApproval(address token, address spender, uint256 amount) internal {
        uint256 current = IERC20(token).allowance(address(this), spender);
        if (current < amount) {
            IERC20(token).forceApprove(spender, 0);
            IERC20(token).forceApprove(spender, type(uint256).max);
        }
    }

    /// @notice Reset checkpoint for a strategy
    function resetCheckpoint(bytes32 strategyId) external onlyOwner {
        delete checkpoints[strategyId];
    }

    /// @notice Sweep tokens accidentally sent to this contract
    function sweepToken(address token, address to) external onlyOwner {
        if (token == address(0) || to == address(0)) revert ZeroAddress();
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal > 0) IERC20(token).safeTransfer(to, bal);
    }
}