// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import { InEuint128, euint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";

interface IStrategyVault {
    function openPosition(
        address token,
        uint256 amount,
        euint128 encAmount,
        uint256 strategyId,
        address user
    ) external returns (bytes32);

    function addCollateral(
        bytes32 positionId,
        address collateralToken,
        uint256 amount,
        euint128 encAmount,
        address user
    ) external;

    function closePosition(
        bytes32 positionId,
        uint256 collateralAmount,
        InEuint128 calldata encCollateralAmount
    ) external;

    function withdrawPaused(bytes32 positionId) external;
    function getCollateral(bytes32 positionId) external returns (euint128);
    function getUserPositions(address user) external view returns (bytes32[] memory);
    function getPositionMeta(bytes32 positionId) external view returns (uint256 strategyId, uint256 createdAt);
    function getDepositedAmount(bytes32 positionId) external view returns (uint256);
}
