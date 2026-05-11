// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import { FHE, InEuint128, euint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";

interface IRegistry {
    function registerStrategy(
        string calldata name,
        bytes32 workflowHash,
        uint16 apyTarget,
        uint8 loopCount
    ) external returns (uint256 id);

    function strategyCount() external view returns (uint256);
}

interface IStrategyVault {
    function openPosition(
        address token,
        uint256 amount,
        InEuint128 calldata encAmount,
        uint256 strategyId,
        address user
    ) external returns (bytes32);

    function openPosition(
        address token,
        uint256 amount,
        euint128 encAmount,
        uint256 strategyId,
        address user
    ) external returns (bytes32);

    function addCollateral(
        bytes32 positionId,
        address collateralToken,
        uint256 amount,
        InEuint128 calldata encAmount,
        address user
    ) external;

    function addCollateral(
        bytes32 positionId,
        address collateralToken,
        uint256 amount,
        euint128 encAmount,
        address user
    ) external;

    function closePosition(
        bytes32 positionId,
        uint256 collateralAmount,
        InEuint128 calldata encCollateralAmount
    ) external;

    function positionExists(bytes32 positionId) external view returns (bool);
}

interface ILendingPool {
    function supply(address token, uint256 amount, InEuint128 calldata encAmount) external;

    function supplyToLending(
        address token,
        uint256 amount,
        euint128 handle,
        address user
    ) external;

    function checkLtvAndBorrow(
        address collateralToken,
        address borrowToken,
        uint256 borrowAmount,
        InEuint128 calldata encBorrowAmount,
        uint128 ltvNum,
        uint128 ltvDen
    ) external returns (euint128);

    function borrowWithOracle(
        address collateralToken,
        address borrowToken,
        uint256 borrowAmount,
        InEuint128 calldata encBorrowAmount
    ) external returns (euint128);

    function borrowFromLending(
        address token,
        uint256 amount,
        euint128 handle,
        address user
    ) external;

    function repay(address token, uint256 amount, InEuint128 calldata encAmount) external;

    function repayBorrow(
        address token,
        uint256 amount,
        euint128 handle,
        address user
    ) external;

    function withdraw(address token, uint256 amount, InEuint128 calldata encAmount) external;
}

interface ISwapRouter {
    function submitSwapIntent(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadlineOffset
    ) external returns (bytes32 intentId);
}

