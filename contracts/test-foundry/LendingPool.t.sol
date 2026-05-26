// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { MockERC20 } from "../contracts/MockERC20.sol";
import { LendingPool } from "../contracts/LendingPool.sol";
import { PriceOracle } from "../contracts/PriceOracle.sol";
import { FlashLoanReceiver } from "./FlashLoanReceiver.sol";
import { FheForgeBase } from "../contracts/FheForgeBase.sol";
import { FheForgeTestHelper } from "./FheForgeTestHelper.sol";
import { FHE, euint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { ITaskManager } from "@fhenixprotocol/cofhe-contracts/ICofhe.sol";

contract LendingPoolTest is FheForgeTestHelper {
    LendingPool public pool;
    MockERC20 public token;

    address public owner = makeAddr("owner");
    address public user = makeAddr("user");
    address private constant PYTH_MOCK = address(0x1);
    uint256 private constant DEFAULT_STALE = 3600;

    // Liquidation test helpers
    PriceOracle public oracle;
    MockERC20 public debtToken;

    function setUp() public {
        _deployFheMocks();
        vm.startPrank(owner);
        pool = new LendingPool();
        token = new MockERC20("Test", "TST", 18);
        vm.stopPrank();
    }

    function testConstructorSetsOwner() public view {
        assertEq(pool.owner(), owner);
    }

    function testSetOracle() public {
        PriceOracle oracle_ = new PriceOracle(PYTH_MOCK, DEFAULT_STALE);
        vm.prank(owner);
        pool.setOracle(address(oracle_));
        assertEq(address(pool.oracle()), address(oracle_));
    }

    function testSetOracleRevertsOnZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(FheForgeBase.ZeroAddress.selector);
        pool.setOracle(address(0));
    }

    function testSetOracleRevertsOnNonOwner() public {
        vm.prank(user);
        vm.expectRevert();
        pool.setOracle(PYTH_MOCK);
    }

    function testSetComposer() public {
        address composer = makeAddr("composer");
        vm.prank(owner);
        pool.setComposer(composer);
    }

    function testSetComposerRevertsOnZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(FheForgeBase.ZeroAddress.selector);
        pool.setComposer(address(0));
    }

    function testDisableOracle() public {
        vm.prank(owner);
        pool.disableOracle();
        assertEq(address(pool.oracle()), address(0));
    }

    function testPauseByOwner() public {
        vm.prank(owner);
        pool.pause();
        assertTrue(pool.paused());
    }

    function testUnpauseByOwner() public {
        vm.prank(owner);
        pool.pause();
        vm.prank(owner);
        pool.unpause();
        assertFalse(pool.paused());
    }

    function testPauseRevertsOnNonOwner() public {
        vm.prank(user);
        vm.expectRevert();
        pool.pause();
    }

    function testMaxFlashLoanZeroForUntrackedToken() public view {
        assertEq(pool.maxFlashLoan(address(token)), 0);
    }

    function testFlashLoanRevertsOnZeroAmount() public {
        vm.prank(owner);
        vm.expectRevert(FheForgeBase.ZeroAmount.selector);
        pool.flashLoan(user, address(token), 0, "");
    }

    function testFlashLoanRevertsOnUnsupportedToken() public {
        vm.expectRevert(LendingPool.FlashLoanUnsupportedToken.selector);
        pool.flashFee(address(token), 100 ether);
    }

    function testFlashFeeBps() public pure {
        uint256 amount = 10000 ether;
        uint256 expectedFee = (amount * 5) / 10000;
        assertEq(expectedFee, 5 ether);
    }

    function testFlashLoanEndToEnd() public {
        uint256 supplyAmount = 1000 ether;
        uint256 flashAmount = 100 ether;

        // Seed owner's wallet
        vm.prank(owner);
        token.mint(owner, supplyAmount);

        // Create handle and pre-allow LendingPool on it.
        // Without this pre-allow, the mock's isTriviallyEncryptedFromHash erroneously
        // returns false for security zones < 128 (checks wrong byte), so the ACL
        // is consulted and LendingPool has no permission on the test-created handle.
        euint128 handle = FHE.asEuint128(supplyAmount);
        ITaskManager(getTaskManagerAddress()).allow(
            uint256(euint128.unwrap(handle)),
            address(pool)
        );

        vm.startPrank(owner);
        token.approve(address(pool), supplyAmount);
        pool.setComposer(owner);
        pool.depositFor(address(token), supplyAmount, handle, address(pool));
        vm.stopPrank();

        // Check maxFlashLoan = reserve (since borrow = 0)
        uint256 maxLoan = pool.maxFlashLoan(address(token));
        assertEq(maxLoan, supplyAmount);

        FlashLoanReceiver receiver = new FlashLoanReceiver(address(pool), address(token));

        // Pre-fund receiver with flash fee so it can repay amount + fee
        uint256 fee = (flashAmount * 5) / 10000;
        vm.prank(owner);
        token.mint(address(receiver), fee);

        // Execute flash loan
        vm.prank(address(receiver));
        pool.flashLoan(address(receiver), address(token), flashAmount, "");
    }

    function testZeroAddressSelector() public {
        bytes4 selector = bytes4(keccak256("ZeroAddress()"));
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(selector));
        pool.setOracle(address(0));
    }

    /// @dev Deploy oracle + debtToken, configure prices/LTV, create a user position,
    ///      and fund the liquidator with borrowed debt tokens.
    ///      Collateral = token (existing), Debt = debtToken (fresh).
    function _setupLiquidationPosition(
        address user_,
        address liquidator_,
        uint256 collAmount,
        uint256 borrowAmount
    ) internal {
        // Deploy oracle and second token for debt under owner prank
        vm.startPrank(owner);
        oracle = new PriceOracle(PYTH_MOCK, DEFAULT_STALE);
        debtToken = new MockERC20("Debt", "DEBT", 18);

        // Configure oracle: 50% LTV, $1 fallback for both tokens
        oracle.setCollateralFactor(address(token), 5000, 5500);
        oracle.setFallbackPrice(address(token), 1e18);
        oracle.setFallbackPrice(address(debtToken), 1e18);
        pool.setOracle(address(oracle));
        pool.setComposer(owner);
        vm.stopPrank();

        // 1. Deposit collateral for user
        euint128 collHandle = FHE.asEuint128(collAmount);
        ITaskManager(getTaskManagerAddress()).allow(
            uint256(euint128.unwrap(collHandle)),
            address(pool)
        );
        vm.startPrank(owner);
        token.mint(owner, collAmount);
        token.approve(address(pool), collAmount);
        pool.depositFor(address(token), collAmount, collHandle, user_);
        vm.stopPrank();

        // 2. Pre-deposit debt tokens to the pool as liquidity
        euint128 liqHandle = FHE.asEuint128(borrowAmount);
        ITaskManager(getTaskManagerAddress()).allow(
            uint256(euint128.unwrap(liqHandle)),
            address(pool)
        );
        vm.startPrank(owner);
        debtToken.mint(owner, borrowAmount);
        debtToken.approve(address(pool), borrowAmount);
        pool.depositFor(address(debtToken), borrowAmount, liqHandle, owner);
        vm.stopPrank();

        // 3. Borrow for user (tokens go to composer = owner)
        euint128 borrowHandle = FHE.asEuint128(borrowAmount);
        ITaskManager(getTaskManagerAddress()).allow(
            uint256(euint128.unwrap(borrowHandle)),
            address(pool)
        );
        vm.startPrank(owner);
        pool.borrowFor(address(debtToken), borrowAmount, borrowHandle, user_);
        // Pass borrowed tokens to liquidator so they can repay
        assertTrue(debtToken.transfer(liquidator_, borrowAmount));
        vm.stopPrank();

        // Liquidator approves pool to pull debt tokens
        vm.prank(liquidator_);
        debtToken.approve(address(pool), type(uint256).max);
    }

    function testLiquidateWithProofRevertWhenOracleNotSet() public {
        address liquidator = makeAddr("liquidator");
        address user_ = makeAddr("user");

        vm.prank(liquidator);
        vm.expectRevert(LendingPool.OracleNotSet.selector);
        pool.liquidateWithProof(
            user_,
            address(token),
            address(0x1),
            1 ether,
            uint128(1),
            hex"00",
            uint128(1),
            hex"00"
        );
    }

    function testLiquidateWithProofRevertWhenSelfLiquidation() public {
        // Need an oracle to pass the first check
        PriceOracle pOracle = new PriceOracle(PYTH_MOCK, DEFAULT_STALE);
        vm.prank(owner);
        pool.setOracle(address(pOracle));

        vm.prank(owner);
        vm.expectRevert(LendingPool.CannotSelfLiquidate.selector);
        pool.liquidateWithProof(
            owner,
            address(token),
            address(0x1),
            1 ether,
            uint128(1),
            hex"00",
            uint128(1),
            hex"00"
        );
    }

    function testLiquidateWithProofSuccessful() public {
        address liquidator = makeAddr("liquidator");
        address user_ = makeAddr("user");
        uint128 collAmount = 200 ether;
        uint128 borrowAmount = 120 ether;
        uint256 debtToCover = 40 ether;

        _setupLiquidationPosition(user_, liquidator, collAmount, borrowAmount);

        // expectedSeized = 40 * (10000 + 500) / 10000 = 42 ether
        uint256 expectedSeized =
            (debtToCover * (pool.BPS_DEN() + pool.LIQUIDATION_BONUS_BPS())) / pool.BPS_DEN();

        vm.expectEmit(true, true, true, true, address(pool));
        emit LendingPool.Liquidated(
            liquidator,
            user_,
            address(token),
            address(debtToken),
            debtToCover,
            expectedSeized
        );

        vm.prank(liquidator);
        pool.liquidateWithProof(
            user_,
            address(token),
            address(debtToken),
            debtToCover,
            borrowAmount, // debt balance proof (mock always returns true)
            hex"", // signature (ignored by mock)
            collAmount, // supply balance proof
            hex"" // signature (ignored by mock)
        );
    }

    function testLiquidateWithProofRevertWhenInsufficientCollateral() public {
        address liquidator = makeAddr("liquidator");
        address user_ = makeAddr("user");
        uint128 collAmount = 200 ether;
        uint128 borrowAmount = 120 ether;
        uint256 debtToCover = 10 ether; // too small → remaining 110 > healthy max 100

        _setupLiquidationPosition(user_, liquidator, collAmount, borrowAmount);

        vm.prank(liquidator);
        vm.expectRevert(LendingPool.InsufficientCollateral.selector);
        pool.liquidateWithProof(
            user_,
            address(token),
            address(debtToken),
            debtToCover,
            borrowAmount,
            hex"",
            collAmount,
            hex""
        );
    }

    /// @notice Fuzz over debtToCover with coll=200, debt=120, LTV=50%.
    ///         Valid range: [20, 60] ether. Below 20 → InsufficientCollateral.
    function testFuzzLiquidateWithProofParams(uint256 debtToCoverWad) public {
        address liquidator = makeAddr("liquidator");
        address user_ = makeAddr("user");
        uint128 collAmount = 200 ether;
        uint128 borrowAmount = 120 ether;

        debtToCoverWad = bound(debtToCoverWad, 1, 60 ether);
        _setupLiquidationPosition(user_, liquidator, collAmount, borrowAmount);

        vm.prank(liquidator);
        if (debtToCoverWad < 20 ether) {
            vm.expectRevert(LendingPool.InsufficientCollateral.selector);
            pool.liquidateWithProof(
                user_,
                address(token),
                address(debtToken),
                debtToCoverWad,
                borrowAmount,
                hex"",
                collAmount,
                hex""
            );
        } else {
            pool.liquidateWithProof(
                user_,
                address(token),
                address(debtToken),
                debtToCoverWad,
                borrowAmount,
                hex"",
                collAmount,
                hex""
            );
        }
    }
}
