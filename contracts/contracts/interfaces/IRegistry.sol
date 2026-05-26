// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IRegistry {
    function registerStrategy(
        string calldata name,
        bytes32 workflowHash,
        uint16 apyTarget,
        uint8 loopCount
    ) external returns (uint256 id);

    function strategyCount() external view returns (uint256 count);
}
