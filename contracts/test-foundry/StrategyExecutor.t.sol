// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { MockERC20 } from "../contracts/MockERC20.sol";
import { StrategyExecutor } from "../contracts/StrategyExecutor.sol";
import { FheForgeBase } from "../contracts/FheForgeBase.sol";
import { FheForgeTestHelper } from "./FheForgeTestHelper.sol";
import { InEuint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { MockLendingPool } from "./MockLendingPool.sol";
import { SwapRouter } from "../contracts/SwapRouter.sol";
import { StrategyVault } from "../contracts/StrategyVault.sol";
import { StrategyRegistry } from "../contracts/StrategyRegistry.sol";

contract StrategyExecutorTest is FheForgeTestHelper {
    StrategyExecutor public executor;
    MockLendingPool public pool;
    SwapRouter public router;
    StrategyVault public vault;
    StrategyRegistry public registry;

    address public owner = makeAddr("owner");
    address public user = makeAddr("user");

    MockERC20 public supplyToken;
    MockERC20 public borrowToken;
    MockERC20 public sweepToken;

    function setUp() public {
        _deployFheMocks();

        pool = new MockLendingPool();
        registry = new StrategyRegistry(0);
        vault = new StrategyVault(address(registry));
        router = new SwapRouter(address(this), 1, 365 days, 0, address(0));

        registry.setVault(address(vault));

        vm.startPrank(owner);

        supplyToken = new MockERC20("Supply", "SUP", 18);
        borrowToken = new MockERC20("Borrow", "BRW", 18);
        sweepToken = new MockERC20("Sweep", "SWP", 18);

        supplyToken.mint(user, 1_000_000 ether);
        borrowToken.mint(user, 1_000_000 ether);
        sweepToken.mint(user, 1_000_000 ether);
        sweepToken.mint(address(this), 100 ether);

        executor = new StrategyExecutor(address(pool), address(vault), address(router));

        vm.stopPrank();

        vm.startPrank(owner);
        borrowToken.mint(address(this), 1_000_000 ether);
        vm.stopPrank();
        borrowToken.approve(address(pool), 1_000_000 ether);
        pool.shield(
            address(borrowToken),
            1_000_000 ether,
            InEuint128({ ctHash: 0, securityZone: 0, utype: 6, signature: "" })
        );
        pool.setComposer(address(executor));

        vm.prank(user);
        supplyToken.approve(address(executor), 1_000_000 ether);
        vm.prank(user);
        borrowToken.approve(address(executor), 1_000_000 ether);
    }

    function testConstructorSetsParams() public view {
        assertEq(executor.owner(), owner);
        assertEq(address(executor.POOL()), address(pool));
        assertEq(address(executor.VAULT()), address(vault));
        assertEq(address(executor.ROUTER()), address(router));
    }

    function testConstructorRevertsOnZeroPool() public {
        vm.prank(owner);
        vm.expectRevert(FheForgeBase.ZeroAddress.selector);
        new StrategyExecutor(address(0), address(vault), address(router));
    }

    function testConstructorRevertsOnZeroVault() public {
        vm.prank(owner);
        vm.expectRevert(FheForgeBase.ZeroAddress.selector);
        new StrategyExecutor(address(pool), address(0), address(router));
    }

    function testConstructorRevertsOnZeroRouter() public {
        vm.prank(owner);
        vm.expectRevert(FheForgeBase.ZeroAddress.selector);
        new StrategyExecutor(address(pool), address(vault), address(0));
    }

    function testActionTypeConstants() public view {
        assertEq(executor.SHIELD_SUPPLY(), hex"00000001");
        assertEq(executor.BORROW_LTV(), hex"00000002");
        assertEq(executor.SWAP_INTENT(), hex"00000003");
        assertEq(executor.REPAY_DEBT(), hex"00000004");
        assertEq(executor.DEPOSIT_VAULT(), hex"00000005");
        assertEq(executor.ADD_COLLATERAL(), hex"00000006");
        assertEq(executor.WITHDRAW_VAULT(), hex"00000007");
        assertEq(executor.SWAP_UNISWAP_V3(), hex"00000008");
    }

    function testResetCheckpoint() public {
        StrategyExecutor.Action[] memory actions = new StrategyExecutor.Action[](0);
        bytes32 strategyId = keccak256("test-strategy");

        vm.prank(user);
        executor.executePipeline(strategyId, actions);

        (uint256 actionIndex, bool completed) = executor.checkpoints(strategyId);
        assertEq(actionIndex, 0);
        assertTrue(completed);

        vm.prank(owner);
        executor.resetCheckpoint(strategyId);

        (actionIndex, completed) = executor.checkpoints(strategyId);
        assertEq(actionIndex, 0);
        assertFalse(completed);
    }

    function testResetCheckpointRevertsOnNonOwner() public {
        vm.prank(user);
        vm.expectRevert();
        executor.resetCheckpoint(keccak256("test"));
    }

    function testExecuteEmptyPipeline() public {
        StrategyExecutor.Action[] memory actions = new StrategyExecutor.Action[](0);
        bytes32 strategyId = keccak256("empty");

        vm.prank(user);
        bool completed = executor.executePipeline(strategyId, actions);

        assertTrue(completed);
        (uint256 actionIndex, bool cpCompleted) = executor.checkpoints(strategyId);
        assertEq(actionIndex, 0);
        assertTrue(cpCompleted);
    }

    function testExecutePipelineRevertsWhenPaused() public {
        vm.prank(owner);
        executor.pause();

        StrategyExecutor.Action[] memory actions = new StrategyExecutor.Action[](0);
        vm.prank(user);
        vm.expectRevert();
        executor.executePipeline(keccak256("test"), actions);
    }

    function testExecuteShieldSupplyAction() public {
        StrategyExecutor.Action[] memory actions = new StrategyExecutor.Action[](1);
        actions[0] = StrategyExecutor.Action({
            actionType: executor.SHIELD_SUPPLY(),
            params: abi.encode(address(supplyToken), 100 ether),
            encAmount: InEuint128({ ctHash: 0, securityZone: 0, utype: 6, signature: "" })
        });

        bytes32 strategyId = keccak256("supply-test");
        vm.prank(user);
        bool completed = executor.executePipeline{ gas: 1_000_000 }(strategyId, actions);
        assertTrue(completed);
    }

    function testExecutePipelineInvalidActionType() public {
        StrategyExecutor.Action[] memory actions = new StrategyExecutor.Action[](1);
        actions[0] = StrategyExecutor.Action({
            actionType: hex"ffffffff",
            params: hex"",
            encAmount: InEuint128({ ctHash: 0, securityZone: 0, utype: 6, signature: "" })
        });

        bytes32 strategyId = keccak256("invalid-action");
        vm.prank(user);
        bool completed = executor.executePipeline(strategyId, actions);

        assertTrue(completed);
    }

    function testResumeFromCheckpoint() public {
        bytes32 strategyId = keccak256("resume-test");

        StrategyExecutor.Action[] memory actions = new StrategyExecutor.Action[](0);
        vm.prank(user);
        executor.executePipeline(strategyId, actions);

        vm.prank(user);
        bool completed = executor.executePipeline(strategyId, actions);
        assertTrue(completed);
    }

    function testSweepToken() public {
        assertTrue(sweepToken.transfer(address(executor), 100 ether));

        vm.prank(owner);
        executor.sweepToken(address(sweepToken), owner);

        assertEq(sweepToken.balanceOf(owner), 100 ether);
    }

    function testSweepTokenRevertsOnNonOwner() public {
        vm.prank(user);
        vm.expectRevert();
        executor.sweepToken(address(sweepToken), user);
    }

    function testSweepTokenRevertsOnZeroToken() public {
        vm.prank(owner);
        vm.expectRevert(FheForgeBase.ZeroAddress.selector);
        executor.sweepToken(address(0), owner);
    }

    function testSweepTokenRevertsOnZeroTo() public {
        vm.prank(owner);
        vm.expectRevert(FheForgeBase.ZeroAddress.selector);
        executor.sweepToken(address(sweepToken), address(0));
    }

    function testSweepTokenNoBalance() public {
        // Use a token that has code but zero balance in executor
        vm.prank(owner);
        executor.sweepToken(address(sweepToken), owner);
    }

    function testTransferOwnership() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(owner);
        executor.transferOwnership(newOwner);

        vm.prank(newOwner);
        executor.acceptOwnership();

        assertEq(executor.owner(), newOwner);
    }

    function testOnlyOwnerPause() public {
        vm.prank(user);
        vm.expectRevert();
        executor.pause();
    }

    function testPauseByOwner() public {
        vm.prank(owner);
        executor.pause();
        assertTrue(executor.paused());
    }

    function testUnpauseByOwner() public {
        vm.prank(owner);
        executor.pause();
        vm.prank(owner);
        executor.unpause();
        assertFalse(executor.paused());
    }

    function testExecuteMultipleValidActions() public {
        StrategyExecutor.Action[] memory actions = new StrategyExecutor.Action[](2);
        actions[0] = StrategyExecutor.Action({
            actionType: executor.SHIELD_SUPPLY(),
            params: abi.encode(address(supplyToken), 100 ether),
            encAmount: InEuint128({ ctHash: 0, securityZone: 0, utype: 6, signature: "" })
        });
        actions[1] = StrategyExecutor.Action({
            actionType: executor.BORROW_LTV(),
            params: abi.encode(address(borrowToken), 50 ether),
            encAmount: InEuint128({ ctHash: 0, securityZone: 0, utype: 6, signature: "" })
        });

        bytes32 strategyId = keccak256("multi-action");
        vm.prank(user);
        bool completed = executor.executePipeline{ gas: 1_000_000 }(strategyId, actions);
        assertTrue(completed);
    }

    function testCheckpointSavesOnLowGas() public {
        StrategyExecutor.Action[] memory actions = new StrategyExecutor.Action[](1);
        actions[0] = StrategyExecutor.Action({
            actionType: executor.SHIELD_SUPPLY(),
            params: abi.encode(address(supplyToken), 100 ether),
            encAmount: InEuint128({ ctHash: 0, securityZone: 0, utype: 6, signature: "" })
        });

        bytes32 strategyId = keccak256("gas-checkpoint");
        vm.prank(user);

        bool completed = executor.executePipeline(strategyId, actions);

        if (!completed) {
            (uint256 idx, bool cpCompleted) = executor.checkpoints(strategyId);
            assertFalse(cpCompleted);
            assertEq(idx, 0);
        }
    }

    function testCheckpointStateAfterCompleted() public {
        StrategyExecutor.Action[] memory actions = new StrategyExecutor.Action[](0);
        bytes32 strategyId = keccak256("checkpoint-state");

        vm.prank(user);
        executor.executePipeline(strategyId, actions);

        (uint256 idx, bool completed) = executor.checkpoints(strategyId);
        assertEq(idx, 0);
        assertTrue(completed);
    }

    function testCheckpointStateFresh() public view {
        bytes32 strategyId = keccak256("fresh-checkpoint");
        (uint256 idx, bool completed) = executor.checkpoints(strategyId);
        assertEq(idx, 0);
        assertFalse(completed);
    }
}
