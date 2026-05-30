// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IStrategyVault } from "../interfaces/IStrategyVault.sol";
import { euint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @notice Mock vault that returns a pre-configured positionId from openPosition.
contract VaultMock is IStrategyVault {
    error NotMocked();

    bytes32 public positionId;

    constructor(bytes32 _positionId) {
        positionId = _positionId;
    }

    function setPositionId(bytes32 _positionId) external {
        positionId = _positionId;
    }

    function openPosition(
        address,
        uint256,
        euint128,
        uint256,
        address
    ) external view returns (bytes32 id) {
        return positionId;
    }

    function addCollateral(bytes32, address, uint256, euint128, address) external pure {
        return;
    }

    function closePosition(bytes32, uint256, euint128) external pure {
        return;
    }

    function withdrawPaused(bytes32) external pure {
        return;
    }

    function getCollateral(bytes32) external pure returns (euint128 coll) {
        revert NotMocked();
    }

    function getUserPositions(address) external pure returns (bytes32[] memory ids) {
        revert NotMocked();
    }

    function getPositionMeta(
        bytes32
    ) external pure returns (uint256 strategyId, uint256 createdAt) {
        revert NotMocked();
    }

    function getDepositedAmount(bytes32) external pure returns (uint256 amount) {
        revert NotMocked();
    }
}
