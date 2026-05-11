// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {
    FHE,
    InEuint128,
    euint128,
    ebool
} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IStrategyRegistry } from "./IStrategyRegistry.sol";
import { SharedStrategyMeta } from "./libraries/SharedStrategyMeta.sol";
import { FHESafeMath128 } from "./libraries/FHESafeMath128.sol";

contract StrategyVault is ReentrancyGuard, Pausable {
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
    address public immutable OWNER;

    euint128 private immutable _ZERO;

    error PositionNotFound();
    error InvalidStrategyId();
    error NoPosition();
    error ExceedsDeposit();
    error ZeroAddress();
    error ZeroAmount();
    error TokenMismatch();
    error OnlyOwner();
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

    modifier onlyOwner() {
        _onlyOwner();
        _;
    }

    function _onlyOwner() internal view {
        if (msg.sender != OWNER) revert OnlyOwner();
    }

    constructor(address registry_) {
        if (registry_ == address(0)) revert ZeroAddress();
        REGISTRY = registry_;
        OWNER = msg.sender;
        euint128 z = FHE.asEuint128(0);
        FHE.allowThis(z);
        _ZERO = z;
    }

    /// @dev Substitute _ZERO for uninitialized handles (bytes32(0)).
    ///      See LendingPool._ensureInitialized for rationale.
    function _ensureInitialized(euint128 handle) internal view returns (euint128) {
        return FHE.isInitialized(handle) ? handle : _ZERO;
    }

    /// @notice Opens a vault position for `user`. Caller (Composer) holds the tokens.
    ///         Equality verification ensures encrypted input matches claimed plain amount.
    function openPosition(
        address token,
        uint256 amount,
        InEuint128 calldata encAmount,
        uint256 strategyId,
        address user
    ) external nonReentrant whenNotPaused returns (bytes32 positionId) {
        if (amount == 0) revert ZeroAmount();
        if (token == address(0)) revert ZeroAddress();

        // ─── P-CRIT-4 FIX: Equality verification ───
        euint128 incoming = FHE.asEuint128(encAmount);
        euint128 claimedPlain = FHE.asEuint128(amount);
        ebool amountsMatch = FHE.eq(incoming, claimedPlain);
        euint128 verifiedIncoming = FHE.select(amountsMatch, incoming, _ZERO);

        positionId = keccak256(abi.encode(user, userPositionNonce[user]++));

        positionDepositedAmount[positionId] = amount;
        positionCollateralToken[positionId] = token;
        positionOpenedAtBlock[positionId] = block.number;
        positionStrategyId[positionId] = strategyId;
        positionExists[positionId] = true;
        userPositionIds[user].push(positionId);

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        positions[user][positionId] = Position({ collateral: verifiedIncoming, debt: _ZERO });

        SharedStrategyMeta.grantPositionAcl(user, verifiedIncoming, _ZERO);

        emit PositionOpened(positionId, user, token, strategyId);
    }

    /// @notice Zero-copy overload: caller already holds a verified euint128 handle.
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
    ///         Equality verification ensures encrypted input matches claimed plain amount.
    function addCollateral(
        bytes32 positionId,
        address collateralToken,
        uint256 amount,
        InEuint128 calldata encAmount,
        address user
    ) external nonReentrant whenNotPaused {
        if (!positionExists[positionId]) revert PositionNotFound();
        if (amount == 0) revert ZeroAmount();
        if (positionCollateralToken[positionId] != collateralToken) revert TokenMismatch();

        positionDepositedAmount[positionId] += amount;

        IERC20(collateralToken).safeTransferFrom(msg.sender, address(this), amount);

        // ─── P-CRIT-4 FIX: Equality verification ───
        euint128 incoming = FHE.asEuint128(encAmount);
        euint128 claimedPlain = FHE.asEuint128(amount);
        ebool amountsMatch = FHE.eq(incoming, claimedPlain);
        euint128 verifiedIncoming = FHE.select(amountsMatch, incoming, _ZERO);

        // ─── P-CRIT-1 FIX: Safe increase ───
        (, euint128 newCollateral) = FHESafeMath128.tryIncrease(
            positions[user][positionId].collateral, verifiedIncoming
        );
        positions[user][positionId].collateral = newCollateral;

        SharedStrategyMeta.grantUpdatedHandle(user, newCollateral);

        emit CollateralAdded(positionId, user, collateralToken);
    }

    /// @notice euint128 overload: caller already holds a verified euint128 handle.
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
        (, euint128 newCollateral) = FHESafeMath128.tryIncrease(
            positions[user][positionId].collateral, encAmount
        );
        positions[user][positionId].collateral = newCollateral;

        SharedStrategyMeta.grantUpdatedHandle(user, newCollateral);

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
            euint128 claimedPlain = FHE.asEuint128(collateralAmount);
            ebool amountsMatch = FHE.eq(encClosed, claimedPlain);
            euint128 verifiedClosed = FHE.select(amountsMatch, encClosed, _ZERO);

            FHE.allowThis(verifiedClosed);
            FHE.allowTransient(verifiedClosed, REGISTRY);
            IStrategyRegistry(REGISTRY).decrementTvl(strategyId, verifiedClosed);

            if (!fullClose) {
                // ─── P-CRIT-1 FIX: Safe decrease ───
                (, euint128 newCollateral) = FHESafeMath128.tryDecrease(
                    currentCollateral, verifiedClosed
                );
                pos.collateral = newCollateral;
                FHE.allowThis(newCollateral);
                FHE.allow(newCollateral, user);
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

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
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
