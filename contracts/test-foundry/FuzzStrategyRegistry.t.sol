// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { StrategyRegistry } from "../contracts/StrategyRegistry.sol";
import { FheForgeTestHelper } from "./FheForgeTestHelper.sol";

/// @notice Fuzz tests for StrategyRegistry (MC-077).
///         Covers: strategy name length bounds (1..256 chars), apyTarget/loopCount
///         boundary combinations, broadcast destination domain fuzzing, workflow
///         hash edge cases, and setActive with randomised IDs.
/// @custom:mock
contract FuzzStrategyRegistry is FheForgeTestHelper {
    uint256 internal constant ROTATION_DELAY = 48 hours;

    StrategyRegistry public registry;

    address public owner = makeAddr("owner");
    address public user  = makeAddr("user");
    address public vault = makeAddr("vault");

    bytes32 public constant WORKFLOW_HASH = keccak256("test-workflow");

    function setUp() public {
        _deployFheMocks();
        vm.prank(owner);
        registry = new StrategyRegistry(ROTATION_DELAY);
    }

    // ─── Fuzz 1: strategy name length boundaries ──────────────────────────────
    // Names with length 0 → EmptyName, 1..256 → success, ≥257 → NameTooLong.
    function testFuzzStrategyNameLength(uint256 nameLen) public {
        nameLen = bound(nameLen, 0, 300);

        string memory name = _makeString(nameLen);

        if (nameLen < 1) {
            vm.expectRevert(StrategyRegistry.EmptyName.selector);
            registry.registerStrategy(name, WORKFLOW_HASH);
        } else if (nameLen > 256) {
            vm.expectRevert(StrategyRegistry.NameTooLong.selector);
            registry.registerStrategy(name, WORKFLOW_HASH);
        } else {
            uint256 id = registry.registerStrategy(name, WORKFLOW_HASH);
            assertTrue(id > 0, "strategy id should be > 0");
            // Verify the name is stored correctly
            (string memory storedName,,,,) = registry.getStrategyMeta(id);
            assertEq(storedName, name, "stored name mismatch");
        }
    }

    // ─── Fuzz 2: apyTarget and loopCount boundary values ──────────────────────
    function testFuzzRegisterStrategyParams(
        uint256 nameLen,
        uint16 apyTarget,
        uint8 loopCount
    ) public {
        nameLen = bound(nameLen, 1, 256);
        string memory name = _makeString(nameLen);

        uint256 id = registry.registerStrategy(name, WORKFLOW_HASH, apyTarget, loopCount);

        (uint16 storedApy, uint8 storedLoop) = registry.getStrategyParams(id);
        assertEq(storedApy, apyTarget, "apyTarget mismatch");
        assertEq(storedLoop, loopCount,  "loopCount mismatch");
    }

    // ─── Fuzz 3: duplicate detection with random names ────────────────────────
    // Register two strategies. Duplicate should revert even with param diffs.
    function testFuzzRegisterDuplicate(uint256 nameLen, uint16 apyTarget) public {
        nameLen = bound(nameLen, 1, 64);
        string memory name = _makeString(nameLen);

        registry.registerStrategy(name, WORKFLOW_HASH);

        // Same name + same sender → duplicate; even with different params
        vm.expectRevert(StrategyRegistry.StrategyAlreadyExists.selector);
        registry.registerStrategy(name, WORKFLOW_HASH, apyTarget, 1);
    }

    // ─── Fuzz 4: broadcastStrategy with destination domains ───────────────────
    function testFuzzBroadcastDestinationDomain(uint256 nameLen, uint256 destDomain) public {
        nameLen = bound(nameLen, 1, 64);
        string memory name = _makeString(nameLen);

        uint256 id = registry.registerStrategy(name, WORKFLOW_HASH);

        vm.expectEmit(true, true, true, true, address(registry));
        emit StrategyRegistry.CrossChainMessage(
            destDomain,
            keccak256(abi.encode(block.chainid, id, name, WORKFLOW_HASH, address(this), uint16(0), uint8(0))),
            address(this),
            abi.encode(block.chainid, id, name, WORKFLOW_HASH, address(this), uint16(0), uint8(0))
        );
        registry.broadcastStrategy(id, destDomain);
    }

    // ─── Fuzz 5: workflow hash edge cases ─────────────────────────────────────
    // Zero hash should revert; any non-zero should work.
    function testFuzzWorkflowHash(bytes32 wfHash) public {
        vm.assume(wfHash == bytes32(0) || (wfHash >> 248) > 0);
        string memory name = "test";

        if (wfHash == bytes32(0)) {
            vm.expectRevert(StrategyRegistry.ZeroWorkflowHash.selector);
            registry.registerStrategy(name, wfHash);
        } else {
            uint256 id = registry.registerStrategy(name, wfHash);
            ( , bytes32 storedHash, , , ) = registry.getStrategyMeta(id);
            assertEq(storedHash, wfHash, "workflow hash mismatch");
        }
    }

    // ─── Fuzz 6: setActive with various IDs ───────────────────────────────────
    // Register a strategy, then try to setActive with fuzzed IDs.
    function testFuzzSetActiveInvalidIds(uint256 registerCount, uint256 targetId) public {
        registerCount = bound(registerCount, 0, 5);
        targetId      = bound(targetId, 0, 10);

        // Register strategies
        for (uint256 i = 0; i < registerCount; i++) {
            registry.registerStrategy(_makeString(i + 1), keccak256(abi.encode(i)));
        }

        uint256 count = registry.strategyCount();

        if (targetId == 0 || targetId > count) {
            vm.expectRevert(StrategyRegistry.InvalidStrategyId.selector);
            registry.setActive(targetId, false);
        }
        // Valid IDs will revert with OnlyCreator since this contract is the creator
        // — that's a different revert, which is expected.
    }

    // ─── Fuzz 7: cross-chain strategy with param variations ───────────────────
    function testFuzzReceiveCrossChainParams(
        uint16 apyTarget,
        uint8 loopCount,
        uint256 nameLen
    ) public {
        nameLen = bound(nameLen, 1, 64);
        string memory name = _makeString(nameLen);
        address remoteCreator = makeAddr("remote");

        vm.prank(owner);
        registry.receiveCrossChainStrategy(
            1, 42, name, WORKFLOW_HASH, remoteCreator, apyTarget, loopCount
        );

        // The first cross-chain strategy gets id=0 (strategyCount starts at 0)
        ( , , address storedCreator, , ) = registry.getStrategyMeta(0);
        assertEq(storedCreator, remoteCreator);
    }

    // ─── Helper: generate a deterministic string of given length ──────────────
    function _makeString(uint256 len) internal pure returns (string memory) {
        if (len == 0) return "";
        bytes memory buf = new bytes(len);
        for (uint256 i = 0; i < len; i++) {
            // Use printable ASCII: start at '!' (33) to avoid empty bytes
            buf[i] = bytes1(uint8(33 + (i % 94)));
        }
        return string(buf);
    }
}
