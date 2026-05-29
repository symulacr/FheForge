// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { MockERC20 } from "../contracts/MockERC20.sol";
import { LendingPool } from "../contracts/LendingPool.sol";
import { FheForgeBase } from "../contracts/FheForgeBase.sol";
import { FheForgeTestHelper } from "./FheForgeTestHelper.sol";
import { FHE, euint128, InEuint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { MockTaskManager } from "../node_modules/@cofhe/mock-contracts/contracts/MockTaskManager.sol";
import { ITaskManager } from "@fhenixprotocol/cofhe-contracts/ICofhe.sol";

/// @custom:mock
contract FhePrivacyAttacksTest is FheForgeTestHelper {
    LendingPool public pool;
    MockERC20 public token;
    MockERC20 public debtToken;

    address public owner = makeAddr("owner");
    address public alice = makeAddr("alice");
    address public eve = makeAddr("eve");

    function setUp() public {
        _deployFheMocks();
        vm.startPrank(owner);
        pool = new LendingPool();
        token = new MockERC20("Collateral", "COL", 18);
        debtToken = new MockERC20("Debt", "DBT", 18);
        token.mint(alice, 1000 ether);
        debtToken.mint(eve, 1000 ether);
        vm.stopPrank();
    }

    // Helper: create InEuint128 handle usable by mock FHE
    function _handle(uint256 val) internal returns (InEuint128 memory) {
        euint128 enc = FHE.asEuint128(uint128(val));
        uint256 ctHash = uint256(euint128.unwrap(enc));
        // Register with mock task manager
        MockTaskManager(getTaskManagerAddress()).MOCK_setInEuintKey(ctHash | (6 << 8), val);
        ITaskManager(getTaskManagerAddress()).allow(ctHash, address(pool));
        return InEuint128({ ctHash: ctHash, securityZone: 0, utype: 6, signature: "" });
    }

    // ========== Test 1: Unauthorized requestLiquidityCheck reverts ==========
    function testUnauthorizedLiquidityCheckReverts() public {
        vm.prank(alice);
        token.approve(address(pool), 100 ether);
        vm.prank(alice);
        pool.shield(address(token), 10 ether, _handle(10 ether));

        // Eve should NOT be able to request liquidity check on Alice
        vm.prank(eve);
        vm.expectRevert();
        pool.requestLiquidityCheck(alice, address(token), address(debtToken));
    }

    // ========== Test 2: Self liquidity check succeeds ==========
    function testSelfLiquidityCheckSucceeds() public {
        vm.prank(alice);
        token.approve(address(pool), 100 ether);
        vm.prank(alice);
        pool.shield(address(token), 10 ether, _handle(10 ether));

        // Alice CAN request liquidity check on herself
        vm.prank(alice);
        pool.requestLiquidityCheck(alice, address(token), address(debtToken));
    }

    // ========== Test 3: Cooldown prevents rapid balance reveal ==========
    function testBalanceRevealCooldown() public {
        vm.prank(alice);
        token.approve(address(pool), 100 ether);
        vm.prank(alice);
        pool.shield(address(token), 10 ether, _handle(10 ether));

        // First reveal should succeed
        vm.prank(alice);
        pool.requestBalanceReveal(address(token));

        // Immediate second reveal should revert (cooldown active)
        vm.prank(alice);
        vm.expectRevert();
        pool.requestBalanceReveal(address(token));
    }
}
