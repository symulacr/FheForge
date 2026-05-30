// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PriceOracle} from "../contracts/PriceOracle.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {FheForgeBase} from "../contracts/FheForgeBase.sol";
import {FheForgeTestHelper} from "./FheForgeTestHelper.sol";
import {SimplePythMock} from "../contracts/mocks/SimplePythMock.sol";
import {PriceOracleHarness} from "./PriceOracleHarness.sol";

/// @custom:mock
contract PriceOracleTest is FheForgeTestHelper {
    uint256 private constant DEFAULT_STALE = 3600;

    SimplePythMock public pythMock;
    PriceOracleHarness public oracle;

    address public owner = makeAddr("owner");
    address public user = makeAddr("user");

    address public constant TOKEN_A = address(0x100);
    address public constant TOKEN_B = address(0x200);

    function setUp() public {
        _deployFheMocks();
        vm.warp(1_000_000);
        pythMock = new SimplePythMock(1 ether);
        vm.prank(owner);
        oracle = new PriceOracleHarness(address(pythMock), DEFAULT_STALE);
    }

    function testConstructorSetsParams() public view {
        assertEq(oracle.owner(), owner);
        assertEq(address(oracle.PYTH()), address(pythMock));
        assertEq(oracle.DEFAULT_STALE_THRESHOLD(), DEFAULT_STALE);
    }

    function testConstructorRevertsOnZeroAddress() public {
        vm.expectRevert(FheForgeBase.ZeroAddress.selector);
        new PriceOracleHarness(address(0), DEFAULT_STALE);
    }

    function testSetSource() public {
        bytes32 priceId = keccak256("ETH/USD");
        vm.prank(owner);
        oracle.setSource(TOKEN_A, priceId, 18, 600);

        assertEq(oracle.priceId(TOKEN_A), priceId);
        assertEq(oracle.tokenDecimals(TOKEN_A), 18);
        assertEq(oracle.staleThreshold(TOKEN_A), 600);
    }

    function testSetSourceRevertsOnZeroToken() public {
        vm.prank(owner);
        vm.expectRevert(FheForgeBase.ZeroAddress.selector);
        oracle.setSource(address(0), keccak256("ETH/USD"), 18, 600);
    }

    function testSetSourceRevertsOnZeroDecimals() public {
        vm.prank(owner);
        vm.expectRevert(FheForgeBase.ZeroAmount.selector);
        oracle.setSource(TOKEN_A, keccak256("ETH/USD"), 0, 600);
    }

    function testSetSourceRevertsOnNonOwner() public {
        vm.prank(user);
        vm.expectRevert();
        oracle.setSource(TOKEN_A, keccak256("ETH/USD"), 18, 600);
    }

    function testRemoveSource() public {
        bytes32 priceId = keccak256("ETH/USD");
        vm.prank(owner);
        oracle.setSource(TOKEN_A, priceId, 18, 600);

        vm.prank(owner);
        oracle.removeSource(TOKEN_A);

        assertEq(oracle.priceId(TOKEN_A), bytes32(0));
    }

    function testSetCollateralFactor() public {
        vm.prank(owner);
        oracle.setCollateralFactor(TOKEN_A, 7500, 8000);

        assertEq(oracle.collateralFactorBps(TOKEN_A), 7500);
        assertEq(oracle.liquidationThresholdBps(TOKEN_A), 8000);
    }

    function testSetCollateralFactorRevertsOnOverBpsDen() public {
        vm.prank(owner);
        vm.expectRevert(PriceOracle.InvalidBps.selector);
        oracle.setCollateralFactor(TOKEN_A, 10001, 10000);
    }

    function testSetCollateralFactorRevertsOnLiqLessThanLtv() public {
        vm.prank(owner);
        vm.expectRevert(PriceOracle.InvalidBps.selector);
        oracle.setCollateralFactor(TOKEN_A, 8000, 7500);
    }

    function testBatchSetSources() public {
        PriceOracle.FeedInfo[] memory feeds = new PriceOracle.FeedInfo[](2);
        feeds[0] = PriceOracle.FeedInfo(TOKEN_A, 600, 18, keccak256("ETH/USD"));
        feeds[1] = PriceOracle.FeedInfo(TOKEN_B, 300, 8, keccak256("BTC/USD"));

        vm.prank(owner);
        oracle.batchSetSources(feeds);

        assertEq(oracle.priceId(TOKEN_B), keccak256("BTC/USD"));
        assertEq(oracle.tokenDecimals(TOKEN_B), 8);
    }

    function testSetFallbackPrice() public {
        vm.prank(owner);
        oracle.setFallbackPrice(TOKEN_A, 2000e18);

        assertTrue(oracle.isStale(TOKEN_A));
    }

    function testSetFallbackPriceRevertsOnZero() public {
        vm.prank(owner);
        vm.expectRevert(FheForgeBase.ZeroAmount.selector);
        oracle.setFallbackPrice(TOKEN_A, 0);
    }

    function testRemoveFallbackPrice() public {
        vm.prank(owner);
        oracle.setFallbackPrice(TOKEN_A, 2000e18);

        vm.prank(owner);
        oracle.removeFallbackPrice(TOKEN_A);
    }

    function testIsSupportedFalseForUnregistered() public view {
        assertFalse(oracle.isSupported(TOKEN_A));
    }

    function testIsSupportedTrueForRegistered() public {
        vm.prank(owner);
        oracle.setSource(TOKEN_A, keccak256("ETH/USD"), 18, 600);
        assertTrue(oracle.isSupported(TOKEN_A));
    }

    function testSetStalenessThreshold() public {
        vm.prank(owner);
        oracle.setStalenessThreshold(2 hours);
        assertEq(oracle.stalenessThreshold(), 2 hours);
    }

    function testSetStalenessThresholdRevertsOnZero() public {
        vm.prank(owner);
        vm.expectRevert(FheForgeBase.ZeroAmount.selector);
        oracle.setStalenessThreshold(0);
    }

    function testSweepEth() public {
        vm.deal(address(oracle), 1 ether);

        vm.prank(owner);
        oracle.sweepEth(payable(owner));
        assertEq(address(oracle).balance, 0);
    }

    function testSweepEthRevertsOnZeroTo() public {
        vm.prank(owner);
        vm.expectRevert(FheForgeBase.ZeroAddress.selector);
        oracle.sweepEth(payable(address(0)));
    }

    function testTransferOwnership() public {
        vm.prank(owner);
        oracle.transferOwnership(user);

        vm.prank(user);
        oracle.acceptOwnership();

        assertEq(oracle.owner(), user);
    }

    function testOnlyOwnerCalls() public {
        vm.prank(user);
        vm.expectRevert();
        oracle.setCollateralFactor(TOKEN_A, 5000, 5500);
    }

    function testRemoveSourceUnregisteredToken() public {
        vm.prank(owner);
        oracle.removeSource(TOKEN_A);
        assertEq(oracle.priceId(TOKEN_A), bytes32(0));
    }

    function testRemoveSourceRevertsOnNonOwner() public {
        vm.prank(user);
        vm.expectRevert();
        oracle.removeSource(TOKEN_A);
    }

    function testBatchSetSourcesRevertsOnZeroToken() public {
        PriceOracle.FeedInfo[] memory feeds = new PriceOracle.FeedInfo[](1);
        feeds[0] = PriceOracle.FeedInfo(address(0), 600, 18, keccak256("ETH/USD"));

        vm.prank(owner);
        vm.expectRevert(FheForgeBase.ZeroAddress.selector);
        oracle.batchSetSources(feeds);
    }

    function testBatchSetSourcesRevertsOnZeroDecimals() public {
        PriceOracle.FeedInfo[] memory feeds = new PriceOracle.FeedInfo[](1);
        feeds[0] = PriceOracle.FeedInfo(TOKEN_A, 600, 0, keccak256("ETH/USD"));

        vm.prank(owner);
        vm.expectRevert(FheForgeBase.ZeroAmount.selector);
        oracle.batchSetSources(feeds);
    }

    function testBatchSetSourcesRevertsOnNonOwner() public {
        PriceOracle.FeedInfo[] memory feeds = new PriceOracle.FeedInfo[](1);
        feeds[0] = PriceOracle.FeedInfo(TOKEN_A, 600, 18, keccak256("ETH/USD"));

        vm.prank(user);
        vm.expectRevert();
        oracle.batchSetSources(feeds);
    }

    function testSetFallbackPriceRevertsOnZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(FheForgeBase.ZeroAddress.selector);
        oracle.setFallbackPrice(address(0), 1000e18);
    }

    function testRemoveFallbackPriceRevertsOnZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(FheForgeBase.ZeroAddress.selector);
        oracle.removeFallbackPrice(address(0));
    }

    function testRemoveFallbackPriceNonExistent() public {
        vm.prank(owner);
        oracle.removeFallbackPrice(TOKEN_A);
    }

    function testGetPriceWithFallbackNoFeed() public {
        vm.expectRevert(PriceOracle.NoPriceFeed.selector);
        oracle.getPriceWithFallback(TOKEN_A);
    }

    function testGetPriceWithFallbackUsesFallbackWhenNoFeed() public {
        vm.prank(owner);
        oracle.setFallbackPrice(TOKEN_A, 2000e18);

        uint256 price = oracle.getPriceWithFallback(TOKEN_A);
        assertEq(price, 2000e18);
    }

    function testSetStalenessThresholdRevertsOnNonOwner() public {
        vm.prank(user);
        vm.expectRevert();
        oracle.setStalenessThreshold(2 hours);
    }

    function testIsStaleForUnregisteredToken() public view {
        assertTrue(oracle.isStale(TOKEN_A));
    }

    function testIsStaleForRegisteredToken() public {
        vm.prank(owner);
        oracle.setSource(TOKEN_A, keccak256("ETH/USD"), 18, 600);

        assertTrue(oracle.isStale(TOKEN_A));
    }

    function testConvertToUsdWithFallback() public {
        vm.prank(owner);
        oracle.setFallbackPrice(TOKEN_A, 2000e18);

        uint256 usdValue = oracle.convertToUsd(TOKEN_A, 100 ether);
        assertEq(usdValue, 200_000e18);
    }

    function testConvertToUsdWithFallbackSixDecimals() public {
        vm.prank(owner);
        oracle.setSource(TOKEN_A, keccak256("USDC/USD"), 6, 600);
        vm.prank(owner);
        oracle.setFallbackPrice(TOKEN_A, 1e18);

        uint256 usdValue = oracle.convertToUsd(TOKEN_A, 100 * 1e6);
        assertEq(usdValue, 100e18);
    }

    function testConvertFromUsdWithFallback() public {
        vm.prank(owner);
        oracle.setFallbackPrice(TOKEN_A, 2000e18);

        uint256 amount = oracle.convertFromUsd(TOKEN_A, 200_000e18);
        assertEq(amount, 100 ether);
    }

    function testConvertToUsdRevertsNoFeed() public {
        vm.expectRevert(PriceOracle.NoPriceFeed.selector);
        oracle.convertToUsd(TOKEN_A, 100 ether);
    }

    function testGetPythUpdateFee() public view {
        bytes[] memory updateData = new bytes[](1);
        updateData[0] = hex"deadbeef";

        uint256 fee = oracle.getPythUpdateFee(updateData);
        assertEq(fee, 1 ether);
    }

    function testUpdatePriceFeedsRevertsOnFeeMismatch() public {
        bytes[] memory updateData = new bytes[](1);
        updateData[0] = hex"deadbeef";

        vm.deal(user, 10 ether);
        vm.prank(user);
        vm.expectRevert(PriceOracle.PythUpdateFeeMismatch.selector);
        oracle.updatePriceFeeds{value: 0.5 ether}(updateData);
    }

    function testUpdatePriceFeedsWithCorrectFee() public {
        bytes[] memory updateData = new bytes[](1);
        updateData[0] = hex"deadbeef";

        vm.deal(user, 10 ether);
        vm.prank(user);
        oracle.updatePriceFeeds{value: 1 ether}(updateData);
    }

    function testNormalizePythPricePositive() public view {
        PythStructs.Price memory p =
            PythStructs.Price({price: 2000 * 1e8, conf: 1, expo: -8, publishTime: uint64(block.timestamp)});

        uint256 priceWad = oracle.exposedNormalizePythPrice(p);
        assertEq(priceWad, 2000e18);
    }

    function testNormalizePythPriceWithExpoPositive() public view {
        PythStructs.Price memory p =
            PythStructs.Price({price: 200, conf: 1, expo: 1, publishTime: uint64(block.timestamp)});

        uint256 priceWad = oracle.exposedNormalizePythPrice(p);
        assertEq(priceWad, 2000e18);
    }

    function testNormalizePythPriceRevertsOnZeroPrice() public {
        PythStructs.Price memory p =
            PythStructs.Price({price: 0, conf: 1, expo: -8, publishTime: uint64(block.timestamp)});

        vm.expectRevert(PriceOracle.ZeroPrice.selector);
        oracle.exposedNormalizePythPrice(p);
    }

    function testNormalizePythPriceRevertsOnNegativePrice() public {
        PythStructs.Price memory p =
            PythStructs.Price({price: -100, conf: 1, expo: -8, publishTime: uint64(block.timestamp)});

        vm.expectRevert(PriceOracle.NegativePrice.selector);
        oracle.exposedNormalizePythPrice(p);
    }

    function testNormalizePythPriceRevertsOnUncertainPrice() public {
        PythStructs.Price memory p =
            PythStructs.Price({price: 1000, conf: 100, expo: -8, publishTime: uint64(block.timestamp)});

        vm.expectRevert(PriceOracle.UncertainPrice.selector);
        oracle.exposedNormalizePythPrice(p);
    }

    function testIsStaleWithRecentPublishTime() public {
        vm.prank(owner);
        oracle.setSource(TOKEN_A, keccak256("ETH/USD"), 18, 600);

        pythMock.setPrice(
            keccak256("ETH/USD"),
            PythStructs.Price({price: 2000 * 1e8, conf: 1, expo: -8, publishTime: uint64(block.timestamp) - 100})
        );

        assertFalse(oracle.isStale(TOKEN_A));
    }

    function testIsStaleWithOldPublishTime() public {
        vm.prank(owner);
        oracle.setSource(TOKEN_A, keccak256("ETH/USD"), 18, 600);

        pythMock.setPrice(
            keccak256("ETH/USD"),
            PythStructs.Price({price: 2000 * 1e8, conf: 1, expo: -8, publishTime: uint64(block.timestamp) - 2 hours})
        );

        assertTrue(oracle.isStale(TOKEN_A));
    }

    function testGetPriceWithFallbackFromPyth() public {
        vm.prank(owner);
        oracle.setSource(TOKEN_A, keccak256("ETH/USD"), 18, 600);

        pythMock.setPrice(
            keccak256("ETH/USD"),
            PythStructs.Price({price: 2000 * 1e8, conf: 1, expo: -8, publishTime: uint64(block.timestamp)})
        );

        uint256 price = oracle.getPriceWithFallback(TOKEN_A);
        assertEq(price, 2000e18);
    }

    function testGetPriceWithFallbackFallsBackWhenStale() public {
        vm.prank(owner);
        oracle.setSource(TOKEN_A, keccak256("ETH/USD"), 18, 600);
        vm.prank(owner);
        oracle.setFallbackPrice(TOKEN_A, 1500e18);

        pythMock.setPrice(
            keccak256("ETH/USD"),
            PythStructs.Price({price: 2000 * 1e8, conf: 1, expo: -8, publishTime: uint64(block.timestamp) - 2 hours})
        );

        uint256 price = oracle.getPriceWithFallback(TOKEN_A);
        assertEq(price, 1500e18);
    }

    function testGetPriceWithFallbackRevertsWhenStaleNoFallback() public {
        vm.prank(owner);
        oracle.setSource(TOKEN_A, keccak256("ETH/USD"), 18, 600);

        pythMock.setPrice(
            keccak256("ETH/USD"),
            PythStructs.Price({price: 2000 * 1e8, conf: 1, expo: -8, publishTime: uint64(block.timestamp) - 2 hours})
        );

        vm.expectRevert(PriceOracle.NoPriceAvailable.selector);
        oracle.getPriceWithFallback(TOKEN_A);
    }

    function testSetCollateralFactorRevertsOnZeroToken() public {
        vm.prank(owner);
        vm.expectRevert(FheForgeBase.ZeroAddress.selector);
        oracle.setCollateralFactor(address(0), 7500, 8000);
    }

    function testSetCollateralFactorLtvEqualsLiqThreshold() public {
        vm.prank(owner);
        oracle.setCollateralFactor(TOKEN_A, 8000, 8000);
        assertEq(oracle.collateralFactorBps(TOKEN_A), 8000);
        assertEq(oracle.liquidationThresholdBps(TOKEN_A), 8000);
    }

    function testSweepEthRevertsOnNonOwner() public {
        vm.deal(address(oracle), 1 ether);

        vm.prank(user);
        vm.expectRevert();
        oracle.sweepEth(payable(user));
    }

    function testOnlyOwnerSetFallbackPrice() public {
        vm.prank(user);
        vm.expectRevert();
        oracle.setFallbackPrice(TOKEN_A, 1000e18);
    }

    function testOnlyOwnerRemoveFallbackPrice() public {
        vm.prank(user);
        vm.expectRevert();
        oracle.removeFallbackPrice(TOKEN_A);
    }

    function testPauseByOwner() public {
        vm.prank(owner);
        oracle.pause();
        assertTrue(oracle.paused());
    }

    function testUnpauseByOwner() public {
        vm.prank(owner);
        oracle.pause();

        vm.prank(owner);
        oracle.unpause();

        assertFalse(oracle.paused());
    }

    function testPauseRevertsOnNonOwner() public {
        vm.prank(user);
        vm.expectRevert();
        oracle.pause();
    }
}
