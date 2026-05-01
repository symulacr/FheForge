// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import { FHE, InEuint128, euint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IStrategyRegistry } from "./IStrategyRegistry.sol";
import { SharedStrategyMeta } from "./libraries/SharedStrategyMeta.sol";

/// @title  StrategyVault
/// @notice Confidential leveraged-strategy vault. Holds plaintext ERC-20
///         collateral mirrored by encrypted per-position handles
///         (collateral + projected debt). Strategy-level params (target
///         APY, loop count) live as plaintext on the registry's `Strategy`
///         struct since F-03 — they are not per-user-private.
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
    /// @notice Block at which each user opened their position. Used by
    ///         `closePosition` to reject same-block open+close attempts.
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

    /// @notice Open a new leveraged position with encrypted collateral + debt.
    /// @param collateral Encrypted matching collateral amount.
    /// @param debt       Encrypted projected debt (informational).
    /// @param strategyId Strategy id registered with the StrategyRegistry.
    /// @dev   Pre-F-03 this also took encrypted `apyTarget` (euint16) and
    ///        `loopCount` (euint8). They moved to the registry's `Strategy`
    ///        struct as plaintext since they describe the strategy itself,
    ///        not the per-user position. Saves ~65k gas (2× FHE.asEuint*).
    function openPosition(
        address collateralToken,
        uint256 collateralAmount,
        InEuint128 calldata collateral,
        InEuint128 calldata debt,
        uint256 strategyId
    ) external nonReentrant whenNotPaused {
        if (hasPosition[msg.sender]) revert PositionAlreadyExists();
        if (strategyId == 0) revert InvalidStrategyId();
        if (collateralAmount == 0) revert ZeroAmount();
        if (collateralToken == address(0)) revert ZeroAddress();

        depositedAmounts[msg.sender] = collateralAmount;
        collateralTokens[msg.sender] = collateralToken;
        positionStrategyIds[msg.sender] = strategyId;
        positionOpenedAtBlock[msg.sender] = block.number;
        hasPosition[msg.sender] = true;

        IERC20(collateralToken).safeTransferFrom(msg.sender, address(this), collateralAmount);

        euint128 c = FHE.asEuint128(collateral);
        euint128 d = FHE.asEuint128(debt);

        positions[msg.sender] = Position({ collateral: c, debt: d });

        SharedStrategyMeta.grantPositionAcl(msg.sender, c, d);

        FHE.allowTransient(c, REGISTRY);
        IStrategyRegistry(REGISTRY).incrementTvl(strategyId, c);

        emit PositionOpened(msg.sender, collateralToken, collateralAmount, strategyId);
    }

    /// @notice Add collateral to an existing position; the token must match
    ///         the position's existing collateral token.
    function addCollateral(
        address collateralToken,
        uint256 amount,
        InEuint128 calldata encAmount
    ) external nonReentrant whenNotPaused {
        if (!hasPosition[msg.sender]) revert NoPosition();
        if (amount == 0) revert ZeroAmount();
        if (collateralTokens[msg.sender] != collateralToken) revert TokenMismatch();

        depositedAmounts[msg.sender] += amount;
        uint256 strategyId = positionStrategyIds[msg.sender];

        IERC20(collateralToken).safeTransferFrom(msg.sender, address(this), amount);

        euint128 incoming = FHE.asEuint128(encAmount);
        euint128 newCollateral = FHE.add(positions[msg.sender].collateral, incoming);
        positions[msg.sender].collateral = newCollateral;

        FHE.allowThis(incoming);
        SharedStrategyMeta.grantUpdatedHandle(msg.sender, newCollateral);

        FHE.allowTransient(incoming, REGISTRY);
        IStrategyRegistry(REGISTRY).incrementTvl(strategyId, incoming);

        emit CollateralAdded(msg.sender, collateralToken, amount);
    }

    /// @notice Close part or all of the caller's position. Vault collateral
    ///         is independent of any LendingPool debt — callers must repay
    ///         the pool separately. Reverts if called in the same block as
    ///         `openPosition` (front-run / sandwich guard).
    function closePosition(
        uint256 collateralAmount,
        InEuint128 calldata encCollateralAmount
    ) external nonReentrant whenNotPaused {
        // Cache hot mapping reads once. msg.sender is read implicitly through
        // each mapping access — caching the storage refs saves N keccak hashes
        // per call (was 6, now 1 keccak per slot).
        if (!hasPosition[msg.sender]) revert NoPosition();
        if (collateralAmount == 0) revert ZeroAmount();
        uint256 deposited = depositedAmounts[msg.sender];
        if (collateralAmount > deposited) revert ExceedsDeposit();
        if (positionOpenedAtBlock[msg.sender] + 1 > block.number) revert SameBlockClose();

        address token = collateralTokens[msg.sender];
        uint256 strategyId = positionStrategyIds[msg.sender];

        uint256 remaining = deposited - collateralAmount;
        depositedAmounts[msg.sender] = remaining;

        Position storage pos = positions[msg.sender];
        euint128 currentCollateral = pos.collateral;
        bool fullClose = remaining == 0;

        if (fullClose) {
            delete positions[msg.sender];
            delete collateralTokens[msg.sender];
            delete positionStrategyIds[msg.sender];
            delete positionOpenedAtBlock[msg.sender];
            hasPosition[msg.sender] = false;
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
            FHE.allowSender(newCollateral);
        }

        FHE.allowTransient(encClosed, REGISTRY);
        IStrategyRegistry(REGISTRY).decrementTvl(strategyId, encClosed);

        IERC20(token).safeTransfer(msg.sender, collateralAmount);

        emit PositionClosed(msg.sender, token, collateralAmount, fullClose);
    }

    /// @notice When paused, the caller may pull their remaining plaintext
    ///         collateral without touching encrypted state. Used during FHE
    ///         backend outages.
    function emergencyWithdraw() external nonReentrant whenPaused {
        if (!hasPosition[msg.sender]) revert NoPosition();
        uint256 amount = depositedAmounts[msg.sender];
        if (amount == 0) revert ZeroAmount();
        address token = collateralTokens[msg.sender];

        depositedAmounts[msg.sender] = 0;
        hasPosition[msg.sender] = false;
        delete collateralTokens[msg.sender];
        delete positionStrategyIds[msg.sender];
        delete positionOpenedAtBlock[msg.sender];
        delete positions[msg.sender];

        IERC20(token).safeTransfer(msg.sender, amount);
        emit EmergencyWithdrawn(msg.sender, token, amount);
    }

    function pause() external onlyOwner {
        _pause();
        emit Paused();
    }

    function unpause() external onlyOwner {
        _unpause();
        emit Unpaused();
    }

    /// @notice Caller's encrypted collateral handle, granting them off-chain
    ///         decryption rights.
    function getCollateral() external nonReentrant returns (euint128) {
        if (!hasPosition[msg.sender]) revert NoPosition();
        FHE.allowSender(positions[msg.sender].collateral);
        return positions[msg.sender].collateral;
    }

    /// @return strategyId Strategy id this position is associated with.
    /// @return createdAt  Block number when the position was opened.
    function getPositionMeta() external view returns (uint256 strategyId, uint256 createdAt) {
        if (!hasPosition[msg.sender]) revert NoPosition();
        return (positionStrategyIds[msg.sender], positionOpenedAtBlock[msg.sender]);
    }

    function getDepositedAmount() external view returns (uint256) {
        return depositedAmounts[msg.sender];
    }
}
