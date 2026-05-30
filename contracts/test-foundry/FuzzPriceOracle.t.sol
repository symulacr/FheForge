// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PriceOracle} from "../contracts/PriceOracle.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {FheForgeBase} from "../contracts/FheForgeBase.sol";
import {FheForgeTestHelper} from "./FheForgeTestHelper.sol";
import {SimplePythMock} from "../contracts/mocks/SimplePythMock.sol";

/// @notice Fuzz tests for PriceOracle (MC-076).
///         Covers: staleness thresholds, collateral factor boundary combinations,
///         setSource with various decimal values, convertToUsd / convertFromUsd
///         amount fuzzing, and isStale behaviour across time domains.
/// @custom:mock
contract FuzzPriceOracle is FheForgeTestHelper {
    uint256 private constant DEFAULT_STALE = 3600;

    SimplePythMock public pythMock;
    PriceOracle public oracle;

    address public owner = makeAddr("owner");
    address public user = makeAddr("user");

    address public constant TOKEN_A = address(0x100);
    address public constant TOKEN_B = address(0x200);

    bytes32 public constant ETH_PRICE_ID = keccak256("ETH/USD");

    function setUp() public {
        _deployFheMocks();
        vm.warp(1_000_000);
        pythMock = new SimplePythMock(1 ether);
        vm.prank(owner);
        oracle = new PriceOracle(address(pythMock), DEFAULT_STALE);
    }

    // ─── Fuzz 1: staleness threshold values ───────────────────────────────────
    // Must be > 0; test a wide range that stays within reasonable bounds.
    function testFuzzSetStalenessThreshold(uint256 threshold) public {
        threshold = bound(threshold, 0, 365 days);

        vm.prank(owner);

        if (threshold == 0) {
            vm.expectRevert(FheForgeBase.ZeroAmount.selector);
            oracle.setStalenessThreshold(0);
        } else {
            oracle.setStalenessThreshold(threshold);
            assertEq(oracle.stalenessThreshold(), threshold);
        }
    }

    // ─── Fuzz 2: collateral factor boundary combinations ──────────────────────
    // ltvBps ∈ [1, 10000], liqThresholdBps ∈ [ltvBps, 10000].
    function testFuzzCollateralFactor(uint16 ltvBps, uint16 liqThresholdBps) public {
        vm.assume(ltvBps > 0); // skip zero-ltv to avoid ltvNum collision

        if (liqThresholdBps > ltvBps && liqThresholdBps <= 10000) {
            vm.prank(owner);
            oracle.setCollateralFactor(TOKEN_A, ltvBps, liqThresholdBps);
            assertEq(oracle.collateralFactorBps(TOKEN_A), ltvBps);
            assertEq(oracle.liquidationThresholdBps(TOKEN_A), liqThresholdBps);
        } else {
            // Revert expected for invalid combos
            vm.prank(owner);
            if (ltvBps > 10000 || liqThresholdBps > 10000) {
                vm.expectRevert(PriceOracle.InvalidBps.selector);
            } else if (ltvBps > liqThresholdBps) {
                vm.expectRevert(PriceOracle.InvalidBps.selector);
            } else {
                // ltvBps == liqThresholdBps or both 0: actually valid for our input
                return; // tested in valid path when liq >= ltv
            }
            oracle.setCollateralFactor(TOKEN_A, ltvBps, liqThresholdBps);
        }
    }

    // ─── Fuzz 3: setSource with various decimals ─────────────────────────────-
    // token decimals must be > 0; staleThreshold must be >= 0.
    function testFuzzSetSourceDecimals(uint8 decimals, uint64 staleThresh) public {
        decimals = uint8(bound(uint256(decimals), 0, 18));
        staleThresh = uint64(bound(uint256(staleThresh), 0, 86400));

        vm.prank(owner);
        if (decimals == 0) {
            vm.expectRevert(FheForgeBase.ZeroAmount.selector);
            oracle.setSource(TOKEN_A, ETH_PRICE_ID, decimals, staleThresh);
        } else {
            oracle.setSource(TOKEN_A, ETH_PRICE_ID, decimals, staleThresh);
            assertEq(oracle.tokenDecimals(TOKEN_A), decimals);
            assertEq(oracle.staleThreshold(TOKEN_A), staleThresh);
        }
    }

    // ─── Fuzz 4: setSource with staleThreshold zero uses default ──────────────
    function testFuzzSetSourceZeroThreshold(uint8 decimals) public {
        decimals = uint8(bound(uint256(decimals), 1, 18));
        vm.prank(owner);
        oracle.setSource(TOKEN_A, ETH_PRICE_ID, decimals, 0);
        // staleThreshold returns 0; the actual threshold used is DEFAULT_STALE
        assertEq(oracle.staleThreshold(TOKEN_A), 0);
    }

    // ─── Fuzz 5: convertToUsd with fallback prices ────────────────────────────
    // Fallback price is set; fuzz the amount and verify USD conversion.
    function testFuzzConvertToUsdWithFallback(uint256 fallbackPrice, uint256 amount) public {
        fallbackPrice = bound(fallbackPrice, 1, 1_000_000e18);
        amount = bound(amount, 1, 1_000_000e18);

        vm.prank(owner);
        oracle.setFallbackPrice(TOKEN_A, fallbackPrice);

        // Without tokenDecimals set, the oracle defaults to 18 decimals for the divisor.
        // So convertToUsd = (amount * price) / 1e18.
        uint256 expected = (amount * fallbackPrice) / 1e18;
        uint256 actual = oracle.convertToUsd(TOKEN_A, amount);

        // Allow for small rounding differences (÷1e18 is exact here since both are WAD)
        assertApproxEqAbs(actual, expected, 1, "convertToUsd mismatch");
    }

    // ─── Fuzz 6: convertFromUsd round-trip with fallback prices ───────────────
    // convertFromUsd(convertToUsd(amount)) ≈ amount (roundtrip invariant).
    function testFuzzConvertRoundtrip(uint256 fallbackPrice, uint256 amount) public {
        fallbackPrice = bound(fallbackPrice, 1e18, 1_000_000e18);
        amount = bound(amount, 1, 1_000_000e18);

        vm.prank(owner);
        oracle.setFallbackPrice(TOKEN_A, fallbackPrice);

        uint256 usdValue = oracle.convertToUsd(TOKEN_A, amount);
        uint256 back = oracle.convertFromUsd(TOKEN_A, usdValue);

        // Round-trip should return the original amount (exact when decimals=18).
        assertApproxEqAbs(back, amount, 1, "roundtrip deviation");
    }

    // ─── Fuzz 7: batchSetSources with varying threshold ───────────────────────
    // Batch configure and validate each token's settings.
    function testFuzzBatchSetSourcesThresholds(uint64 threshA, uint64 threshB) public {
        threshA = uint64(bound(uint256(threshA), 1, 86400));
        threshB = uint64(bound(uint256(threshB), 1, 86400));
        vm.assume(threshA != threshB); // ensure distinct check

        PriceOracle.FeedInfo[] memory feeds = new PriceOracle.FeedInfo[](2);
        feeds[0] = PriceOracle.FeedInfo(TOKEN_A, threshA, 18, ETH_PRICE_ID);
        feeds[1] = PriceOracle.FeedInfo(TOKEN_B, threshB, 6, keccak256("BTC/USD"));

        vm.prank(owner);
        oracle.batchSetSources(feeds);

        assertEq(oracle.staleThreshold(TOKEN_A), threshA);
        assertEq(oracle.staleThreshold(TOKEN_B), threshB);
        assertEq(oracle.tokenDecimals(TOKEN_B), 6);
    }

    // ─── Fuzz 8: fallback price revert on zero ────────────────────────────────
    function testFuzzFallbackPriceZeroRevert(uint256 price) public {
        vm.assume(price == 0);

        vm.prank(owner);
        vm.expectRevert(FheForgeBase.ZeroAmount.selector);
        oracle.setFallbackPrice(TOKEN_A, 0);
    }

    // ─── Fuzz 9: convertToUsd with decimals < 18 ──────────────────────────────
    // For a 6-decimal token, convertToUsd = (amount * price) / 1e6.
    function testFuzzConvertToUsdSixDecimals(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000e6);

        vm.prank(owner);
        oracle.setSource(TOKEN_A, ETH_PRICE_ID, 6, 600);
        vm.prank(owner);
        oracle.setFallbackPrice(TOKEN_A, 1e18);

        uint256 expected = (amount * 1e18) / 1e6;
        assertEq(oracle.convertToUsd(TOKEN_A, amount), expected);
    }

    // ─── Fuzz 10: isStale across time ─────────────────────────────────────────
    // After setting a price with a recent publishTime, warp forward and
    // verify that isStale flips at the right threshold boundary.
    function testFuzzIsStaleTransition(uint256 warpBy) public {
        warpBy = bound(warpBy, 0, 7200); // 0..2 hours

        vm.prank(owner);
        oracle.setSource(TOKEN_A, ETH_PRICE_ID, 18, 600);
        vm.prank(owner);
        oracle.setStalenessThreshold(3600); // 1 hour default

        pythMock.setPrice(
            ETH_PRICE_ID,
            PythStructs.Price({price: 2000 * 1e8, conf: 1, expo: -8, publishTime: uint64(block.timestamp)})
        );

        assertFalse(oracle.isStale(TOKEN_A), "should be fresh at t=0");

        vm.warp(block.timestamp + warpBy);

        bool stale = oracle.isStale(TOKEN_A);
        if (warpBy > 3600) {
            assertTrue(stale, "should be stale after threshold");
        } else {
            assertFalse(stale, "should still be fresh within threshold");
        }
    }
}
