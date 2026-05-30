// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { InEuint128, euint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";

interface ILendingPool {
    function shield(address token, uint256 amount, InEuint128 calldata encAmount) external;
    function shieldEth(InEuint128 calldata encAmount) external payable;
    function depositFor(address token, uint256 amount, euint128 handle, address user) external;
    function borrowWithLtvCheck(
        address collateralToken,
        address borrowToken,
        uint256 borrowAmount,
        InEuint128 calldata encBorrowAmount,
        uint128 ltvNum,
        uint128 ltvDen
    ) external returns (euint128 actual);
    function borrowWithOracle(
        address collateralToken,
        address borrowToken,
        uint256 collateralAmount,
        uint256 borrowAmount,
        InEuint128 calldata encBorrowAmount
    ) external returns (euint128 actual);
    function borrowFor(address token, uint256 amount, euint128 handle, address user) external;
    function repayDebt(address token, uint256 amount, InEuint128 calldata encAmount) external;
    function repayFor(address token, uint256 amount, euint128 handle, address user) external;
    function partialUnshield(address token, uint256 amount, InEuint128 calldata encAmount) external;
    function partialUnshieldEth(uint256 amount, InEuint128 calldata encAmount) external;
    function requestBalanceReveal(address token) external;
    function requestLiquidityCheck(
        address user,
        address collateralToken,
        address debtToken
    ) external;
    function withdrawPausedWithProof(
        address token,
        uint128 balanceProof,
        bytes calldata balanceSig
    ) external;
    function liquidateWithProof(
        address user,
        address collateralToken,
        address debtToken,
        uint256 debtToCover,
        uint128 debtBalanceProof,
        bytes calldata debtSig,
        uint128 supplyBalanceProof,
        bytes calldata supplySig
    ) external;
    function getSupplyBalance(address token) external returns (euint128 bal);
    function getBorrowBalance(address token) external returns (euint128 bal);
    function isLiquidatable(
        address user,
        address collateralToken,
        address debtToken,
        uint256 collateralAmount,
        uint256 borrowAmount
    ) external view returns (bool liquidatable);
}
