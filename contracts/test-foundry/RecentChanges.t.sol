// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TestHelper} from "./TestHelper.sol";
import {TokenRegistry} from "../contracts/TokenRegistry.sol";
import {StrategyRegistry} from "../contracts/StrategyRegistry.sol";
import {SwapRouter} from "../contracts/SwapRouter.sol";

contract RecentChangesTest is TestHelper {
    // ─── TokenRegistry.removeToken ───

    function test_removeToken_ownerCanRemove() public {
        tokenReg.registerToken(_makeTokenInfo(token1, 8000, 500, true, true, true));
        tokenReg.registerToken(_makeTokenInfo(token2, 8000, 500, true, true, true));
        tokenReg.registerToken(_makeTokenInfo(token3, 8000, 500, true, true, true));

        assertTrue(tokenReg.isRegistered(token2));
        tokenReg.removeToken(token2);
        assertFalse(tokenReg.isRegistered(token2));
    }

    function test_removeToken_swapAndPop() public {
        tokenReg.registerToken(_makeTokenInfo(token1, 8000, 500, true, true, true));
        tokenReg.registerToken(_makeTokenInfo(token2, 8000, 500, true, true, true));
        tokenReg.registerToken(_makeTokenInfo(token3, 8000, 500, true, true, true));

        // Remove middle element (token2) — token3 should swap into its place
        tokenReg.removeToken(token2);

        // token1 and token3 should still be registered
        assertTrue(tokenReg.isRegistered(token1));
        assertTrue(tokenReg.isRegistered(token3));
        assertFalse(tokenReg.isRegistered(token2));

        // Count should be 2
        assertEq(tokenReg.getTokenCount(), 2);
    }

    function test_removeToken_notRegistered_reverts() public {
        vm.expectRevert(TokenRegistry.TokenNotRegistered.selector);
        tokenReg.removeToken(token1);
    }

    function test_removeToken_nonOwner_reverts() public {
        tokenReg.registerToken(_makeTokenInfo(token1, 8000, 500, true, true, true));
        vm.prank(user1);
        vm.expectRevert();
        tokenReg.removeToken(token1);
    }

    function test_removeToken_lastElement() public {
        tokenReg.registerToken(_makeTokenInfo(token1, 8000, 500, true, true, true));
        tokenReg.registerToken(_makeTokenInfo(token2, 8000, 500, true, true, true));

        // Remove last element
        tokenReg.removeToken(token2);
        assertEq(tokenReg.getTokenCount(), 1);
        assertTrue(tokenReg.isRegistered(token1));
    }

    function test_registerToken_idempotent() public {
        tokenReg.registerToken(_makeTokenInfo(token1, 8000, 500, true, true, true));
        tokenReg.registerToken(_makeTokenInfo(token1, 9000, 600, false, false, false));

        // Should still be registered, count should be 1 (re-registration just updates)
        assertTrue(tokenReg.isRegistered(token1));
        assertEq(tokenReg.getTokenCount(), 1);
    }

    // ─── StrategyRegistry.setActive owner override ───

    function test_setActive_ownerCanOverride() public {
        // user1 creates a strategy
        vm.prank(user1);
        uint256 id = stratReg.registerStrategy("Test Strategy", bytes32(uint256(1)));

        // Owner (not the creator) should be able to deactivate
        stratReg.setActive(id, false);

        // And reactivate
        stratReg.setActive(id, true);
    }

    // ─── SwapRouter constructor ───

    function test_constructor_zeroExecutor_reverts() public {
        vm.expectRevert();
        new SwapRouter(
            address(0),        // zero executor — should revert
            300,
            3600,
            172800,
            address(0xCAFE)
        );
    }
}