contract FheForgeComposer is ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    IRegistry public immutable REGISTRY;
    IStrategyVault public immutable VAULT;
    ILendingPool public immutable POOL;
    ISwapRouter public immutable ROUTER;
    address public immutable OWNER;

    error ZeroAddress();
    error NotOwner();

    event LeveragedStrategyOpened(
        address indexed user,
        uint256 indexed strategyId,
        bytes32 indexed intentId,
        uint256 supplyAmount,
        uint256 borrowAmount
    );
    event StrategyRebalanced(
        address indexed user,
        uint256 indexed addAmount,
        uint256 indexed repayAmount,
        uint256 newBorrowAmount
    );
    event Paused();
    event Unpaused();

    modifier onlyOwner() {
        _onlyOwner();
        _;
    }

    function _onlyOwner() internal view {
        if (msg.sender != OWNER) revert NotOwner();
    }

    constructor(address registry_, address vault_, address pool_, address router_) {
        if (
            registry_ == address(0) ||
            vault_ == address(0) ||
            pool_ == address(0) ||
            router_ == address(0)
        ) {
            revert ZeroAddress();
        }
        REGISTRY = IRegistry(registry_);
        VAULT = IStrategyVault(vault_);
        POOL = ILendingPool(pool_);
        ROUTER = ISwapRouter(router_);

        OWNER = msg.sender;
    }

    function pause() external onlyOwner {
        _pause();
        emit Paused();
    }

    function unpause() external onlyOwner {
        _unpause();
        emit Unpaused();
    }

    struct OpenStrategyParams {
        string strategyName;
        bytes32 workflowHash;
        uint256 collateralAmount;
        uint256 poolSupplyAmount;
        uint256 poolBorrowAmount;
        uint256 swapDeadlineOffset;
        uint256 strategyId;
        uint256 swapAmountIn;
        uint256 swapMinOut;
        address collateralToken;
        address borrowToken;
        address swapTokenOut;
        uint128 ltvNum;
        uint128 ltvDen;
        bool useOracleBorrow;
        uint16 apyTarget;
        uint8 loopCount;
    }

    struct OpenStrategyEncrypted {
        InEuint128 collateral;
        InEuint128 supplyEnc;
        InEuint128 borrowEnc;
    }

    /// @notice Open a leveraged strategy. User pre-approves Composer via direct transferFrom.
    function openLeveragedStrategy(
        OpenStrategyParams calldata p,
        OpenStrategyEncrypted calldata e
    ) external nonReentrant whenNotPaused returns (uint256 strategyId, bytes32 intentId) {
        // Pull total needed: max of collateralAmount and poolSupplyAmount from user
        uint256 totalNeeded =
            p.collateralAmount > p.poolSupplyAmount ? p.collateralAmount : p.poolSupplyAmount;
        if (totalNeeded > 0) {
            IERC20(p.collateralToken).safeTransferFrom(_msgSender(), address(this), totalNeeded);
        }

        strategyId = _resolveStrategyId(p);
        // Split: vault gets collateralAmount, pool gets the remainder
        uint256 vaultCovered =
            totalNeeded > p.collateralAmount ? p.collateralAmount : totalNeeded;
        _openVaultPosition(p, e, strategyId);
        _supplyToPool(p, e, totalNeeded - vaultCovered);
        _borrowFromPool(p, e);
        intentId = _submitSwap(p, e);

        emit LeveragedStrategyOpened(
            msg.sender, strategyId, intentId, p.poolSupplyAmount, p.poolBorrowAmount
        );
    }

    function _resolveStrategyId(OpenStrategyParams calldata p) internal returns (uint256) {
        if (p.strategyId == 0) {
            return
                REGISTRY.registerStrategy(p.strategyName, p.workflowHash, p.apyTarget, p.loopCount);
        }
        return p.strategyId;
    }

    function _openVaultPosition(
        OpenStrategyParams calldata p,
        OpenStrategyEncrypted calldata e,
        uint256 strategyId
    ) internal returns (bytes32) {
        if (p.collateralAmount == 0) return bytes32(0);
        _ensureApproval(p.collateralToken, address(VAULT), p.collateralAmount);
        euint128 incomingColl = FHE.asEuint128(e.collateral);
        FHE.allowTransient(incomingColl, address(VAULT));
        return VAULT.openPosition(
            p.collateralToken, p.collateralAmount, e.collateral, strategyId, _msgSender()
        );
    }

    function _supplyToPool(
        OpenStrategyParams calldata p,
        OpenStrategyEncrypted calldata e,
        uint256 supplyAmount
    ) internal {
        if (supplyAmount == 0) return;
        _ensureApproval(p.collateralToken, address(POOL), supplyAmount);
        // P0: Grant Pool ACL to use encrypted supply handle
        euint128 incomingSupply = FHE.asEuint128(e.supplyEnc);
        FHE.allowTransient(incomingSupply, address(POOL));
        POOL.supplyToLending(p.collateralToken, supplyAmount, incomingSupply, _msgSender());
    }

    function _borrowFromPool(
        OpenStrategyParams calldata p,
        OpenStrategyEncrypted calldata e
    ) internal {
        if (p.poolBorrowAmount == 0) return;
        // P0: Grant Pool ACL to use encrypted borrow handle
        euint128 incomingBorrow = FHE.asEuint128(e.borrowEnc);
        FHE.allowTransient(incomingBorrow, address(POOL));
        POOL.borrowFromLending(p.borrowToken, p.poolBorrowAmount, incomingBorrow, _msgSender());
        // P0: Keep borrowed tokens in Composer for potential swap escrow.
        // Do NOT send to user here — _submitSwap handles forwarding.
    }

    function _submitSwap(
        OpenStrategyParams calldata p,
        OpenStrategyEncrypted calldata /* e */
    ) internal returns (bytes32) {
        if (p.swapTokenOut == address(0)) {
            // No swap — forward borrowed tokens to user
            uint256 received = IERC20(p.borrowToken).balanceOf(address(this));
            if (received > 0) {
                IERC20(p.borrowToken).safeTransfer(_msgSender(), received);
            }
            return bytes32(0);
        }
        // Swap needed — escrow from Composer to Router
        _ensureApproval(p.borrowToken, address(ROUTER), p.swapAmountIn);
        return
            ROUTER.submitSwapIntent(
                p.borrowToken,
                p.swapTokenOut,
                p.swapAmountIn,
                p.swapMinOut,
                p.swapDeadlineOffset
            );
    }

    struct RebalanceParams {
        bytes32 positionId;
        address collateralToken;
        uint256 addCollateralAmount;
        uint256 repayAmount;
        address repayToken;
        uint256 newBorrowAmount;
        address borrowToken;
        bool useOracleBorrow;
        uint128 ltvNum;
        uint128 ltvDen;
    }

    struct RebalanceEncrypted {
        InEuint128 addCollateralEnc;
        InEuint128 repayEnc;
        InEuint128 newBorrowEnc;
    }

    /// @notice Rebalance a strategy position. User pre-approves Composer via direct transferFrom.
    function rebalance(
        RebalanceParams calldata p,
        RebalanceEncrypted calldata e
    ) external nonReentrant whenNotPaused {
        // Pull collateral directly
        if (p.addCollateralAmount > 0) {
            IERC20(p.collateralToken).safeTransferFrom(
                _msgSender(), address(this), p.addCollateralAmount
            );
        }
        // Pull repay token directly
        if (p.repayAmount > 0) {
            IERC20(p.repayToken).safeTransferFrom(_msgSender(), address(this), p.repayAmount);
        }
        if (p.addCollateralAmount > 0) {
            _ensureApproval(p.collateralToken, address(VAULT), p.addCollateralAmount);
            // P0: Grant Vault ACL to use encrypted collateral handle
            euint128 addCollEnc = FHE.asEuint128(e.addCollateralEnc);
            FHE.allowTransient(addCollEnc, address(VAULT));
            VAULT.addCollateral(
                p.positionId, p.collateralToken, p.addCollateralAmount, e.addCollateralEnc, _msgSender()
            );
        }

        if (p.repayAmount > 0) {
            _ensureApproval(p.repayToken, address(POOL), p.repayAmount);
            // P0: Grant Pool ACL to use encrypted repay handle
            euint128 repayEnc = FHE.asEuint128(e.repayEnc);
            FHE.allowTransient(repayEnc, address(POOL));
            POOL.repayBorrow(p.repayToken, p.repayAmount, repayEnc, _msgSender());
        }

        if (p.newBorrowAmount > 0) {
            // P0: Grant Pool ACL to use encrypted borrow handle
            euint128 newBorrowEnc = FHE.asEuint128(e.newBorrowEnc);
            FHE.allowTransient(newBorrowEnc, address(POOL));
            POOL.borrowFromLending(
                p.borrowToken, p.newBorrowAmount, newBorrowEnc, _msgSender()
            );
            // P0: Keep borrowed tokens in Composer (consistent with openLeveragedStrategy)
        }

        emit StrategyRebalanced(
            msg.sender, p.addCollateralAmount, p.repayAmount, p.newBorrowAmount
        );
    }

    function sweepToken(address token, address to) external onlyOwner {
        if (token == address(0) || to == address(0)) revert ZeroAddress();
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal > 0) {
            IERC20(token).safeTransfer(to, bal);
        }
    }

    function _ensureApproval(address token, address spender, uint256 amount) internal {
        uint256 current = IERC20(token).allowance(address(this), spender);
        if (current < amount) {
            IERC20(token).forceApprove(spender, 0);
            IERC20(token).forceApprove(spender, type(uint256).max);
        }
    }
}