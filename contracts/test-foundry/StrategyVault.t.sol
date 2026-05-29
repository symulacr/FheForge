// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { MockERC20 } from "../contracts/MockERC20.sol";
import { StrategyVault } from "../contracts/StrategyVault.sol";
import { FheForgeBase } from "../contracts/FheForgeBase.sol";
import { FheForgeTestHelper } from "./FheForgeTestHelper.sol";
import { FHE, euint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @custom:mock
contract StrategyVaultTest is FheForgeTestHelper {
    StrategyVault public vault;
    MockERC20 public token;

    address public owner = makeAddr("owner");
    address public user = makeAddr("user");
    address public otherUser = makeAddr("otherUser");
    address public composer = makeAddr("composer");
    address internal constant REGISTRY_MOCK = address(0x2);

    // Precomputed FHE handles to avoid external calls during argument evaluation
    // when using vm.prank / vm.expectRevert.
    euint128 internal encZero;
    euint128 internal encHundredEther;
    euint128 internal encFiftyEther;
    euint128 internal encTwoHundredEther;
    euint128 internal encFortyEther;

    function setUp() public {
        _deployFheMocks();

        vm.startPrank(owner);
        vault = new StrategyVault(REGISTRY_MOCK);
        token = new MockERC20("Collateral", "COL", 18);
        token.mint(composer, 1_000_000 ether);
        token.mint(otherUser, 1_000_000 ether);
        token.mint(address(this), 1_000_000 ether);
        vm.stopPrank();

        // Precompute FHE handles under composer identity — composer gets
        // transient ACL from createTask. We then grant persistent ACL to
        // the vault for each handle so vault can use them in FHE operations.
        vm.startPrank(composer);
        encZero = FHE.asEuint128(0);
        encHundredEther = FHE.asEuint128(100 ether);
        encFiftyEther = FHE.asEuint128(50 ether);
        encTwoHundredEther = FHE.asEuint128(200 ether);
        encFortyEther = FHE.asEuint128(40 ether);
        FHE.allow(encHundredEther, address(vault));
        FHE.allow(encFiftyEther, address(vault));
        FHE.allow(encTwoHundredEther, address(vault));
        FHE.allow(encFortyEther, address(vault));
        vm.stopPrank();
    }

    function testConstructorSetsParams() public view {
        assertEq(vault.owner(), owner);
        assertEq(vault.REGISTRY(), REGISTRY_MOCK);
    }

    function testConstructorRevertsOnZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(FheForgeBase.ZeroAddress.selector);
        new StrategyVault(address(0));
    }

    function testOpenPosition() public {
        uint256 depositAmount = 100 ether;

        vm.startPrank(composer);
        token.approve(address(vault), depositAmount);
        bytes32 posId = vault.openPosition(address(token), depositAmount, encHundredEther, 0, user);
        vm.stopPrank();

        assertTrue(posId != bytes32(0));
        assertEq(vault.getDepositedAmount(posId), depositAmount);
        assertEq(vault.positionOwner(posId), composer);

        (uint256 strategyId, uint256 createdAt) = vault.getPositionMeta(posId);
        assertEq(strategyId, 0);
        assertEq(createdAt, block.number);
    }

    function testOpenPositionZeroAmount() public {
        vm.prank(composer);
        vm.expectRevert(FheForgeBase.ZeroAmount.selector);
        vault.openPosition(address(token), 0, encZero, 0, user);
    }

    function testOpenPositionZeroAddress() public {
        vm.prank(composer);
        vm.expectRevert(FheForgeBase.ZeroAddress.selector);
        vault.openPosition(address(0), 100 ether, encHundredEther, 0, user);
    }

    function testOpenPositionRevertsWhenPaused() public {
        vm.prank(owner);
        vault.pause();

        vm.prank(composer);
        vm.expectRevert();
        vault.openPosition(address(token), 100 ether, encHundredEther, 0, user);
    }

    function testOpenPositionIncrementsNonce() public {
        vm.startPrank(composer);
        token.approve(address(vault), 200 ether);
        bytes32 pos1 = vault.openPosition(address(token), 100 ether, encHundredEther, 0, user);
        bytes32 pos2 = vault.openPosition(address(token), 100 ether, encHundredEther, 0, user);
        vm.stopPrank();

        assertTrue(pos1 != pos2);
    }

    function testOpenPositionWithStrategyId() public {
        vm.startPrank(composer);
        token.approve(address(vault), 100 ether);
        bytes32 posId = vault.openPosition(address(token), 100 ether, encHundredEther, 42, user);
        vm.stopPrank();

        (uint256 sid, ) = vault.getPositionMeta(posId);
        assertEq(sid, 42);
    }

    function testAddCollateral() public {
        vm.startPrank(composer);
        token.approve(address(vault), 150 ether);
        bytes32 posId = vault.openPosition(address(token), 100 ether, encHundredEther, 0, user);
        vault.addCollateral(posId, address(token), 50 ether, encFiftyEther, user);
        vm.stopPrank();

        assertEq(vault.getDepositedAmount(posId), 150 ether);
    }

    function testAddCollateralRevertsOnNonexistentPosition() public {
        vm.prank(composer);
        vm.expectRevert(StrategyVault.PositionNotFound.selector);
        vault.addCollateral(
            keccak256("nonexistent"),
            address(token),
            100 ether,
            encHundredEther,
            user
        );
    }

    function testAddCollateralRevertsOnZeroAmount() public {
        vm.startPrank(composer);
        token.approve(address(vault), 100 ether);
        bytes32 pid = vault.openPosition(address(token), 100 ether, encHundredEther, 0, user);
        vm.stopPrank();

        vm.prank(composer);
        vm.expectRevert(FheForgeBase.ZeroAmount.selector);
        vault.addCollateral(pid, address(token), 0, encZero, user);
    }

    function testAddCollateralRevertsOnTokenMismatch() public {
        vm.startPrank(composer);
        token.approve(address(vault), 100 ether);
        bytes32 posId = vault.openPosition(address(token), 100 ether, encHundredEther, 0, user);

        MockERC20 otherToken = new MockERC20("Other", "OTH", 18);
        vm.stopPrank(); // stop before expectRevert to avoid prank consumption on new

        vm.prank(composer);
        vm.expectRevert(FheForgeBase.TokenMismatch.selector);
        vault.addCollateral(posId, address(otherToken), 50 ether, encFiftyEther, user);
    }

    function testAddCollateralRevertsWhenPaused() public {
        vm.startPrank(composer);
        token.approve(address(vault), 100 ether);
        bytes32 pid = vault.openPosition(address(token), 100 ether, encHundredEther, 0, user);
        vm.stopPrank();

        vm.prank(owner);
        vault.pause();

        vm.prank(composer);
        vm.expectRevert();
        vault.addCollateral(pid, address(token), 50 ether, encFiftyEther, user);
    }

    function testClosePositionFullClose() public {
        vm.startPrank(composer);
        token.approve(address(vault), 100 ether);
        bytes32 posId = vault.openPosition(address(token), 100 ether, encHundredEther, 0, user);
        vm.stopPrank();

        vm.roll(block.number + 2);

        vm.startPrank(composer);
        vault.closePosition(posId, 100 ether, encHundredEther);
        vm.stopPrank();

        assertEq(vault.getDepositedAmount(posId), 0);
        bytes32[] memory userPositions = vault.getUserPositions(user);
        assertEq(userPositions.length, 0);
    }

    function testClosePositionPartialClose() public {
        vm.startPrank(composer);
        token.approve(address(vault), 100 ether);
        bytes32 posId = vault.openPosition(address(token), 100 ether, encHundredEther, 0, user);
        vm.stopPrank();

        vm.roll(block.number + 2);

        vm.startPrank(composer);
        vault.closePosition(posId, 40 ether, encFortyEther);
        vm.stopPrank();

        assertEq(vault.getDepositedAmount(posId), 60 ether);
        bytes32[] memory userPositions = vault.getUserPositions(user);
        assertEq(userPositions.length, 1);
        assertEq(userPositions[0], posId);
    }

    function testClosePositionRevertsOnNonexistent() public {
        vm.prank(composer);
        vm.expectRevert(StrategyVault.PositionNotFound.selector);
        vault.closePosition(keccak256("fake"), 100 ether, encHundredEther);
    }

    function testClosePositionRevertsOnZeroAmount() public {
        vm.startPrank(composer);
        token.approve(address(vault), 100 ether);
        bytes32 pid = vault.openPosition(address(token), 100 ether, encHundredEther, 0, user);
        vm.stopPrank();

        vm.roll(block.number + 2);

        vm.prank(composer);
        vm.expectRevert(FheForgeBase.ZeroAmount.selector);
        vault.closePosition(pid, 0, encZero);
    }

    function testClosePositionRevertsOnExceedsDeposit() public {
        vm.startPrank(composer);
        token.approve(address(vault), 100 ether);
        bytes32 posId = vault.openPosition(address(token), 100 ether, encHundredEther, 0, user);
        vm.stopPrank();

        vm.roll(block.number + 2);

        vm.prank(composer);
        vm.expectRevert(StrategyVault.ExceedsDeposit.selector);
        vault.closePosition(posId, 200 ether, encTwoHundredEther);
    }

    function testClosePositionRevertsOnSameBlock() public {
        vm.startPrank(composer);
        token.approve(address(vault), 100 ether);
        bytes32 posId = vault.openPosition(address(token), 100 ether, encHundredEther, 0, user);
        vm.stopPrank();

        vm.prank(composer);
        vm.expectRevert(StrategyVault.SameBlockClose.selector);
        vault.closePosition(posId, 100 ether, encHundredEther);
    }

    function testClosePositionRevertsOnWrongOwner() public {
        vm.startPrank(composer);
        token.approve(address(vault), 100 ether);
        bytes32 posId = vault.openPosition(address(token), 100 ether, encHundredEther, 0, user);
        vm.stopPrank();

        vm.roll(block.number + 2);

        vm.prank(otherUser);
        vm.expectRevert(
            abi.encodeWithSelector(
                StrategyVault.NotPositionOwner.selector,
                posId,
                otherUser,
                composer
            )
        );
        vault.closePosition(posId, 100 ether, encHundredEther);
    }

    function testClosePositionRevertsWhenPaused() public {
        vm.startPrank(composer);
        token.approve(address(vault), 100 ether);
        bytes32 pid = vault.openPosition(address(token), 100 ether, encHundredEther, 0, user);
        vm.stopPrank();

        vm.prank(owner);
        vault.pause();

        vm.roll(block.number + 2);

        vm.prank(composer);
        vm.expectRevert();
        vault.closePosition(pid, 100 ether, encHundredEther);
    }

    function testClosePositionTransfersTokensBack() public {
        vm.startPrank(composer);
        token.approve(address(vault), 100 ether);
        bytes32 posId = vault.openPosition(address(token), 100 ether, encHundredEther, 0, user);
        vm.stopPrank();

        vm.roll(block.number + 2);

        uint256 balanceBefore = token.balanceOf(composer);
        vm.startPrank(composer);
        vault.closePosition(posId, 100 ether, encHundredEther);
        vm.stopPrank();

        assertEq(token.balanceOf(composer), balanceBefore + 100 ether);
    }

    function testWithdrawPaused() public {
        vm.startPrank(composer);
        token.approve(address(vault), 100 ether);
        bytes32 posId = vault.openPosition(address(token), 100 ether, encHundredEther, 0, user);
        vm.stopPrank();

        vm.prank(owner);
        vault.pause();

        uint256 balanceBefore = token.balanceOf(composer);
        vm.startPrank(composer);
        vault.withdrawPaused(posId);
        vm.stopPrank();

        assertEq(token.balanceOf(composer), balanceBefore + 100 ether);
    }

    function testWithdrawPausedRevertsOnNonExistent() public {
        vm.prank(owner);
        vault.pause();

        vm.prank(user);
        vm.expectRevert(StrategyVault.PositionNotFound.selector);
        vault.withdrawPaused(keccak256("fake"));
    }

    function testWithdrawPausedRevertsWhenNotPaused() public {
        vm.startPrank(composer);
        token.approve(address(vault), 100 ether);
        bytes32 posId = vault.openPosition(address(token), 100 ether, encHundredEther, 0, user);
        vm.stopPrank();

        vm.prank(composer);
        vm.expectRevert();
        vault.withdrawPaused(posId);
    }

    function testGetCollateral() public {
        vm.startPrank(composer);
        token.approve(address(vault), 100 ether);
        bytes32 posId = vault.openPosition(address(token), 100 ether, encHundredEther, 0, user);
        vm.stopPrank();

        vm.prank(user);
        vault.getCollateral(posId);
    }

    function testGetCollateralRevertsOnNonExistent() public {
        vm.prank(user);
        vm.expectRevert(StrategyVault.PositionNotFound.selector);
        vault.getCollateral(keccak256("fake"));
    }

    function testGetPositionMetaRevertsOnNonExistent() public {
        vm.expectRevert(StrategyVault.PositionNotFound.selector);
        vault.getPositionMeta(keccak256("fake"));
    }

    function testGetUserPositions() public {
        vm.startPrank(composer);
        token.approve(address(vault), 300 ether);
        vault.openPosition(address(token), 100 ether, encHundredEther, 0, user);
        vault.openPosition(address(token), 100 ether, encHundredEther, 0, user);
        vault.openPosition(address(token), 100 ether, encHundredEther, 0, user);
        vm.stopPrank();

        bytes32[] memory positions = vault.getUserPositions(user);
        assertEq(positions.length, 3);
    }

    function testGetUserPositionsEmpty() public view {
        bytes32[] memory positions = vault.getUserPositions(user);
        assertEq(positions.length, 0);
    }

    function testGetDepositedAmountZeroForNonExistent() public view {
        assertEq(vault.getDepositedAmount(keccak256("fake")), 0);
    }

    function testTransferOwnership() public {
        vm.prank(owner);
        vault.transferOwnership(otherUser);

        vm.prank(otherUser);
        vault.acceptOwnership();

        assertEq(vault.owner(), otherUser);
    }

    function testOnlyOwnerPause() public {
        vm.prank(user);
        vm.expectRevert();
        vault.pause();
    }

    function testFullLifecycle() public {
        vm.startPrank(composer);
        token.approve(address(vault), 100 ether);
        bytes32 posId = vault.openPosition(address(token), 100 ether, encHundredEther, 0, user);
        vm.stopPrank();

        assertEq(vault.getDepositedAmount(posId), 100 ether);

        bytes32[] memory positions = vault.getUserPositions(user);
        assertEq(positions.length, 1);

        (uint256 sid, uint256 createdAt) = vault.getPositionMeta(posId);
        assertEq(sid, 0);
        assertEq(createdAt, block.number);

        vm.roll(block.number + 2);
        vm.startPrank(composer);
        vault.closePosition(posId, 100 ether, encHundredEther);
        vm.stopPrank();

        assertEq(vault.getDepositedAmount(posId), 0);
    }

    function testFuzzOpenPosition(uint256 amount) public {
        amount = bound(amount, 1, 100_000 ether);
        vm.startPrank(composer);
        token.approve(address(vault), amount);
        euint128 handle = FHE.asEuint128(amount);
        FHE.allow(handle, address(vault));
        bytes32 posId = vault.openPosition(address(token), amount, handle, 0, user);
        vm.stopPrank();

        assertEq(vault.getDepositedAmount(posId), amount);
    }

    function testFuzzAddCollateral(uint256 initial, uint256 extra) public {
        initial = bound(initial, 1, 100_000 ether);
        extra = bound(extra, 1, 100_000 ether);
        vm.startPrank(composer);
        token.approve(address(vault), initial + extra);
        euint128 initHandle = FHE.asEuint128(initial);
        euint128 extraHandle = FHE.asEuint128(extra);
        FHE.allow(initHandle, address(vault));
        FHE.allow(extraHandle, address(vault));
        bytes32 posId = vault.openPosition(address(token), initial, initHandle, 0, user);
        vault.addCollateral(posId, address(token), extra, extraHandle, user);
        vm.stopPrank();

        assertEq(vault.getDepositedAmount(posId), initial + extra);
    }
}
