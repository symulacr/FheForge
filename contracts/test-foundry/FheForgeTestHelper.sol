// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "../lib/forge-std/src/Test.sol";
import { MockTaskManager } from "../node_modules/@cofhe/mock-contracts/contracts/MockTaskManager.sol";
import { MockACL } from "../node_modules/@cofhe/mock-contracts/contracts/MockACL.sol";

// FHE task manager fixed address from @fhenixprotocol/cofhe-contracts/FHE.sol
address constant TASK_MANAGER_ADDRESS = 0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9;

/// @notice Base test contract for FHE-dependent tests (MC-077).
///         Deploys FHE mocks (MockTaskManager + MockACL) at TASK_MANAGER_ADDRESS
///         so that FHE operations (asEuint128, allowThis, etc.) don't revert.
abstract contract FheForgeTestHelper is Test {
    /// @notice Deploy and install FHE mocks at the fixed TASK_MANAGER_ADDRESS.
    function _deployFheMocks() internal {
        MockACL mockAcl = new MockACL();
        MockTaskManager mockTm = new MockTaskManager();
        mockTm.initialize(address(this));
        mockTm.setACLContract(address(mockAcl));
        mockTm.setSecurityZones(-100, 100);

        // Copy runtime code to the fixed address
        vm.etch(TASK_MANAGER_ADDRESS, address(mockTm).code);

        // Copy all storage slots (256 max) to avoid fragility from
        // MockTaskManager adding/removing state variables.  The old
        // i <= 11 bound broke when new storage variables were added.
        // A sentinel break does not work here because the first few
        // uint256 state variables can legitimately be zero.
        for (uint256 i; i < 256; ++i) {
            vm.store(TASK_MANAGER_ADDRESS, bytes32(i), vm.load(address(mockTm), bytes32(i)));
        }
    }

    // Helper to get the TASK_MANAGER_ADDRESS from other test files.
    function getTaskManagerAddress() public pure returns (address addr) {
        return TASK_MANAGER_ADDRESS;
    }
}
