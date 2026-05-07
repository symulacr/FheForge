// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import { FHE, InEuint64, InEuint128, euint128, euint64 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";

interface IPermit2 {
    struct TokenPermissions {
        address token;
        uint256 amount;
    }
    struct PermitTransferFrom {
        TokenPermissions permitted;
        uint256 nonce;
        uint256 deadline;
    }
    struct SignatureTransferDetails {
        address to;
        uint256 requestedAmount;
    }

    function permitTransferFrom(
        PermitTransferFrom calldata permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external;
}

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
    ) external;

    function openPosition(
        address token,
        uint256 amount,
        euint128 encAmount,
        uint256 strategyId,
        address user
    ) external;

    function addCollateral(
        address collateralToken,
        uint256 amount,
        InEuint64 calldata encAmount
    ) external;

    function addCollateral(
        address collateralToken,
        uint256 amount,
        InEuint64 calldata encAmount,
        address user
    ) external;

    function addCollateral(
        address collateralToken,
        uint256 amount,
        euint128 encAmount,
        address user
    ) external;

    function closePosition(
        uint256 collateralAmount,
        InEuint128 calldata encCollateralAmount
    ) external;

    function hasPosition(address user) external view returns (bool);
}

interface ILendingPool {
    function supply(address token, uint256 amount, InEuint64 calldata encAmount) external;

    function supplyToLending(
        address token,
        uint256 amount,
        InEuint64 calldata encAmount,
        address user
    ) external;

    function supplyToLending(
        address token,
        uint256 amount,
        euint64 encAmount,
        address user
    ) external;

    function checkLtvAndBorrow(
        address collateralToken,
        address borrowToken,
        uint256 borrowAmount,
        InEuint64 calldata encBorrowAmount,
        uint128 ltvNum,
        uint128 ltvDen
    ) external returns (euint64);

    function borrowWithOracle(
        address collateralToken,
        address borrowToken,
        uint256 borrowAmount,
        InEuint64 calldata encBorrowAmount
    ) external returns (euint64);

    function borrowFromLending(
        address token,
        uint256 amount,
        InEuint64 calldata encAmount,
        address user
    ) external;

    function borrowFromLending(
        address token,
        uint256 amount,
        euint64 encAmount,
        address user
    ) external;

    function repay(address token, uint256 amount, InEuint64 calldata encAmount) external;

    function repayBorrow(
        address token,
        uint256 amount,
        InEuint64 calldata encAmount,
        address user
    ) external;

    function repayBorrow(
        address token,
        uint256 amount,
        euint64 encAmount,
        address user
    ) external;

