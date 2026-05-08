// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {
    FHE,
    InEuint128,
    InEuint64,
    euint128,
    euint64
} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IStrategyRegistry } from "./IStrategyRegistry.sol";
import { SharedStrategyMeta } from "./libraries/SharedStrategyMeta.sol";

contract StrategyVault is ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    struct Position {
        euint128 collateral;
        euint128 debt;
    }

    mapping(address => Position) private positions;
    mapping(address => bool) public hasPosition;
    mapping(address => address) private collateralTokens;
    mapping(address => uint256) private depositedAmounts;
    mapping(address => uint256) private positionStrategyIds;

    mapping(address => uint256) private positionOpenedAtBlock;

    address public immutable REGISTRY;
    address public immutable OWNER;

    euint128 private immutable _ZERO;

    error PositionAlreadyExists();
    error InvalidStrategyId();
    error NoPosition();
    error ExceedsDeposit();
    error ZeroAddress();
    error ZeroAmount();
    error TokenMismatch();
    error OnlyOwner();
    error SameBlockClose();

    event PositionOpened(
        address indexed user,
        address indexed collateralToken,
        uint256 collateralAmount,
        uint256 indexed strategyId
    );
    event CollateralAdded(
        address indexed user,
        address indexed collateralToken,
        uint256 indexed amount
    );
    event PositionClosed(
        address indexed user,
        address indexed collateralToken,
        uint256 indexed collateralAmount,
        bool fullClose
    );
    event Paused();
    event Unpaused();
    event EmergencyWithdrawn(
        address indexed user,
        address indexed collateralToken,
        uint256 indexed amount
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

    /// @notice Opens a vault position for `user`. Caller (Composer) holds the tokens.
    ///         Debt defaults to zero.
    /// @dev    Dual plain+encrypted input: no on-chain equality check between `amount`
    ///         and `encAmount`. User can skew. Mitigation requires CoFHE ZK proof of
    ///         equality (post-MVP). Trusted Composer guards this in practice.
    function openPosition(
        address token,
        uint256 amount,
        InEuint128 calldata encAmount,
        uint256 strategyId,
        address user
    ) external nonReentrant whenNotPaused {
        if (hasPosition[user]) revert PositionAlreadyExists();
        if (amount == 0) revert ZeroAmount();
        if (token == address(0)) revert ZeroAddress();

        depositedAmounts[user] = amount;
        collateralTokens[user] = token;
        positionOpenedAtBlock[user] = block.number;
        hasPosition[user] = true;
        positionStrategyIds[user] = strategyId;

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        euint128 c = FHE.asEuint128(encAmount);

        positions[user] = Position({ collateral: c, debt: _ZERO });

        SharedStrategyMeta.grantPositionAcl(user, c, _ZERO);

        emit PositionOpened(user, token, amount, strategyId);
    }

    /// @notice Zero-copy overload: caller already holds a verified euint128 handle.
    function openPosition(
        address token,
        uint256 amount,
        euint128 encAmount,
        uint256 strategyId,
        address user
    ) external nonReentrant whenNotPaused {
        if (hasPosition[user]) revert PositionAlreadyExists();
        if (amount == 0) revert ZeroAmount();
        if (token == address(0)) revert ZeroAddress();

        depositedAmounts[user] = amount;
        collateralTokens[user] = token;
        positionOpenedAtBlock[user] = block.number;
        hasPosition[user] = true;
        positionStrategyIds[user] = strategyId;

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        positions[user] = Position({ collateral: encAmount, debt: _ZERO });

        SharedStrategyMeta.grantPositionAcl(user, encAmount, _ZERO);

        emit PositionOpened(user, token, amount, strategyId);
    }

    /// @notice Adds collateral to an existing position on behalf of `user`.
    ///         Uses euint64 for collateral amounts (L3: < 18.4B * 1e18).
    function addCollateral(
        address collateralToken,
        uint256 amount,
        InEuint64 calldata encAmount,
        address user
    ) external nonReentrant whenNotPaused {
        if (!hasPosition[user]) revert NoPosition();
        if (amount == 0) revert ZeroAmount();
        if (collateralTokens[user] != collateralToken) revert TokenMismatch();

        depositedAmounts[user] += amount;

        IERC20(collateralToken).safeTransferFrom(msg.sender, address(this), amount);

        euint64 incoming64 = FHE.asEuint64(encAmount);
        euint128 newCollateral = FHE.add(positions[user].collateral, FHE.asEuint128(incoming64));
        positions[user].collateral = newCollateral;

        SharedStrategyMeta.grantUpdatedHandle(user, newCollateral);

        emit CollateralAdded(user, collateralToken, amount);
    }

    /// @notice euint128 overload: caller already holds a verified euint128 handle.
    ///         Skips FHE.asEuint128() conversion, saving ~150k gas.
    function addCollateral(
        address collateralToken,
        uint256 amount,
        euint128 encAmount,
        address user
    ) external nonReentrant whenNotPaused {
        if (!hasPosition[user]) revert NoPosition();
        if (amount == 0) revert ZeroAmount();
        if (collateralTokens[user] != collateralToken) revert TokenMismatch();

        depositedAmounts[user] += amount;

        IERC20(collateralToken).safeTransferFrom(msg.sender, address(this), amount);

        euint128 newCollateral = FHE.add(positions[user].collateral, encAmount);
        positions[user].collateral = newCollateral;

        SharedStrategyMeta.grantUpdatedHandle(user, newCollateral);

        emit CollateralAdded(user, collateralToken, amount);
    }

    function closePosition(
        uint256 collateralAmount,
        InEuint128 calldata encCollateralAmount
    ) external nonReentrant whenNotPaused {
        if (!hasPosition[_msgSender()]) revert NoPosition();
        if (collateralAmount == 0) revert ZeroAmount();
        uint256 deposited = depositedAmounts[_msgSender()];
        if (collateralAmount > deposited) revert ExceedsDeposit();
        if (positionOpenedAtBlock[_msgSender()] + 1 > block.number) revert SameBlockClose();

        address token = collateralTokens[_msgSender()];
        uint256 strategyId = positionStrategyIds[_msgSender()];

        uint256 remaining = deposited - collateralAmount;
        depositedAmounts[_msgSender()] = remaining;

        Position storage pos = positions[_msgSender()];
        euint128 currentCollateral = pos.collateral;
        bool fullClose = remaining == 0;

        if (fullClose) {
            delete positions[_msgSender()];
            delete collateralTokens[_msgSender()];
            delete positionStrategyIds[_msgSender()];
            delete positionOpenedAtBlock[_msgSender()];
            hasPosition[_msgSender()] = false;
        }

        euint128 encClosed = FHE.asEuint128(encCollateralAmount);
        FHE.allowThis(encClosed);

        if (!fullClose) {
            euint128 newCollateral = FHE.sub(
                currentCollateral,
                FHE.min(encClosed, currentCollateral)
            );
            pos.collateral = newCollateral;
            FHE.allowThis(newCollateral);
            FHE.allow(newCollateral, _msgSender());
        }

        if (strategyId != 0) {
            FHE.allowTransient(encClosed, REGISTRY);
            IStrategyRegistry(REGISTRY).decrementTvl(strategyId, encClosed);
        }

        IERC20(token).safeTransfer(_msgSender(), collateralAmount);

        emit PositionClosed(msg.sender, token, collateralAmount, fullClose);
    }

    function emergencyWithdraw() external nonReentrant whenPaused {
        if (!hasPosition[_msgSender()]) revert NoPosition();
        uint256 amount = depositedAmounts[_msgSender()];
        if (amount == 0) revert ZeroAmount();
        address token = collateralTokens[_msgSender()];
        uint256 strategyId = positionStrategyIds[_msgSender()];
        euint128 coll = positions[_msgSender()].collateral;

        if (strategyId != 0) {
            FHE.allowTransient(coll, REGISTRY);
            IStrategyRegistry(REGISTRY).decrementTvl(strategyId, coll);
        }

        depositedAmounts[_msgSender()] = 0;
        hasPosition[_msgSender()] = false;
        delete collateralTokens[_msgSender()];
        delete positionStrategyIds[_msgSender()];
        delete positionOpenedAtBlock[_msgSender()];
        delete positions[_msgSender()];

        IERC20(token).safeTransfer(_msgSender(), amount);
        emit EmergencyWithdrawn(msg.sender, token, amount);
    }

    function pause() external onlyOwner {
        _pause();
        // emit Paused();
    }

    function unpause() external onlyOwner {
        _unpause();
        // emit Unpaused();
    }

    function getCollateral() external nonReentrant returns (euint128) {
        if (!hasPosition[_msgSender()]) revert NoPosition();
        FHE.allow(positions[_msgSender()].collateral, _msgSender());
        return positions[_msgSender()].collateral;
    }

    function getPositionMeta() external view returns (uint256 strategyId, uint256 createdAt) {
        if (!hasPosition[_msgSender()]) revert NoPosition();
        return (positionStrategyIds[_msgSender()], positionOpenedAtBlock[_msgSender()]);
    }

    function getDepositedAmount() external view returns (uint256) {
        return depositedAmounts[_msgSender()];
    }
}
