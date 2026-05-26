// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { TokenRegistry } from "../contracts/TokenRegistry.sol";
import { FheForgeBase } from "../contracts/FheForgeBase.sol";
import { FheForgeTestHelper } from "./FheForgeTestHelper.sol";

contract TokenRegistryTest is FheForgeTestHelper {
    TokenRegistry public tokenRegistry;

    address public owner = makeAddr("owner");
    address public user = makeAddr("user");

    address public constant TOKEN_A = address(0x100);
    address public constant TOKEN_B = address(0x200);
    address public constant TOKEN_C = address(0x300);
    bytes32 public constant PRICE_ID_A = keccak256("TOKEN_A/USD");
    bytes32 public constant PRICE_ID_B = keccak256("TOKEN_B/USD");

    function setUp() public {
        _deployFheMocks();
        vm.prank(owner);
        tokenRegistry = new TokenRegistry();
    }

    function testConstructorSetsOwner() public view {
        assertEq(tokenRegistry.owner(), owner);
    }

    function testConstructorTokenCountZero() public view {
        assertEq(tokenRegistry.getTokenCount(), 0);
    }

    function _makeTokenInfo(
        address token,
        bytes32 priceId,
        uint8 decimals,
        bool isLendable,
        bool isBorrowable,
        bool isCollateral
    ) internal pure returns (TokenRegistry.TokenInfo memory info) {
        return
            TokenRegistry.TokenInfo({
                token: token,
                pythPriceId: priceId,
                decimals: decimals,
                isLendable: isLendable,
                isBorrowable: isBorrowable,
                isCollateral: isCollateral,
                ltvBps: 7500,
                liquidationBonusBps: 500,
                borrowCap: 1_000_000 ether,
                supplyCap: 2_000_000 ether,
                enabled: true
            });
    }

    function testRegisterToken() public {
        vm.prank(owner);
        tokenRegistry.registerToken(_makeTokenInfo(TOKEN_A, PRICE_ID_A, 18, true, true, true));

        assertEq(tokenRegistry.getTokenCount(), 1);
        assertTrue(tokenRegistry.isTokenEnabled(TOKEN_A));
    }

    function testRegisterTokenStoresInfo() public {
        vm.prank(owner);
        tokenRegistry.registerToken(_makeTokenInfo(TOKEN_A, PRICE_ID_A, 6, true, false, true));

        (
            address token,
            uint16 ltvBps,
            uint16 liqBonus,
            uint8 decimals,
            bool isLendable,
            bool isBorrowable,
            bool isCollateral,
            bool enabled,
            bytes32 priceId,
            uint256 borrowCap,
            uint256 supplyCap
        ) = tokenRegistry.tokens(TOKEN_A);

        assertEq(token, TOKEN_A);
        assertEq(ltvBps, 7500);
        assertEq(liqBonus, 500);
        assertEq(decimals, 6);
        assertTrue(isLendable);
        assertFalse(isBorrowable);
        assertTrue(isCollateral);
        assertTrue(enabled);
        assertEq(priceId, PRICE_ID_A);
        assertEq(borrowCap, 1_000_000 ether);
        assertEq(supplyCap, 2_000_000 ether);
    }

    function testRegisterTokenRevertsOnZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(FheForgeBase.ZeroAddress.selector);
        tokenRegistry.registerToken(_makeTokenInfo(address(0), PRICE_ID_A, 18, true, true, true));
    }

    function testRegisterTokenRevertsOnNonOwner() public {
        vm.prank(user);
        vm.expectRevert(FheForgeBase.OnlyOwner.selector);
        tokenRegistry.registerToken(_makeTokenInfo(TOKEN_A, PRICE_ID_A, 18, true, true, true));
    }

    function testRegisterDuplicateTokenDoesNotDuplicateList() public {
        vm.startPrank(owner);
        tokenRegistry.registerToken(_makeTokenInfo(TOKEN_A, PRICE_ID_A, 18, true, true, true));
        tokenRegistry.registerToken(_makeTokenInfo(TOKEN_A, PRICE_ID_B, 18, false, false, false));
        vm.stopPrank();

        assertEq(tokenRegistry.getTokenCount(), 1);
    }

    function testRegisterMultipleTokens() public {
        vm.startPrank(owner);
        tokenRegistry.registerToken(_makeTokenInfo(TOKEN_A, PRICE_ID_A, 18, true, true, true));
        tokenRegistry.registerToken(_makeTokenInfo(TOKEN_B, PRICE_ID_B, 6, false, true, false));
        vm.stopPrank();

        assertEq(tokenRegistry.getTokenCount(), 2);
    }

    function testUpdateTokenConfig() public {
        vm.prank(owner);
        tokenRegistry.registerToken(_makeTokenInfo(TOKEN_A, PRICE_ID_A, 18, true, true, true));

        TokenRegistry.TokenInfo memory updatedInfo = _makeTokenInfo(
            TOKEN_A,
            PRICE_ID_A,
            18,
            false,
            false,
            false
        );

        vm.prank(owner);
        tokenRegistry.updateTokenConfig(TOKEN_A, updatedInfo);

        (
            ,
            ,
            ,
            ,
            bool isLendable,
            bool isBorrowable,
            bool isCollateral,
            bool enabled,
            ,
            ,

        ) = tokenRegistry.tokens(TOKEN_A);

        assertFalse(isLendable);
        assertFalse(isBorrowable);
        assertFalse(isCollateral);
        assertTrue(enabled);
    }

    function testUpdateTokenConfigRevertsOnZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(FheForgeBase.ZeroAddress.selector);
        tokenRegistry.updateTokenConfig(
            address(0),
            _makeTokenInfo(address(0), PRICE_ID_A, 18, true, true, true)
        );
    }

    function testUpdateTokenConfigRevertsOnNonOwner() public {
        vm.prank(owner);
        tokenRegistry.registerToken(_makeTokenInfo(TOKEN_A, PRICE_ID_A, 18, true, true, true));

        vm.prank(user);
        vm.expectRevert(FheForgeBase.OnlyOwner.selector);
        tokenRegistry.updateTokenConfig(
            TOKEN_A,
            _makeTokenInfo(TOKEN_A, PRICE_ID_A, 18, false, false, false)
        );
    }

    function testDisableToken() public {
        vm.prank(owner);
        tokenRegistry.registerToken(_makeTokenInfo(TOKEN_A, PRICE_ID_A, 18, true, true, true));

        assertTrue(tokenRegistry.isTokenEnabled(TOKEN_A));

        vm.prank(owner);
        tokenRegistry.disableToken(TOKEN_A);

        assertFalse(tokenRegistry.isTokenEnabled(TOKEN_A));
    }

    function testDisableTokenRevertsOnNonOwner() public {
        vm.prank(owner);
        tokenRegistry.registerToken(_makeTokenInfo(TOKEN_A, PRICE_ID_A, 18, true, true, true));

        vm.prank(user);
        vm.expectRevert(FheForgeBase.OnlyOwner.selector);
        tokenRegistry.disableToken(TOKEN_A);
    }

    function testGetTokenCountIncreasesWithRegistration() public {
        assertEq(tokenRegistry.getTokenCount(), 0);

        vm.prank(owner);
        tokenRegistry.registerToken(_makeTokenInfo(TOKEN_A, PRICE_ID_A, 18, true, true, true));
        assertEq(tokenRegistry.getTokenCount(), 1);

        vm.prank(owner);
        tokenRegistry.registerToken(_makeTokenInfo(TOKEN_B, PRICE_ID_B, 6, true, true, true));
        assertEq(tokenRegistry.getTokenCount(), 2);
    }

    function testGetLendableTokens() public {
        _registerThreeTokens();

        address[] memory lendable = tokenRegistry.getLendableTokens();
        assertEq(lendable.length, 2); // TOKEN_A and TOKEN_C

        // Verify TOKEN_A and TOKEN_C are in the list
        bool foundA;
        bool foundC;
        uint256 len = lendable.length;
        for (uint256 i; i < len; ++i) {
            if (lendable[i] == TOKEN_A) foundA = true;
            if (lendable[i] == TOKEN_C) foundC = true;
        }
        assertTrue(foundA);
        assertTrue(foundC);
    }

    function testGetBorrowableTokens() public {
        _registerThreeTokens();

        address[] memory borrowable = tokenRegistry.getBorrowableTokens();
        assertEq(borrowable.length, 2); // TOKEN_A and TOKEN_B
    }

    function testGetCollateralTokens() public {
        _registerThreeTokens();

        address[] memory collateral = tokenRegistry.getCollateralTokens();
        assertEq(collateral.length, 2); // TOKEN_A and TOKEN_B
    }

    function testDisabledTokenExcludedFromFilters() public {
        _registerThreeTokens();

        // Disable TOKEN_C (lendable)
        vm.prank(owner);
        tokenRegistry.disableToken(TOKEN_C);

        address[] memory lendable = tokenRegistry.getLendableTokens();
        assertEq(lendable.length, 1); // Only TOKEN_A left
        assertEq(lendable[0], TOKEN_A);
    }

    function testGetLendableTokensEmptyWhenNoneRegistered() public view {
        address[] memory lendable = tokenRegistry.getLendableTokens();
        assertEq(lendable.length, 0);
    }

    function _registerThreeTokens() internal {
        vm.startPrank(owner);
        // TOKEN_A: lendable, borrowable, collateral
        tokenRegistry.registerToken(
            TokenRegistry.TokenInfo({
                token: TOKEN_A,
                pythPriceId: PRICE_ID_A,
                decimals: 18,
                isLendable: true,
                isBorrowable: true,
                isCollateral: true,
                ltvBps: 7500,
                liquidationBonusBps: 500,
                borrowCap: 1_000_000 ether,
                supplyCap: 2_000_000 ether,
                enabled: true
            })
        );
        // TOKEN_B: borrowable, collateral, NOT lendable
        tokenRegistry.registerToken(
            TokenRegistry.TokenInfo({
                token: TOKEN_B,
                pythPriceId: PRICE_ID_B,
                decimals: 6,
                isLendable: false,
                isBorrowable: true,
                isCollateral: true,
                ltvBps: 7000,
                liquidationBonusBps: 500,
                borrowCap: 500_000 ether,
                supplyCap: 1_000_000 ether,
                enabled: true
            })
        );
        // TOKEN_C: lendable only
        tokenRegistry.registerToken(
            TokenRegistry.TokenInfo({
                token: TOKEN_C,
                pythPriceId: bytes32(uint256(3)),
                decimals: 18,
                isLendable: true,
                isBorrowable: false,
                isCollateral: false,
                ltvBps: 0,
                liquidationBonusBps: 0,
                borrowCap: 0,
                supplyCap: 1_000_000 ether,
                enabled: true
            })
        );
        vm.stopPrank();
    }

    function testIsTokenEnabledFalseForUnregistered() public view {
        assertFalse(tokenRegistry.isTokenEnabled(TOKEN_A));
    }

    function testIsTokenEnabledTrueForRegistered() public {
        vm.prank(owner);
        tokenRegistry.registerToken(_makeTokenInfo(TOKEN_A, PRICE_ID_A, 18, true, true, true));
        assertTrue(tokenRegistry.isTokenEnabled(TOKEN_A));
    }

    function testIsTokenEnabledFalseAfterDisable() public {
        vm.prank(owner);
        tokenRegistry.registerToken(_makeTokenInfo(TOKEN_A, PRICE_ID_A, 18, true, true, true));

        vm.prank(owner);
        tokenRegistry.disableToken(TOKEN_A);

        assertFalse(tokenRegistry.isTokenEnabled(TOKEN_A));
    }

    function testOnlyOwnerRegisterToken() public {
        vm.prank(user);
        vm.expectRevert(FheForgeBase.OnlyOwner.selector);
        tokenRegistry.registerToken(_makeTokenInfo(TOKEN_A, PRICE_ID_A, 18, true, true, true));
    }

    function testOnlyOwnerDisableToken() public {
        vm.prank(user);
        vm.expectRevert(FheForgeBase.OnlyOwner.selector);
        tokenRegistry.disableToken(TOKEN_A);
    }

    function testOwnershipTransfer() public {
        vm.prank(owner);
        tokenRegistry.transferOwnership(user);

        vm.prank(user);
        tokenRegistry.acceptOwnership();

        assertEq(tokenRegistry.owner(), user);
    }

    function testPauseByOwner() public {
        vm.prank(owner);
        tokenRegistry.pause();
        assertTrue(tokenRegistry.paused());
    }

    function testUnpauseByOwner() public {
        vm.prank(owner);
        tokenRegistry.pause();

        vm.prank(owner);
        tokenRegistry.unpause();

        assertFalse(tokenRegistry.paused());
    }

    function testPauseRevertsOnNonOwner() public {
        vm.prank(user);
        vm.expectRevert(FheForgeBase.OnlyOwner.selector);
        tokenRegistry.pause();
    }
}
