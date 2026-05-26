// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { FHE, InEuint128, euint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { FheForgeBase } from "./FheForgeBase.sol";
import { ILendingPool } from "./interfaces/ILendingPool.sol";
import { IStrategyVault } from "./interfaces/IStrategyVault.sol";
import { IRegistry } from "./interfaces/IRegistry.sol";
import { ISwapRouter } from "./interfaces/ISwapRouter.sol";

contract FheForgeComposer is FheForgeBase {
    using SafeERC20 for IERC20;

    IRegistry public immutable REGISTRY;
    IStrategyVault public immutable VAULT;
    ILendingPool public immutable POOL;
    ISwapRouter public immutable ROUTER;

    event LeveragedStrategyOpened(
        address indexed user,
        uint256 indexed strategyId,
        bytes32 indexed intentId
    );
    event StrategyRebalanced(address indexed user);

    constructor(address registry_, address vault_, address pool_, address router_) FheForgeBase() {
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
    function openPosition(
        OpenStrategyParams calldata p,
        OpenStrategyEncrypted calldata e
    ) external nonReentrant whenNotPaused returns (uint256 strategyId, bytes32 intentId) {
        uint256 totalNeeded =
            p.collateralAmount > p.poolSupplyAmount ? p.collateralAmount : p.poolSupplyAmount;
        if (totalNeeded > 0) {
            IERC20(p.collateralToken).safeTransferFrom(_msgSender(), address(this), totalNeeded);
        }

        strategyId = _resolveStrategyId(p);
        uint256 vaultCovered = totalNeeded > p.collateralAmount ? p.collateralAmount : totalNeeded;
        _openVaultPosition(p, e, strategyId);
        _depositToPool(p, e, totalNeeded - vaultCovered);
        _borrowFromPool(p, e);
        intentId = _submitSwap(p, e);

        emit LeveragedStrategyOpened(msg.sender, strategyId, intentId);
    }

    function _resolveStrategyId(OpenStrategyParams calldata p) internal returns (uint256 id) {
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
    ) internal returns (bytes32 positionId) {
        if (p.collateralAmount == 0) return bytes32(0);
        _ensureApproval(p.collateralToken, address(VAULT), p.collateralAmount);
        euint128 incomingColl = FHE.asEuint128(e.collateral);
        euint128 verifiedColl = _verifyEquality(incomingColl, p.collateralAmount);
        FHE.allowTransient(verifiedColl, address(VAULT));
        return
            VAULT.openPosition(
                p.collateralToken,
                p.collateralAmount,
                verifiedColl,
                strategyId,
                _msgSender()
            );
    }

    function _depositToPool(
        OpenStrategyParams calldata p,
        OpenStrategyEncrypted calldata e,
        uint256 supplyAmount
    ) internal {
        if (supplyAmount == 0) return;
        _ensureApproval(p.collateralToken, address(POOL), supplyAmount);
        euint128 incomingSupply = FHE.asEuint128(e.supplyEnc);
        euint128 verifiedSupply = _verifyEquality(incomingSupply, supplyAmount);
        FHE.allowTransient(verifiedSupply, address(POOL));
        POOL.depositFor(p.collateralToken, supplyAmount, verifiedSupply, _msgSender());
    }

    function _borrowFromPool(
        OpenStrategyParams calldata p,
        OpenStrategyEncrypted calldata e
    ) internal {
        if (p.poolBorrowAmount == 0) return;
        euint128 incomingBorrow = FHE.asEuint128(e.borrowEnc);
        euint128 verifiedBorrow = _verifyEquality(incomingBorrow, p.poolBorrowAmount);
        FHE.allowTransient(verifiedBorrow, address(POOL));
        POOL.borrowFor(p.borrowToken, p.poolBorrowAmount, verifiedBorrow, _msgSender());
    }

    function _submitSwap(
        OpenStrategyParams calldata p,
        OpenStrategyEncrypted calldata /* e */
    ) internal returns (bytes32 intentId) {
        if (p.swapTokenOut == address(0)) {
            // No swap — forward borrowed tokens to user (if any were borrowed)
            if (p.borrowToken != address(0)) {
                uint256 received = IERC20(p.borrowToken).balanceOf(address(this));
                if (received > 0) {
                    IERC20(p.borrowToken).safeTransfer(_msgSender(), received);
                }
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
        if (p.addCollateralAmount > 0) {
            IERC20(p.collateralToken).safeTransferFrom(
                _msgSender(),
                address(this),
                p.addCollateralAmount
            );
        }
        if (p.repayAmount > 0) {
            IERC20(p.repayToken).safeTransferFrom(_msgSender(), address(this), p.repayAmount);
        }
        if (p.addCollateralAmount > 0) {
            _ensureApproval(p.collateralToken, address(VAULT), p.addCollateralAmount);
            euint128 addCollEnc = FHE.asEuint128(e.addCollateralEnc);
            euint128 verifiedAddColl = _verifyEquality(addCollEnc, p.addCollateralAmount);
            FHE.allowTransient(verifiedAddColl, address(VAULT));
            VAULT.addCollateral(
                p.positionId,
                p.collateralToken,
                p.addCollateralAmount,
                verifiedAddColl,
                _msgSender()
            );
        }

        if (p.repayAmount > 0) {
            _ensureApproval(p.repayToken, address(POOL), p.repayAmount);
            euint128 repayEnc = FHE.asEuint128(e.repayEnc);
            euint128 verifiedRepay = _verifyEquality(repayEnc, p.repayAmount);
            FHE.allowTransient(verifiedRepay, address(POOL));
            POOL.repayFor(p.repayToken, p.repayAmount, verifiedRepay, _msgSender());
        }

        if (p.newBorrowAmount > 0) {
            euint128 newBorrowEnc = FHE.asEuint128(e.newBorrowEnc);
            euint128 verifiedNewBorrow = _verifyEquality(newBorrowEnc, p.newBorrowAmount);
            FHE.allowTransient(verifiedNewBorrow, address(POOL));
            POOL.borrowFor(p.borrowToken, p.newBorrowAmount, verifiedNewBorrow, _msgSender());
        }

        emit StrategyRebalanced(msg.sender);
    }

    /// @notice Sweep accidental token balances from the contract to a recipient.
    /// @param token The token address to sweep.
    /// @param to The recipient address.
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
