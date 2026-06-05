// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ILendingPool } from "../interfaces/ILendingPool.sol";
import { euint128, InEuint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @notice Mock pool that silently succeeds for depositFor, borrowFor, repayFor.
contract PoolMock is ILendingPool {
    error NotMocked();

    function depositFor(address, uint256, euint128, address) external pure {
        return;
    }

    function borrowFor(address, uint256, euint128, address) external pure {
        return;
    }

    function repayFor(address, uint256, euint128, address) external pure {
        return;
    }

    function supply(address, uint256, euint128, address) external pure {
        revert NotMocked();
    }

    function withdraw(address, uint256, euint128, address) external pure {
        revert NotMocked();
    }

    function borrow(address, uint256, euint128, address) external pure {
        revert NotMocked();
    }

    function repay(address, uint256, euint128, address) external pure {
        revert NotMocked();
    }

    function getSupplyBalance(address) external pure returns (euint128 bal) {
        revert NotMocked();
    }

    function getBorrowBalance(address) external pure returns (euint128 bal) {
        revert NotMocked();
    }

    function getPlainSupplyBalance(address, address) external pure returns (uint256 amount) {
        return 0;
    }

    function getPlainBorrowBalance(address, address) external pure returns (uint256 amount) {
        return 0;
    }

    function shield(address, uint256, InEuint128 calldata) external pure {
        revert NotMocked();
    }

    function borrowWithLtvCheck(
        address,
        address,
        uint256,
        InEuint128 calldata,
        uint128,
        uint128
    ) external pure returns (euint128 actual) {
        revert NotMocked();
    }

    function borrowWithOracle(
        address,
        address,
        uint256,
        uint256,
        InEuint128 calldata
    ) external pure returns (euint128 actual) {
        revert NotMocked();
    }

    function repayDebt(address, uint256, InEuint128 calldata) external pure {
        revert NotMocked();
    }

    function partialUnshield(address, uint256, InEuint128 calldata) external pure {
        revert NotMocked();
    }

    function partialUnshieldEth(uint256, InEuint128 calldata) external pure {
        revert NotMocked();
    }

    function requestBalanceReveal(address) external pure {
        revert NotMocked();
    }

    function withdrawPausedWithProof(address, uint128, bytes calldata) external pure {
        revert NotMocked();
    }

    function isLiquidatable(
        address,
        address,
        address,
        uint256,
        uint256
    ) external pure returns (bool liquidatable) {
        return false;
    }

    function liquidateWithProof(
        address,
        address,
        address,
        uint256,
        uint128,
        bytes calldata,
        uint128,
        bytes calldata
    ) external pure {
        revert NotMocked();
    }

    // ── Commit-reveal stubs ───────────────────────────────────────

    function shield(address, InEuint128 calldata) external payable returns (bytes32) {
        revert NotMocked();
    }

    function executeShield(address, bytes32, uint128, bytes calldata) external payable {
        revert NotMocked();
    }

    function commitBorrow(
        address,
        address,
        InEuint128 calldata,
        uint128,
        uint128
    ) external payable returns (bytes32) {
        revert NotMocked();
    }

    function executeBorrow(bytes32, uint128, bytes calldata) external payable returns (euint128) {
        revert NotMocked();
    }

    function repay(address, InEuint128 calldata) external payable returns (bytes32) {
        revert NotMocked();
    }

    function executeRepay(address, bytes32, uint128, bytes calldata) external payable {
        revert NotMocked();
    }

    function withdraw(address, InEuint128 calldata) external payable returns (bytes32) {
        revert NotMocked();
    }

    function executeWithdraw(address, bytes32, uint128, bytes calldata) external payable {
        revert NotMocked();
    }

    function shieldEth(InEuint128 calldata) external payable returns (bytes32) {
        revert NotMocked();
    }

    function executeShieldEth(bytes32, uint128, bytes calldata) external payable {
        revert NotMocked();
    }

    function withdrawEth(InEuint128 calldata) external payable returns (bytes32) {
        revert NotMocked();
    }

    function executeWithdrawEth(bytes32, uint128, bytes calldata) external payable {
        revert NotMocked();
    }
}