    function withdraw(address token, uint256 amount, InEuint64 calldata encAmount) external;
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


    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

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
        ) revert ZeroAddress();
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



    struct Permit2Authorization {
        uint256 amount;
        uint256 deadline;
        uint256 nonce;
        bytes signature;
    }








    struct OpenStrategyParams {
        string strategyName;
        bytes32 workflowHash;
        address collateralToken;
        uint256 collateralAmount;
        uint256 poolSupplyAmount;
        address borrowToken;
        uint256 poolBorrowAmount;
        bool useOracleBorrow;
        uint128 ltvNum;
        uint128 ltvDen;
        address swapTokenOut;
        uint256 swapDeadlineOffset;
        uint256 strategyId;
        uint16 apyTarget;
        uint8 loopCount;
        uint256 swapAmountIn;
        uint256 swapMinOut;
        Permit2Authorization collateralPermit;
    }

    struct OpenStrategyEncrypted {
        InEuint128 collateral;
        InEuint64 supplyEnc;
        InEuint64 borrowEnc;
    }




    function openLeveragedStrategy(
        OpenStrategyParams calldata p,
        OpenStrategyEncrypted calldata e
    ) external nonReentrant whenNotPaused returns (uint256 strategyId, bytes32 intentId) {
        uint256 pulled = _pullViaPermit2(p.collateralToken, p.collateralPermit);
        strategyId = _resolveStrategyId(p);


        uint256 vaultCovered = pulled > p.collateralAmount ? p.collateralAmount : pulled;
        _openVaultPosition(p, e, vaultCovered, strategyId);
        _supplyToPool(p, e, pulled - vaultCovered);
        _borrowFromPool(p, e);
        intentId = _submitSwap(p, e);

        emit LeveragedStrategyOpened(
            msg.sender,
            strategyId,
            intentId,
            p.poolSupplyAmount,
            p.poolBorrowAmount
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
        uint256 permitCovered,
        uint256 strategyId
    ) internal {
        if (p.collateralAmount == 0) return;
        uint256 needsPull = p.collateralAmount - permitCovered;
        if (needsPull > 0) {
            IERC20(p.collateralToken).safeTransferFrom(_msgSender(), address(this), needsPull);
        }
        _ensureApproval(p.collateralToken, address(VAULT), p.collateralAmount);
        VAULT.openPosition(p.collateralToken, p.collateralAmount, e.collateral, strategyId, _msgSender());
    }

    function _supplyToPool(
        OpenStrategyParams calldata p,
        OpenStrategyEncrypted calldata e,
        uint256 permitCovered
    ) internal {
        if (p.poolSupplyAmount == 0) return;
        uint256 needsPull =
            p.poolSupplyAmount > permitCovered ? p.poolSupplyAmount - permitCovered : 0;
        if (needsPull > 0) {
            IERC20(p.collateralToken).safeTransferFrom(_msgSender(), address(this), needsPull);
        }
        _ensureApproval(p.collateralToken, address(POOL), p.poolSupplyAmount);
        euint64 supplyHandle = FHE.asEuint64(e.supplyEnc);
        FHE.allowThis(supplyHandle);
        POOL.supplyToLending(p.collateralToken, p.poolSupplyAmount, supplyHandle, _msgSender());
    }

    function _borrowFromPool(
        OpenStrategyParams calldata p,
        OpenStrategyEncrypted calldata e
    ) internal {
        if (p.poolBorrowAmount == 0) return;
        euint64 borrowHandle = FHE.asEuint64(e.borrowEnc);
        FHE.allowThis(borrowHandle);
        POOL.borrowFromLending(p.borrowToken, p.poolBorrowAmount, borrowHandle, _msgSender());
        uint256 received = IERC20(p.borrowToken).balanceOf(address(this));
        if (received > 0) {
            IERC20(p.borrowToken).safeTransfer(_msgSender(), received);
        }
    }

    function _submitSwap(
        OpenStrategyParams calldata p,
        OpenStrategyEncrypted calldata e
    ) internal returns (bytes32) {
        if (p.swapTokenOut == address(0)) return bytes32(0);
        return
            ROUTER.submitSwapIntent(
                p.collateralToken,
                p.swapTokenOut,
                p.swapAmountIn,
                p.swapMinOut,
                p.swapDeadlineOffset
            );
    }


    struct RebalanceParams {
        address collateralToken;
        uint256 addCollateralAmount;
        uint256 repayAmount;
        address repayToken;
        uint256 newBorrowAmount;
        address borrowToken;
        bool useOracleBorrow;
        uint128 ltvNum;
        uint128 ltvDen;
        Permit2Authorization collateralPermit;
        Permit2Authorization repayPermit;
    }

    struct RebalanceEncrypted {
        InEuint64 addCollateralEnc;
        InEuint64 repayEnc;
        InEuint64 newBorrowEnc;
    }


    function rebalance(
        RebalanceParams calldata p,
        RebalanceEncrypted calldata e
    ) external nonReentrant whenNotPaused {
        uint256 collateralPulled = 0;
        if (p.addCollateralAmount > 0) {
            collateralPulled = _pullViaPermit2(p.collateralToken, p.collateralPermit);
        }
        uint256 repayPulled = 0;
        if (p.repayAmount > 0) {
            repayPulled = _pullViaPermit2(p.repayToken, p.repayPermit);
        }
        if (p.addCollateralAmount > 0) {
            uint256 needsPull =
                p.addCollateralAmount > collateralPulled
                    ? p.addCollateralAmount - collateralPulled
                    : 0;
            if (needsPull > 0) {
                IERC20(p.collateralToken).safeTransferFrom(_msgSender(), address(this), needsPull);
            }
            _ensureApproval(p.collateralToken, address(VAULT), p.addCollateralAmount);
            VAULT.addCollateral(p.collateralToken, p.addCollateralAmount, e.addCollateralEnc, _msgSender());
        }

        if (p.repayAmount > 0) {
            uint256 needsPull = p.repayAmount > repayPulled ? p.repayAmount - repayPulled : 0;
            if (needsPull > 0) {
                IERC20(p.repayToken).safeTransferFrom(_msgSender(), address(this), needsPull);
            }
            _ensureApproval(p.repayToken, address(POOL), p.repayAmount);
            POOL.repay(p.repayToken, p.repayAmount, e.repayEnc);
        }

        if (p.newBorrowAmount > 0) {
            euint64 borrowHandle = FHE.asEuint64(e.newBorrowEnc);
            FHE.allowThis(borrowHandle);
            POOL.borrowFromLending(p.borrowToken, p.newBorrowAmount, borrowHandle, _msgSender());
            uint256 received = IERC20(p.borrowToken).balanceOf(address(this));
            if (received > 0) {
                IERC20(p.borrowToken).safeTransfer(_msgSender(), received);
            }
        }

        emit StrategyRebalanced(
            msg.sender,
            p.addCollateralAmount,
            p.repayAmount,
            p.newBorrowAmount
        );
    }



    function _pullViaPermit2(
        address token,
        Permit2Authorization calldata auth
    ) internal returns (uint256 pulled) {
        if (auth.deadline == 0) return 0;
        IPermit2(PERMIT2).permitTransferFrom(
            IPermit2.PermitTransferFrom({
                permitted: IPermit2.TokenPermissions({ token: token, amount: auth.amount }),
                nonce: auth.nonce,
                deadline: auth.deadline
            }),
            IPermit2.SignatureTransferDetails({ to: address(this), requestedAmount: auth.amount }),
            _msgSender(),
            auth.signature
        );
        return auth.amount;
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
