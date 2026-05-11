// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {
    FHE,
    InEuint128,
    euint128,
    ebool
} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IStrategyRegistry } from "./IStrategyRegistry.sol";
import { FheForgeBase } from "./FheForgeBase.sol";
import { SharedStrategyMeta } from "./libraries/SharedStrategyMeta.sol";

contract StrategyVault is FheForgeBase {
    using SafeERC20 for IERC20;

    struct Position {
        euint128 collateral;
        euint128 debt;
    }

    mapping(address => mapping(bytes32 => Position)) private positions;
    mapping(address => bytes32[]) private userPositionIds;
    mapping(bytes32 => address) private positionCollateralToken;
    mapping(bytes32 => uint256) private positionDepositedAmount;
    mapping(bytes32 => uint256) private positionStrategyId;
    mapping(bytes32 => uint256) private positionOpenedAtBlock;
    mapping(bytes32 => bool) private positionExists;
    mapping(address => uint256) private userPositionNonce;

    address public immutable REGISTRY;

    error PositionNotFound();
    error InvalidStrategyId();
    error NoPosition();
    error ExceedsDeposit();
    error SameBlockClose();

    // ─── P-HIGH-6 FIX: Events no longer emit plain amounts ───
    event PositionOpened(
        bytes32 indexed positionId,
        address indexed user,
        address indexed collateralToken,
        uint256 strategyId
    );
    event CollateralAdded(
        bytes32 indexed positionId,
        address indexed user,
        address indexed collateralToken
    );
    event PositionClosed(
        bytes32 indexed positionId,
        address indexed user,
        address indexed collateralToken,
        bool fullClose
    );
    event PausedWithdrawn(
        bytes32 indexed positionId,
        address indexed user,
        address indexed collateralToken,
        uint256 amount
    );

    constructor(address registry_) FheForgeBase() {
        if (registry_ == address(0)) revert ZeroAddress();
        REGISTRY = registry_;
    }

    /// @notice Opens a vault position for `user`. Caller (Composer) holds the tokens.
    ///         Equality verification is done by the caller (Composer) before passing the handle.
    function openPosition(
        address token,
        uint256 amount,
        euint128 encAmount,
        uint256 strategyId,
        address user
    ) external nonReentrant whenNotPaused returns (bytes32 positionId) {
        if (amount == 0) revert ZeroAmount();
        if (token == address(0)) revert ZeroAddress();

        positionId = keccak256(abi.encode(user, userPositionNonce[user]++));

        positionDepositedAmount[positionId] = amount;
        positionCollateralToken[positionId] = token;
        positionOpenedAtBlock[positionId] = block.number;
        positionStrategyId[positionId] = strategyId;
        positionExists[positionId] = true;
        userPositionIds[user].push(positionId);

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        positions[user][positionId] = Position({ collateral: encAmount, debt: _ZERO });

        SharedStrategyMeta.grantPositionAcl(user, encAmount, _ZERO);

        emit PositionOpened(positionId, user, token, strategyId);
    }

    /// @notice Adds collateral to an existing position on behalf of `user`.
    ///         Equality verification is done by the caller (Composer) before passing the handle.
    function addCollateral(
        bytes32 positionId,
        address collateralToken,
        uint256 amount,
        euint128 encAmount,
        address user
    ) external nonReentrant whenNotPaused {
        if (!positionExists[positionId]) revert PositionNotFound();
        if (amount == 0) revert ZeroAmount();
        if (positionCollateralToken[positionId] != collateralToken) revert TokenMismatch();

        positionDepositedAmount[positionId] += amount;

        IERC20(collateralToken).safeTransferFrom(msg.sender, address(this), amount);

        // ─── P-CRIT-1 FIX: Safe increase ───
        positions[user][positionId].collateral = SharedStrategyMeta.safeIncrease(
            positions[user][positionId].collateral, encAmount, user
        );

        SharedStrategyMeta.grantUpdatedHandle(user, positions[user][positionId].collateral);

        emit CollateralAdded(positionId, user, collateralToken);
    }

    /// @notice Close a position with equality verification.
    function closePosition(
        bytes32 positionId,
        uint256 collateralAmount,
        InEuint128 calldata encCollateralAmount
    ) external nonReentrant whenNotPaused {
        if (!positionExists[positionId]) revert PositionNotFound();
        if (collateralAmount == 0) revert ZeroAmount();
        uint256 deposited = positionDepositedAmount[positionId];
        if (collateralAmount > deposited) revert ExceedsDeposit();
        if (positionOpenedAtBlock[positionId] + 1 > block.number) revert SameBlockClose();

        address token = positionCollateralToken[positionId];
        uint256 strategyId = positionStrategyId[positionId];
        address user = _msgSender();

        uint256 remaining = deposited - collateralAmount;
        positionDepositedAmount[positionId] = remaining;

        Position storage pos = positions[user][positionId];
        euint128 currentCollateral = pos.collateral;
        bool fullClose = remaining == 0;

        if (fullClose) {
            _deletePosition(user, positionId);
        }

        if (strategyId != 0) {
            // ─── P-CRIT-4 FIX: Equality verification ───
            euint128 encClosed = FHE.asEuint128(encCollateralAmount);
            euint128 verifiedClosed = _verifyEquality(encClosed, collateralAmount);

            FHE.allowThis(verifiedClosed);
            FHE.allowTransient(verifiedClosed, REGISTRY);
            IStrategyRegistry(REGISTRY).decrementTvl(strategyId, verifiedClosed);

            if (!fullClose) {
                // ─── P-CRIT-1 FIX: Safe decrease ───
                pos.collateral = _safeDecrease(currentCollateral, verifiedClosed, user);
            }
        }

        IERC20(token).safeTransfer(user, collateralAmount);

        emit PositionClosed(positionId, user, token, fullClose);
    }

    function withdrawPaused(bytes32 positionId) external nonReentrant whenPaused {
        if (!positionExists[positionId]) revert PositionNotFound();
        uint256 amount = positionDepositedAmount[positionId];
        if (amount == 0) revert ZeroAmount();
        address token = positionCollateralToken[positionId];
        uint256 strategyId = positionStrategyId[positionId];
        address user = _msgSender();
        euint128 coll = _ensureInitialized(positions[user][positionId].collateral);

        if (strategyId != 0) {
            FHE.allowTransient(coll, REGISTRY);
            IStrategyRegistry(REGISTRY).decrementTvl(strategyId, coll);
        }

        positionDepositedAmount[positionId] = 0;
        positionExists[positionId] = false;
        delete positionCollateralToken[positionId];
        delete positionStrategyId[positionId];
        delete positionOpenedAtBlock[positionId];
        delete positions[user][positionId];

        IERC20(token).safeTransfer(user, amount);
        emit PausedWithdrawn(positionId, user, token, amount);
    }

    function getCollateral(bytes32 positionId) external returns (euint128) {
        if (!positionExists[positionId]) revert PositionNotFound();
        euint128 coll = _ensureInitialized(positions[_msgSender()][positionId].collateral);
        FHE.allow(coll, _msgSender());
        FHE.allowSender(coll);
        return coll;
    }

    function getPositionMeta(bytes32 positionId) external view returns (uint256 strategyId, uint256 createdAt) {
        if (!positionExists[positionId]) revert PositionNotFound();
        return (positionStrategyId[positionId], positionOpenedAtBlock[positionId]);
    }

    function getDepositedAmount(bytes32 positionId) external view returns (uint256) {
        return positionDepositedAmount[positionId];
    }

    function getUserPositions(address user) external view returns (bytes32[] memory) {
        return userPositionIds[user];
    }

    /// @dev Deletes all state for a single position by positionId, then swaps-and-pops
    ///      the id from userPositionIds[user]. Does NOT clear positionExists — caller sets
    ///      that to false after this call.
    function _deletePosition(address user, bytes32 positionId) private {
        delete positions[user][positionId];
        delete positionCollateralToken[positionId];
        delete positionDepositedAmount[positionId];
        delete positionStrategyId[positionId];
        delete positionOpenedAtBlock[positionId];

        bytes32[] storage ids = userPositionIds[user];
        uint256 len = ids.length;
        for (uint256 i = 0; i < len; i++) {
            if (ids[i] == positionId) {
                ids[i] = ids[len - 1];
                ids.pop();
                break;
            }
        }
    }
}
