// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ILendingPool } from "../contracts/interfaces/ILendingPool.sol";
import { InEuint128, euint128, FHE } from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @notice Minimal LendingPool mock for StrategyExecutor tests.
///         Deployed as a real contract (not vm.mockCall) but avoids FHE
///         operations on cross-contract handles — just tracks plaintext
///         balances internally.
contract MockLendingPool is ILendingPool {
    using SafeERC20 for IERC20;

    error MockLendingPool_Unauthorized();

    address public composer;
    mapping(address => mapping(address => uint256)) public supplyBalances;
    mapping(address => mapping(address => uint256)) public borrowBalances;
    mapping(address => uint256) public liquidReserve;

    modifier onlyComposer() {
        if (msg.sender != composer) revert MockLendingPool_Unauthorized();
        _;
    }

    function setComposer(address composer_) external {
        composer = composer_;
    }

    function shield(address token, uint256 amount, InEuint128 calldata) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        liquidReserve[token] += amount;
    }

    function shieldEth(InEuint128 calldata) external payable {
        return;
    }

    function depositFor(
        address token,
        uint256 amount,
        euint128,
        address user
    ) external onlyComposer {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        supplyBalances[token][user] += amount;
    }

    function borrowFor(
        address token,
        uint256 amount,
        euint128,
        address user
    ) external onlyComposer {
        borrowBalances[token][user] += amount;
        IERC20(token).safeTransfer(user, amount);
    }

    function repayFor(address token, uint256 amount, euint128, address user) external onlyComposer {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        borrowBalances[token][user] -= amount;
    }

    function borrowWithLtvCheck(
        address /*collateralToken*/,
        address /*borrowToken*/,
        uint256 /*borrowAmount*/,
        InEuint128 calldata /*encBorrowAmount*/,
        uint128 /*ltvNum*/,
        uint128 /*ltvDen*/
    ) external returns (euint128 actual) {
        return FHE.asEuint128(0);
    }

    function borrowWithOracle(
        address /*collateralToken*/,
        address /*borrowToken*/,
        uint256 /*collateralAmount*/,
        uint256 /*borrowAmount*/,
        InEuint128 calldata /*encBorrowAmount*/
    ) external returns (euint128 actual) {
        return FHE.asEuint128(0);
    }

    function repayDebt(address token, uint256 amount, InEuint128 calldata) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    }

    function partialUnshield(address token, uint256 amount, InEuint128 calldata) external {
        IERC20(token).safeTransfer(msg.sender, amount);
    }

    function partialUnshieldEth(uint256, InEuint128 calldata) external {
        return;
    }

    function requestBalanceReveal(address) external {
        return;
    }

    function requestLiquidityCheck(address, address, address) external {
        return;
    }

    function withdrawPausedWithProof(address, uint128, bytes calldata) external {
        return;
    }

    function liquidateWithProof(
        address /*user*/,
        address /*collateralToken*/,
        address /*debtToken*/,
        uint256 /*debtToCover*/,
        uint128 /*debtBalanceProof*/,
        bytes calldata /*debtSig*/,
        uint128 /*supplyBalanceProof*/,
        bytes calldata /*supplySig*/
    ) external {
        return;
    }

    function getSupplyBalance(address) external returns (euint128 bal) {
        return FHE.asEuint128(0);
    }

    function getBorrowBalance(address) external returns (euint128 bal) {
        return FHE.asEuint128(0);
    }
}
