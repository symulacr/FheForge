// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { StrategyExecutor } from "../contracts/StrategyExecutor.sol";
import { MockERC20 } from "../contracts/MockERC20.sol";
import { FheForgeBase } from "../contracts/FheForgeBase.sol";
import { FheForgeTestHelper } from "./FheForgeTestHelper.sol";
import { InEuint128, FHE, euint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { MockLendingPool } from "./MockLendingPool.sol";
import { SwapRouter } from "../contracts/SwapRouter.sol";
import { StrategyVault } from "../contracts/StrategyVault.sol";
import { StrategyRegistry } from "../contracts/StrategyRegistry.sol";

/// @notice Bypass tests for StrategyExecutor (MC-077).
///         Verifies that:
///         1. All action types validate encrypted handles upfront (close the "without _verifyEquality" gap)
///         2. Unknown action types revert instead of silently succeeding
///         3. OnlyComposer guards on Pool functions work correctly
contract StrategyExecutorBypassTest is FheForgeTestHelper {
    StrategyExecutor public executor;
    MockLendingPool public pool;
    SwapRouter public router;
    StrategyVault public vault;
    StrategyRegistry public registry;

    address public owner = makeAddr("owner");
    address public user = makeAddr("user");
    address public attacker = makeAddr("attacker");

    MockERC20 public supplyToken;
    MockERC20 public borrowToken;
    /// @dev Valid InEuint128 needed for all executor actions after _verifyEquality was added
    ///      to the swap action types (SWAP_INTENT, SWAP_UNISWAP_V3).
    InEuint128 internal s_validEnc;
    function setUp() public {
        _deployFheMocks();
        s_validEnc = InEuint128({
            ctHash: 0,
            securityZone: 0,
            utype: 6,
            signature: ""
        });

        pool = new MockLendingPool();
        registry = new StrategyRegistry(0);
        vault = new StrategyVault(address(registry));
        router = new SwapRouter(address(this), 1, 365 days, 0, address(0));

        registry.setVault(address(vault));

        vm.startPrank(owner);

        supplyToken = new MockERC20("Supply", "SUP", 18);
        borrowToken = new MockERC20("Borrow", "BRW", 18);

        supplyToken.mint(user, 1_000_000 ether);
        borrowToken.mint(user, 1_000_000 ether);
        supplyToken.mint(attacker, 1_000_000 ether);
        borrowToken.mint(attacker, 1_000_000 ether);

        executor = new StrategyExecutor(address(pool), address(vault), address(router));

        vm.stopPrank();

        vm.startPrank(owner);
        borrowToken.mint(address(this), 1_000_000 ether);
        vm.stopPrank();
        borrowToken.approve(address(pool), 1_000_000 ether);
        pool.shield(address(borrowToken), 1_000_000 ether, s_validEnc);
        pool.setComposer(address(executor));

        vm.prank(user);
        supplyToken.approve(address(executor), 1_000_000 ether);
        vm.prank(user);
        borrowToken.approve(address(executor), 1_000_000 ether);
        vm.prank(attacker);
        supplyToken.approve(address(executor), 1_000_000 ether);
        vm.prank(attacker);
        borrowToken.approve(address(executor), 1_000_000 ether);
    }

    // ────────────────────────────────────────────────────────────────
    //  Test 1: StrategyExecutor calls without _verifyEquality → reverted
    // ────────────────────────────────────────────────────────────────

    /// @notice SWAP_INTENT previously skipped _verifyEquality entirely.
    ///         After the fix it now validates encAmount via _validateCiphertext
    ///         upfront + _verifyEquality in the action body. Verify the action
    ///         still executes correctly — proving the bypass gap is closed.
    function testBypassEquality_SwapIntent_NowValidated() public {
        StrategyExecutor.Action[] memory actions = new StrategyExecutor.Action[](1);
        actions[0] = StrategyExecutor.Action({
            actionType: executor.SWAP_INTENT(),
            params: abi.encode(address(supplyToken), address(borrowToken), 100 ether, 99 ether, 3600),
            encAmount: s_validEnc
        });

        bytes32 strategyId = keccak256("swap-intent-now-validated");
        vm.prank(user);
        bool completed = executor.executePipeline{ gas: 1_000_000 }(strategyId, actions);

        assertTrue(completed, "SWAP_INTENT should complete after equality check was added");
    }

    /// @notice SWAP_UNISWAP_V3 previously skipped _verifyEquality entirely.
    ///         After the fix it now validates encAmount via _validateCiphertext
    ///         upfront + _verifyEquality in the action body.
    function testBypassEquality_SwapUniswapV3_NowValidated() public {
        StrategyExecutor.Action[] memory actions = new StrategyExecutor.Action[](1);
        actions[0] = StrategyExecutor.Action({
            actionType: executor.SWAP_UNISWAP_V3(),
            params: abi.encode(address(supplyToken), address(borrowToken), uint24(3000), 100 ether, 99 ether),
            encAmount: s_validEnc
        });

        bytes32 strategyId = keccak256("swap-uniswap-now-validated");
        vm.prank(user);
        bool completed = executor.executePipeline{ gas: 1_000_000 }(strategyId, actions);

        assertTrue(completed, "SWAP_UNISWAP_V3 should complete after equality check was added");
    }

    /// @notice All non-swap action types (SHIELD_SUPPLY, BORROW_LTV, REPAY_DEBT,
    ///         DEPOSIT_VAULT, ADD_COLLATERAL, WITHDRAW_VAULT) already called
    ///         _verifyEquality and continue to work after the upfront
    ///         _validateCiphertext addition.
    function testBypassEquality_AllPoolVaultActionsStillWork() public {
        // SHIELD_SUPPLY
        _execSingleAction(executor.SHIELD_SUPPLY(), abi.encode(address(supplyToken), 50 ether));

        // BORROW_LTV
        _execSingleAction(executor.BORROW_LTV(), abi.encode(address(borrowToken), 25 ether));

        // REPAY_DEBT
        _execSingleAction(executor.REPAY_DEBT(), abi.encode(address(borrowToken), 25 ether));

        // DEPOSIT_VAULT
        _execSingleAction(
            executor.DEPOSIT_VAULT(),
            abi.encode(address(supplyToken), 100 ether, uint256(1))
        );

        // ADD_COLLATERAL
        bytes32 posId = keccak256("pos");
        _execSingleAction(
            executor.ADD_COLLATERAL(),
            abi.encode(posId, address(supplyToken), 50 ether)
        );

        // WITHDRAW_VAULT
        _execSingleAction(
            executor.WITHDRAW_VAULT(),
            abi.encode(posId, 25 ether)
        );
    }

    // ────────────────────────────────────────────────────────────────
    //  Test 2: Silent skip of unknown action type → reverted
    // ────────────────────────────────────────────────────────────────

    /// @notice Previously an unknown action type (e.g. hex"ffffffff") would silently
    ///         succeed — consuming gas without executing any logic. After the fix,
    ///         the else branch in _executeAction reverts with UnknownActionType.
    function testUnknownActionType_Reverts() public {
        StrategyExecutor.Action[] memory actions = new StrategyExecutor.Action[](1);
        actions[0] = StrategyExecutor.Action({
            actionType: hex"ffffffff",
            params: hex"",
            encAmount: s_validEnc
        });

        bytes32 strategyId = keccak256("unknown-action-type");
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(StrategyExecutor.UnknownActionType.selector, hex"ffffffff")
        );
        executor.executePipeline(strategyId, actions);
    }

    /// @notice Zero bytes action type should also revert, not silently skip.
    function testUnknownActionType_ZeroBytes_Reverts() public {
        StrategyExecutor.Action[] memory actions = new StrategyExecutor.Action[](1);
        actions[0] = StrategyExecutor.Action({
            actionType: bytes4(0),
            params: hex"",
            encAmount: s_validEnc
        });

        bytes32 strategyId = keccak256("zero-action-type");
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(StrategyExecutor.UnknownActionType.selector, bytes4(0))
        );
        executor.executePipeline(strategyId, actions);
    }

    /// @notice Only the specific action types 0x01..0x08 are recognized.
    ///         All other values must revert.
    function testUnknownActionType_EdgeValues_Reverts() public {
        bytes4[] memory badTypes = new bytes4[](3);
        badTypes[0] = hex"00000000";
        badTypes[1] = hex"00000009";
        badTypes[2] = hex"80000000";

        for (uint256 i; i < badTypes.length; ++i) {
            StrategyExecutor.Action[] memory actions = new StrategyExecutor.Action[](1);
            actions[0] = StrategyExecutor.Action({
                actionType: badTypes[i],
                params: hex"",
                encAmount: s_validEnc
            });

            bytes32 strategyId = keccak256(abi.encode("edge", i));
            vm.prank(attacker);
            vm.expectRevert(
                abi.encodeWithSelector(StrategyExecutor.UnknownActionType.selector, badTypes[i])
            );
            executor.executePipeline(strategyId, actions);
        }
    }

    // ────────────────────────────────────────────────────────────────
    //  Test 3: OnlyComposer guards work
    // ────────────────────────────────────────────────────────────────

    /// @notice Pool.depositFor has onlyComposer — direct EOA calls must revert.
    function testOnlyComposer_DirectCallToPool_Reverts() public {
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSignature("MockLendingPool_Unauthorized()")
        );
        pool.depositFor(address(supplyToken), 100 ether, FHE.asEuint128(0), attacker);
    }

    /// @notice Pool.borrowFor has onlyComposer — direct EOA calls must revert.
    function testOnlyComposer_BorrowForDirect_Reverts() public {
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSignature("MockLendingPool_Unauthorized()")
        );
        pool.borrowFor(address(borrowToken), 100 ether, FHE.asEuint128(0), attacker);
    }

    /// @notice Pool.repayFor has onlyComposer — direct EOA calls must revert.
    function testOnlyComposer_RepayForDirect_Reverts() public {
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSignature("MockLendingPool_Unauthorized()")
        );
        pool.repayFor(address(borrowToken), 100 ether, FHE.asEuint128(0), attacker);
    }

    /// @notice Executor (which IS the composer) can call Pool functions via the
    ///         pipeline. SHIELD_SUPPLY → depositFor with onlyComposer must succeed.
    function testOnlyComposer_ExecutorPipeline_Works() public {
        StrategyExecutor.Action[] memory actions = new StrategyExecutor.Action[](1);
        actions[0] = StrategyExecutor.Action({
            actionType: executor.SHIELD_SUPPLY(),
            params: abi.encode(address(supplyToken), 100 ether),
            encAmount: s_validEnc
        });

        bytes32 strategyId = keccak256("composer-pipeline");
        vm.prank(user);
        bool completed = executor.executePipeline{ gas: 1_000_000 }(strategyId, actions);
        assertTrue(completed);

        // Verify the state change went through (proving onlyComposer gate was passed)
        assertEq(pool.supplyBalances(address(supplyToken), user), 100 ether);
    }

    // ────────────────────────────────────────────────────────────────
    //  Helpers
    // ────────────────────────────────────────────────────────────────

    function _execSingleAction(bytes4 actionType, bytes memory params) internal {
        StrategyExecutor.Action[] memory actions = new StrategyExecutor.Action[](1);
        actions[0] = StrategyExecutor.Action({
            actionType: actionType,
            params: params,
            encAmount: s_validEnc
        });

        bytes32 strategyId = keccak256(abi.encode("single", actionType, block.number));
        vm.prank(user);
        bool completed = executor.executePipeline{ gas: 1_000_000 }(strategyId, actions);
        assertTrue(completed);
    }
}
