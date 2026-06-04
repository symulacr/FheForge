// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { InEuint128, euint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";

interface ILendingPool {
    function shield(address token, uint256 amount, InEuint128 calldata encAmount) external;
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

    // Commit-reveal functions (no plaintext in calldata)
    function shield(address token, InEuint128 calldata encAmount) external payable returns (bytes32 commitId);
    function executeShield(address token, bytes32 commitId, uint128 balanceProof, bytes calldata balanceSig) external payable;
    function commitBorrow(address collateralToken, address borrowToken, InEuint128 calldata encBorrowAmount, uint128 ltvNum, uint128 ltvDen) external payable returns (bytes32 commitId);
    function executeBorrow(bytes32 commitId, uint128 balanceProof, bytes calldata balanceSig) external payable returns (euint128 actual);
    function repay(address token, InEuint128 calldata encAmount) external payable returns (bytes32 commitId);
    function executeRepay(address token, bytes32 commitId, uint128 balanceProof, bytes calldata balanceSig) external payable;
    function withdraw(address token, InEuint128 calldata encAmount) external payable returns (bytes32 commitId);
    function executeWithdraw(address token, bytes32 commitId, uint128 balanceProof, bytes calldata balanceSig) external payable;
    function shieldEth(InEuint128 calldata encAmount) external payable returns (bytes32 commitId);
    function executeShieldEth(bytes32 commitId, uint128 balanceProof, bytes calldata balanceSig) external payable;
    function withdrawEth(InEuint128 calldata encAmount) external payable returns (bytes32 commitId);
    function executeWithdrawEth(bytes32 commitId, uint128 balanceProof, bytes calldata balanceSig) external payable;
}
