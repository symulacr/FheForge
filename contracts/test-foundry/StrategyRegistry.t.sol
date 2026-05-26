// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { StrategyRegistry } from "../contracts/StrategyRegistry.sol";
import { FheForgeBase } from "../contracts/FheForgeBase.sol";
import { FheForgeTestHelper } from "./FheForgeTestHelper.sol";
import { ITaskManager } from "@fhenixprotocol/cofhe-contracts/ICofhe.sol";
import { FHE, euint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";

contract StrategyRegistryTest is FheForgeTestHelper {
    uint256 internal constant ROTATION_DELAY = 48 hours;

    StrategyRegistry public registry;

    address public owner = makeAddr("owner");
    address public user = makeAddr("user");
    address public vault = makeAddr("vault");
    address public other = makeAddr("other");

    bytes32 public constant WORKFLOW_HASH = keccak256("test-workflow");
    string public constant STRATEGY_NAME = "Test Strategy";

    function setUp() public {
        _deployFheMocks();
        vm.prank(owner);
        registry = new StrategyRegistry(ROTATION_DELAY);
    }

    function testConstructorSetsOwner() public view {
        assertEq(registry.owner(), owner);
    }

    function testConstructorSetsRotationDelay() public view {
        assertEq(registry.ROTATION_DELAY(), ROTATION_DELAY);
    }

    function testConstructorSetsStrategyCountZero() public view {
        assertEq(registry.strategyCount(), 0);
    }

    function testSetVault() public {
        vm.prank(owner);
        registry.setVault(vault);
        assertEq(registry.vaultAddress(), vault);
    }

    function testSetVaultRevertsOnZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(FheForgeBase.ZeroAddress.selector);
        registry.setVault(address(0));
    }

    function testSetVaultRevertsOnNonOwner() public {
        vm.prank(user);
        vm.expectRevert(FheForgeBase.OnlyOwner.selector);
        registry.setVault(vault);
    }

    function testSetVaultRevertsOnAlreadySet() public {
        vm.prank(owner);
        registry.setVault(vault);

        vm.prank(owner);
        vm.expectRevert(StrategyRegistry.VaultAlreadySet.selector);
        registry.setVault(other);
    }

    function testProposeVault() public {
        address newVault = makeAddr("newVault");
        vm.prank(owner);
        registry.proposeVault(newVault);

        assertEq(registry.pendingRole(), newVault);
        assertTrue(registry.pendingRoleEarliest() > block.timestamp);
    }

    function testProposeVaultRevertsOnNonOwner() public {
        vm.prank(user);
        vm.expectRevert(FheForgeBase.OnlyOwner.selector);
        registry.proposeVault(vault);
    }

    function testAcceptVaultAfterTimelock() public {
        address newVault = makeAddr("newVault");

        vm.prank(owner);
        registry.proposeVault(newVault);

        vm.warp(block.timestamp + ROTATION_DELAY);

        registry.acceptVault();

        assertEq(registry.vaultAddress(), newVault);
    }

    function testAcceptVaultRevertsOnEarly() public {
        address newVault = makeAddr("newVault");

        vm.prank(owner);
        registry.proposeVault(newVault);

        vm.warp(block.timestamp + ROTATION_DELAY - 1);

        vm.expectRevert();
        registry.acceptVault();
    }

    function testAcceptVaultRevertsOnNoPendingRole() public {
        vm.expectRevert();
        registry.acceptVault();
    }

    function testRegisterStrategy() public {
        uint256 id = registry.registerStrategy(STRATEGY_NAME, WORKFLOW_HASH);

        assertEq(id, 1);
        assertEq(registry.strategyCount(), 1);
    }

    function testRegisterStrategyReturnsIncrementedId() public {
        uint256 id1 = registry.registerStrategy("Strategy A", keccak256("hash-a"));
        uint256 id2 = registry.registerStrategy("Strategy B", keccak256("hash-b"));

        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(registry.strategyCount(), 2);
    }

    function testRegisterStrategyRevertsOnEmptyName() public {
        vm.expectRevert(StrategyRegistry.EmptyName.selector);
        registry.registerStrategy("", WORKFLOW_HASH);
    }

    function testRegisterStrategyRevertsOnZeroWorkflowHash() public {
        vm.expectRevert(StrategyRegistry.ZeroWorkflowHash.selector);
        registry.registerStrategy(STRATEGY_NAME, bytes32(0));
    }

    function testRegisterStrategyRevertsOnDuplicate() public {
        registry.registerStrategy(STRATEGY_NAME, WORKFLOW_HASH);

        vm.expectRevert(StrategyRegistry.StrategyAlreadyExists.selector);
        registry.registerStrategy(STRATEGY_NAME, WORKFLOW_HASH);
    }

    function testRegisterStrategyWithParams() public {
        uint16 apyTarget = 500; // 5%
        uint8 loopCount = 3;

        uint256 id = registry.registerStrategy(STRATEGY_NAME, WORKFLOW_HASH, apyTarget, loopCount);

        assertEq(id, 1);

        (uint16 storedApy, uint8 storedLoop) = registry.getStrategyParams(id);
        assertEq(storedApy, apyTarget);
        assertEq(storedLoop, loopCount);
    }

    function testRegisterStrategyWithParamsStoresMeta() public {
        uint256 id = registry.registerStrategy(STRATEGY_NAME, WORKFLOW_HASH, 1000, 2);

        (
            string memory name,
            bytes32 wfHash,
            address creator,
            uint256 createdAt,
            bool active
        ) = registry.getStrategyMeta(id);

        assertEq(name, STRATEGY_NAME);
        assertEq(wfHash, WORKFLOW_HASH);
        assertEq(creator, address(this));
        assertTrue(active);
        assertTrue(createdAt > 0);
    }

    function testRegisterStrategyRevertsOnNameTooLong() public {
        // Build a name that exceeds MAX_NAME_LENGTH (256)
        string memory longName;
        unchecked {
            // 257 'a' characters
            bytes memory buf = new bytes(257);
            for (uint256 i; i < 257; ++i) {
                buf[i] = "a";
            }
            longName = string(buf);
        }

        vm.expectRevert(StrategyRegistry.NameTooLong.selector);
        registry.registerStrategy(longName, WORKFLOW_HASH);
    }

    function testSetActiveDeactivates() public {
        uint256 id = registry.registerStrategy(STRATEGY_NAME, WORKFLOW_HASH);

        registry.setActive(id, false);

        (, , , , bool active) = registry.getStrategyMeta(id);
        assertFalse(active);
    }

    function testSetActiveReactivates() public {
        uint256 id = registry.registerStrategy(STRATEGY_NAME, WORKFLOW_HASH);

        registry.setActive(id, false);
        registry.setActive(id, true);

        (, , , , bool active) = registry.getStrategyMeta(id);
        assertTrue(active);
    }

    function testSetActiveRevertsOnInvalidIdZero() public {
        vm.expectRevert(StrategyRegistry.InvalidStrategyId.selector);
        registry.setActive(0, false);
    }

    function testSetActiveRevertsOnInvalidIdAboveCount() public {
        vm.expectRevert(StrategyRegistry.InvalidStrategyId.selector);
        registry.setActive(99, false);
    }

    function testSetActiveRevertsOnNonCreator() public {
        uint256 id = registry.registerStrategy(STRATEGY_NAME, WORKFLOW_HASH);

        vm.prank(user);
        vm.expectRevert(StrategyRegistry.OnlyCreator.selector);
        registry.setActive(id, false);
    }

    function testGetStrategyMetaReturnsDefaultForInactiveStrategy() public view {
        (
            string memory name,
            bytes32 wfHash,
            address creator,
            uint256 createdAt,
            bool active
        ) = registry.getStrategyMeta(999);

        assertEq(bytes(name).length, 0);
        assertEq(wfHash, bytes32(0));
        assertEq(creator, address(0));
        assertEq(createdAt, 0);
        assertFalse(active);
    }

    function testBroadcastStrategy() public {
        uint256 id = registry.registerStrategy(STRATEGY_NAME, WORKFLOW_HASH);
        uint256 destDomain = 1;

        bytes memory payload = abi.encode(
            block.chainid, // localDomain
            id,
            STRATEGY_NAME,
            WORKFLOW_HASH,
            address(this), // creator = msg.sender
            uint16(0), // apyTarget (default for 4-arg registerStrategy)
            uint8(0) // loopCount (default for 4-arg registerStrategy)
        );
        bytes32 expectedIntentId = keccak256(payload);

        vm.expectEmit(true, true, true, true, address(registry));
        emit StrategyRegistry.CrossChainMessage(
            destDomain,
            expectedIntentId,
            address(this),
            payload
        );
        registry.broadcastStrategy(id, destDomain);
    }

    function testBroadcastStrategyRevertsOnInvalidIdZero() public {
        vm.expectRevert(StrategyRegistry.InvalidStrategyId.selector);
        registry.broadcastStrategy(0, 1);
    }

    function testBroadcastStrategyRevertsOnInvalidIdAboveCount() public {
        registry.registerStrategy(STRATEGY_NAME, WORKFLOW_HASH);

        vm.expectRevert(StrategyRegistry.InvalidStrategyId.selector);
        registry.broadcastStrategy(5, 1);
    }

    function testReceiveCrossChainStrategy() public {
        uint256 sourceDomain = 1;
        uint256 sourceStrategyId = 42;
        address creator = makeAddr("remote-creator");

        vm.prank(owner);
        registry.receiveCrossChainStrategy(
            sourceDomain,
            sourceStrategyId,
            STRATEGY_NAME,
            WORKFLOW_HASH,
            creator,
            500,
            2
        );

        // Strategy ID 0 is used for cross-chain (starts at 0, then ++ in function)
        // Actually let me check: the function does:
        //   uint256 id = strategyCount;
        //   ++strategyCount;
        // So id = 0 for first cross-chain strategy, then strategyCount becomes 1

        (string memory name, bytes32 wfHash, address storedCreator, , bool active) = registry
            .getStrategyMeta(0);

        assertEq(name, STRATEGY_NAME);
        assertEq(wfHash, WORKFLOW_HASH);
        assertEq(storedCreator, creator);
        assertTrue(active);
        assertEq(registry.strategyCount(), 1);
    }

    function testReceiveCrossChainStrategyRevertsOnDuplicate() public {
        address creator = makeAddr("remote-creator");

        // Pre-register a local strategy to avoid the id=0 content hash edge case
        registry.registerStrategy("dummy", keccak256("dummy"));

        // Register a cross-chain strategy
        vm.prank(owner);
        registry.receiveCrossChainStrategy(1, 42, STRATEGY_NAME, WORKFLOW_HASH, creator, 500, 2);

        // Duplicate (same name, workflow, apyTarget, loopCount) should revert
        vm.prank(owner);
        vm.expectRevert(StrategyRegistry.StrategyAlreadyExists.selector);
        registry.receiveCrossChainStrategy(1, 43, STRATEGY_NAME, WORKFLOW_HASH, creator, 500, 2);
    }

    function testReceiveCrossChainStrategyRevertsOnNonOwner() public {
        vm.prank(user);
        vm.expectRevert(FheForgeBase.OnlyOwner.selector);
        registry.receiveCrossChainStrategy(1, 42, STRATEGY_NAME, WORKFLOW_HASH, user, 500, 2);
    }

    function testPauseBlocksRegisterStrategy() public {
        vm.prank(owner);
        registry.pause();

        vm.expectRevert();
        registry.registerStrategy(STRATEGY_NAME, WORKFLOW_HASH);
    }

    function testPauseBlocksSetActive() public {
        uint256 id = registry.registerStrategy(STRATEGY_NAME, WORKFLOW_HASH);

        vm.prank(owner);
        registry.pause();

        vm.expectRevert();
        registry.setActive(id, false);
    }

    function testUnpauseResumesRegisterStrategy() public {
        vm.prank(owner);
        registry.pause();

        vm.prank(owner);
        registry.unpause();

        uint256 id = registry.registerStrategy(STRATEGY_NAME, WORKFLOW_HASH);
        assertEq(id, 1);
    }

    function testOnlyOwnerSetVault() public {
        vm.prank(user);
        vm.expectRevert(FheForgeBase.OnlyOwner.selector);
        registry.setVault(vault);
    }

    function testOnlyOwnerProposeVault() public {
        vm.prank(user);
        vm.expectRevert(FheForgeBase.OnlyOwner.selector);
        registry.proposeVault(vault);
    }

    function testIncrementTvlViaVault() public {
        // Set vault first
        vm.prank(owner);
        registry.setVault(vault);

        // Create a strategy
        uint256 id = registry.registerStrategy(STRATEGY_NAME, WORKFLOW_HASH);

        // Vault calls incrementTvl
        euint128 amount = FHE.asEuint128(100 ether);
        ITaskManager(getTaskManagerAddress()).allow(
            uint256(euint128.unwrap(amount)),
            address(registry)
        );

        vm.prank(vault);
        registry.incrementTvl(id, amount);
    }

    function testIncrementTvlRevertsOnNonVault() public {
        uint256 id = registry.registerStrategy(STRATEGY_NAME, WORKFLOW_HASH);
        euint128 amount = FHE.asEuint128(100 ether);

        vm.prank(user);
        vm.expectRevert(StrategyRegistry.OnlyVault.selector);
        registry.incrementTvl(id, amount);
    }

    function testIncrementTvlRevertsOnInactiveStrategy() public {
        vm.prank(owner);
        registry.setVault(vault);

        uint256 id = registry.registerStrategy(STRATEGY_NAME, WORKFLOW_HASH);

        // Deactivate the strategy
        registry.setActive(id, false);

        euint128 amount = FHE.asEuint128(100 ether);

        vm.prank(vault);
        vm.expectRevert(StrategyRegistry.StrategyInactive.selector);
        registry.incrementTvl(id, amount);
    }

    function testDecrementTvlViaVault() public {
        vm.prank(owner);
        registry.setVault(vault);

        uint256 id = registry.registerStrategy(STRATEGY_NAME, WORKFLOW_HASH);

        euint128 amount = FHE.asEuint128(100 ether);
        ITaskManager(getTaskManagerAddress()).allow(
            uint256(euint128.unwrap(amount)),
            address(registry)
        );

        vm.prank(vault);
        registry.decrementTvl(id, amount);
    }

    function testDecrementTvlRevertsOnNonVault() public {
        uint256 id = registry.registerStrategy(STRATEGY_NAME, WORKFLOW_HASH);
        euint128 amount = FHE.asEuint128(100 ether);

        vm.prank(user);
        vm.expectRevert(StrategyRegistry.OnlyVault.selector);
        registry.decrementTvl(id, amount);
    }

    function testDecrementTvlRevertsOnInvalidStrategyId() public {
        vm.prank(owner);
        registry.setVault(vault);

        euint128 amount = FHE.asEuint128(100 ether);

        vm.prank(vault);
        vm.expectRevert(StrategyRegistry.InvalidStrategyId.selector);
        registry.decrementTvl(0, amount);
    }

    function testTransferOwnership() public {
        vm.prank(owner);
        registry.transferOwnership(user);

        vm.prank(user);
        registry.acceptOwnership();

        assertEq(registry.owner(), user);
    }
}
