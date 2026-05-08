// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import { InEuint128, InEuint64, euint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";

interface IStrategyVault {
    /// @notice Opens a vault position for `user`. Caller (Composer) holds the tokens.
    function openPosition(
        address token,
        uint256 amount,
        InEuint128 calldata encAmount,
        uint256 strategyId,
        address user
    ) external;

    /// @notice Zero-copy overload: caller already holds a verified euint128 handle.
    ///         Skips FHE.asEuint128() conversion, saving ~150k gas.
    function openPosition(
        address token,
        uint256 amount,
        euint128 encAmount,
        uint256 strategyId,
        address user
    ) external;

    /// @notice Adds collateral to an existing position on behalf of `user`.
    function addCollateral(
        address collateralToken,
        uint256 amount,
        InEuint64 calldata encAmount,
        address user
    ) external;

    /// @notice Zero-copy overload: caller already holds a verified euint128 handle.
    ///         Skips FHE.asEuint128() conversion, saving ~150k gas.
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

    function emergencyWithdraw() external;

    function pause() external;

    function unpause() external;

    function getCollateral() external returns (euint128);

    function getPositionMeta() external view returns (uint256 strategyId, uint256 createdAt);

    function getDepositedAmount() external view returns (uint256);

    function hasPosition(address user) external view returns (bool);
}
