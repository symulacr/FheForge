// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { MockERC20 } from "../contracts/MockERC20.sol";
import { FheForgeComposer } from "../contracts/FheForgeComposer.sol";
import { StrategyRegistry } from "../contracts/StrategyRegistry.sol";
import { FheForgeBase } from "../contracts/FheForgeBase.sol";
import { FheForgeTestHelper } from "./FheForgeTestHelper.sol";
import { InEuint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { MockTaskManager } from "../node_modules/@cofhe/mock-contracts/contracts/MockTaskManager.sol";
import { VaultMock } from "../contracts/mocks/VaultMock.sol";
import { PoolMock } from "../contracts/mocks/PoolMock.sol";
import { RouterMock } from "../contracts/mocks/RouterMock.sol";

/// @custom:mock
contract FheForgeComposerTest is FheForgeTestHelper {
    FheForgeComposer public composer;
    StrategyRegistry public registry;
    MockERC20 public collateralToken;
    MockERC20 public repayToken;

    address public owner = makeAddr("owner");
    address public user = makeAddr("user");
    address public recipient = makeAddr("recipient");

    address internal constant VAULT_MOCK = address(0x100);
    address internal constant POOL_MOCK = address(0x200);
    address internal constant ROUTER_MOCK = address(0x300);

    /// @dev Helper to deploy a real VaultMock at the VAULT_MOCK address.
    function _deployVaultMock(bytes32 posId) internal {
        VaultMock v = new VaultMock(posId);
        vm.etch(VAULT_MOCK, address(v).code);
        vm.store(VAULT_MOCK, bytes32(0), bytes32(posId));
    }

    /// @dev Helper to deploy a real PoolMock at the POOL_MOCK address.
    function _deployPoolMock() internal {
        PoolMock p = new PoolMock();
        vm.etch(POOL_MOCK, address(p).code);
    }

    /// @dev Helper to deploy a real RouterMock at the ROUTER_MOCK address.
    function _deployRouterMock(bytes32 intentId) internal {
        RouterMock r = new RouterMock(intentId);
        vm.etch(ROUTER_MOCK, address(r).code);
        vm.store(ROUTER_MOCK, bytes32(0), bytes32(intentId));
    }

    /// @dev Set the VaultMock's openPosition return value at the constant address.
    function _setVaultMockPosId(bytes32 posId) internal {
        vm.store(VAULT_MOCK, bytes32(0), bytes32(posId));
    }

    /// @dev Helper to compute FHE handle and pre-store a mock value.
    function _mockEncryptedValue(
        uint256 ctHash,
        uint8 utype,
        int32 securityZone,
        uint256 value
    ) internal {
        uint256 hashMask = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF0000;
        uint256 uintTypeMask = 0x7F;
        uint256 handle =
            (ctHash & hashMask) |
                ((utype & uintTypeMask) << 8) |
                (uint256(uint32(securityZone)) & 0xFF);
        MockTaskManager(getTaskManagerAddress()).MOCK_setInEuintKey(handle, value);
    }

    function setUp() public {
        _deployFheMocks();

        _mockEncryptedValue(uint256(keccak256("collateral")), 6, 0, 1_000_000 ether);
        _mockEncryptedValue(uint256(keccak256("supply")), 6, 0, 0);
        _mockEncryptedValue(uint256(keccak256("borrow")), 6, 0, 0);
        _mockEncryptedValue(uint256(keccak256("repay")), 6, 0, 0);
        _mockEncryptedValue(uint256(keccak256("addCollateral")), 6, 0, 0);

        _deployVaultMock(bytes32(0));
        _deployPoolMock();
        _deployRouterMock(bytes32(0));

        vm.startPrank(owner);
        registry = new StrategyRegistry(1 days);

        collateralToken = new MockERC20("Collateral", "COL", 18);
        collateralToken.mint(user, 1_000_000 ether);
        collateralToken.mint(address(this), 1_000_000 ether);

        repayToken = new MockERC20("Repay Token", "REP", 18);
        repayToken.mint(user, 1_000_000 ether);

        composer = new FheForgeComposer(address(registry), VAULT_MOCK, POOL_MOCK, ROUTER_MOCK);
        vm.stopPrank();
    }

    function testConstructorSetsParams() public view {
        assertEq(composer.owner(), owner);
        assertEq(address(composer.REGISTRY()), address(registry));
        assertEq(address(composer.VAULT()), VAULT_MOCK);
        assertEq(address(composer.POOL()), POOL_MOCK);
        assertEq(address(composer.ROUTER()), ROUTER_MOCK);
    }

    function testConstructorRevertsOnZeroRegistry() public {
        vm.prank(owner);
        vm.expectRevert(FheForgeBase.ZeroAddress.selector);
        new FheForgeComposer(address(0), VAULT_MOCK, POOL_MOCK, ROUTER_MOCK);
    }

    function testConstructorRevertsOnZeroVault() public {
        vm.prank(owner);
        vm.expectRevert(FheForgeBase.ZeroAddress.selector);
        new FheForgeComposer(address(registry), address(0), POOL_MOCK, ROUTER_MOCK);
    }

    function testConstructorRevertsOnZeroPool() public {
        vm.prank(owner);
        vm.expectRevert(FheForgeBase.ZeroAddress.selector);
        new FheForgeComposer(address(registry), VAULT_MOCK, address(0), ROUTER_MOCK);
    }

    function testConstructorRevertsOnZeroRouter() public {
        vm.prank(owner);
        vm.expectRevert(FheForgeBase.ZeroAddress.selector);
        new FheForgeComposer(address(registry), VAULT_MOCK, POOL_MOCK, address(0));
    }

    function testOpenPositionMinimal() public {
        uint256 amount = 100 ether;

        // Pre-store collateral matching claimed amount so _verifyEquality passes
        _mockEncryptedValue(uint256(keccak256("collateral")), 6, 0, amount);

        vm.startPrank(user);
        collateralToken.approve(address(composer), amount);

        // Set VaultMock return value
        bytes32 expectedPosId = keccak256("mock-position");
        _setVaultMockPosId(expectedPosId);

        // Build encrypted params
        FheForgeComposer.OpenStrategyEncrypted memory e = FheForgeComposer.OpenStrategyEncrypted({
            collateral: InEuint128({
                ctHash: uint256(keccak256("collateral")),
                securityZone: 0,
                utype: 6,
                signature: ""
            }),
            supplyEnc: InEuint128({
                ctHash: uint256(keccak256("supply")),
                securityZone: 0,
                utype: 6,
                signature: ""
            }),
            borrowEnc: InEuint128({
                ctHash: uint256(keccak256("borrow")),
                securityZone: 0,
                utype: 6,
                signature: ""
            })
        });

        // Build strategy params
        FheForgeComposer.OpenStrategyParams memory p = FheForgeComposer.OpenStrategyParams({
            strategyName: "test-strategy",
            workflowHash: keccak256("workflow"),
            collateralAmount: amount,
            poolSupplyAmount: 0,
            poolBorrowAmount: 0,
            swapDeadlineOffset: 0,
            strategyId: 0,
            swapAmountIn: 0,
            swapMinOut: 0,
            collateralToken: address(collateralToken),
            borrowToken: address(0),
            swapTokenOut: address(0),
            ltvNum: 0,
            ltvDen: 0,
            useOracleBorrow: false,
            apyTarget: 500,
            loopCount: 1
        });

        (uint256 strategyId, bytes32 intentId) = composer.openPosition(p, e);

        assertEq(strategyId, 1);
        assertTrue(strategyId > 0);
        assertEq(intentId, bytes32(0));
        vm.stopPrank();
    }

    function testOpenPositionRevertsWhenPaused() public {
        vm.prank(owner);
        composer.pause();

        FheForgeComposer.OpenStrategyParams memory p;
        FheForgeComposer.OpenStrategyEncrypted memory e;

        vm.prank(user);
        vm.expectRevert();
        composer.openPosition(p, e);
    }

    function testOpenPositionWithSwap() public {
        uint256 amount = 100 ether;
        uint256 borrowAmount = 50 ether;

        // Pre-store collateral matching claimed amount so _verifyEquality passes
        _mockEncryptedValue(uint256(keccak256("collateral")), 6, 0, amount);

        vm.startPrank(user);
        collateralToken.approve(address(composer), amount + borrowAmount);

        _setVaultMockPosId(keccak256("pos"));

        bytes32 expectedIntentId = keccak256("swap-intent");
        vm.store(ROUTER_MOCK, bytes32(0), bytes32(expectedIntentId));

        FheForgeComposer.OpenStrategyEncrypted memory e = FheForgeComposer.OpenStrategyEncrypted({
            collateral: InEuint128({
                ctHash: uint256(keccak256("collateral")),
                securityZone: 0,
                utype: 6,
                signature: ""
            }),
            supplyEnc: InEuint128({
                ctHash: uint256(keccak256("supply")),
                securityZone: 0,
                utype: 6,
                signature: ""
            }),
            borrowEnc: InEuint128({
                ctHash: uint256(keccak256("borrow")),
                securityZone: 0,
                utype: 6,
                signature: ""
            })
        });

        FheForgeComposer.OpenStrategyParams memory p = FheForgeComposer.OpenStrategyParams({
            strategyName: "swap-strategy",
            workflowHash: keccak256("swap-workflow"),
            collateralAmount: amount,
            poolSupplyAmount: 0,
            poolBorrowAmount: borrowAmount,
            swapDeadlineOffset: 3600,
            strategyId: 0,
            swapAmountIn: borrowAmount,
            swapMinOut: 1 ether,
            collateralToken: address(collateralToken),
            borrowToken: address(collateralToken),
            swapTokenOut: address(0xBBB),
            ltvNum: 0,
            ltvDen: 0,
            useOracleBorrow: false,
            apyTarget: 500,
            loopCount: 1
        });

        (uint256 strategyId, bytes32 intentId) = composer.openPosition(p, e);

        assertEq(strategyId, 1);
        assertTrue(intentId != bytes32(0));
        vm.stopPrank();
    }

    function testOpenPositionSupplyOnly() public {
        uint256 amount = 100 ether;

        // Pre-store the supply value to match the test's claimed amount
        _mockEncryptedValue(uint256(keccak256("supply")), 6, 0, amount);

        vm.startPrank(user);
        collateralToken.approve(address(composer), amount);

        _setVaultMockPosId(keccak256("pos"));

        FheForgeComposer.OpenStrategyEncrypted memory e = FheForgeComposer.OpenStrategyEncrypted({
            collateral: InEuint128({
                ctHash: uint256(keccak256("collateral")),
                securityZone: 0,
                utype: 6,
                signature: ""
            }),
            supplyEnc: InEuint128({
                ctHash: uint256(keccak256("supply")),
                securityZone: 0,
                utype: 6,
                signature: ""
            }),
            borrowEnc: InEuint128({
                ctHash: uint256(keccak256("borrow")),
                securityZone: 0,
                utype: 6,
                signature: ""
            })
        });

        FheForgeComposer.OpenStrategyParams memory p = FheForgeComposer.OpenStrategyParams({
            strategyName: "supply-strategy",
            workflowHash: keccak256("workflow"),
            collateralAmount: 0,
            poolSupplyAmount: amount,
            poolBorrowAmount: 0,
            swapDeadlineOffset: 0,
            strategyId: 0,
            swapAmountIn: 0,
            swapMinOut: 0,
            collateralToken: address(collateralToken),
            borrowToken: address(0),
            swapTokenOut: address(0),
            ltvNum: 0,
            ltvDen: 0,
            useOracleBorrow: false,
            apyTarget: 500,
            loopCount: 1
        });

        (uint256 strategyId, ) = composer.openPosition(p, e);
        assertEq(strategyId, 1);
        vm.stopPrank();
    }

    function testOpenPositionWithExistingStrategyId() public {
        uint256 amount = 100 ether;

        // Pre-store collateral matching claimed amount so _verifyEquality passes
        _mockEncryptedValue(uint256(keccak256("collateral")), 6, 0, amount);

        vm.startPrank(user);
        collateralToken.approve(address(composer), amount);

        vm.stopPrank();
        vm.prank(owner);
        registry.registerStrategy("pre-registered", keccak256("wf"), 500, 1);
        vm.startPrank(user);

        _setVaultMockPosId(keccak256("pos"));

        FheForgeComposer.OpenStrategyEncrypted memory e = FheForgeComposer.OpenStrategyEncrypted({
            collateral: InEuint128({
                ctHash: uint256(keccak256("collateral")),
                securityZone: 0,
                utype: 6,
                signature: ""
            }),
            supplyEnc: InEuint128({
                ctHash: uint256(keccak256("supply")),
                securityZone: 0,
                utype: 6,
                signature: ""
            }),
            borrowEnc: InEuint128({
                ctHash: uint256(keccak256("borrow")),
                securityZone: 0,
                utype: 6,
                signature: ""
            })
        });

        FheForgeComposer.OpenStrategyParams memory p = FheForgeComposer.OpenStrategyParams({
            strategyName: "",
            workflowHash: bytes32(0),
            collateralAmount: amount,
            poolSupplyAmount: 0,
            poolBorrowAmount: 0,
            swapDeadlineOffset: 0,
            strategyId: 1, // existing strategy
            swapAmountIn: 0,
            swapMinOut: 0,
            collateralToken: address(collateralToken),
            borrowToken: address(0),
            swapTokenOut: address(0),
            ltvNum: 0,
            ltvDen: 0,
            useOracleBorrow: false,
            apyTarget: 0,
            loopCount: 0
        });

        (uint256 strategyId, ) = composer.openPosition(p, e);
        assertEq(strategyId, 1);
        vm.stopPrank();
    }

    function testRebalanceAddCollateral() public {
        uint256 addAmount = 50 ether;
        bytes32 positionId = keccak256("position");

        _mockEncryptedValue(uint256(keccak256("addCollateral")), 6, 0, addAmount);

        vm.startPrank(user);
        collateralToken.approve(address(composer), addAmount);

        FheForgeComposer.RebalanceEncrypted memory e = FheForgeComposer.RebalanceEncrypted({
            addCollateralEnc: InEuint128({
                ctHash: uint256(keccak256("addCollateral")),
                securityZone: 0,
                utype: 6,
                signature: ""
            }),
            repayEnc: InEuint128({
                ctHash: uint256(keccak256("repay")),
                securityZone: 0,
                utype: 6,
                signature: ""
            }),
            newBorrowEnc: InEuint128({
                ctHash: uint256(keccak256("borrow")),
                securityZone: 0,
                utype: 6,
                signature: ""
            })
        });

        FheForgeComposer.RebalanceParams memory p = FheForgeComposer.RebalanceParams({
            positionId: positionId,
            collateralToken: address(collateralToken),
            addCollateralAmount: addAmount,
            repayAmount: 0,
            repayToken: address(0),
            newBorrowAmount: 0,
            borrowToken: address(0),
            useOracleBorrow: false,
            ltvNum: 0,
            ltvDen: 0
        });

        composer.rebalance(p, e);
        vm.stopPrank();
    }

    function testRebalanceRepayAndBorrow() public {
        address borrowToken = address(0xDEF);

        uint256 repayAmount = 100 ether;
        uint256 newBorrowAmount = 50 ether;

        _mockEncryptedValue(uint256(keccak256("repay")), 6, 0, repayAmount);
        _mockEncryptedValue(uint256(keccak256("borrow")), 6, 0, newBorrowAmount);

        vm.startPrank(user);
        repayToken.approve(address(composer), repayAmount);

        FheForgeComposer.RebalanceEncrypted memory e = FheForgeComposer.RebalanceEncrypted({
            addCollateralEnc: InEuint128({
                ctHash: uint256(keccak256("addCollateral")),
                securityZone: 0,
                utype: 6,
                signature: ""
            }),
            repayEnc: InEuint128({
                ctHash: uint256(keccak256("repay")),
                securityZone: 0,
                utype: 6,
                signature: ""
            }),
            newBorrowEnc: InEuint128({
                ctHash: uint256(keccak256("borrow")),
                securityZone: 0,
                utype: 6,
                signature: ""
            })
        });

        FheForgeComposer.RebalanceParams memory p = FheForgeComposer.RebalanceParams({
            positionId: keccak256("pos"),
            collateralToken: address(collateralToken),
            addCollateralAmount: 0,
            repayAmount: repayAmount,
            repayToken: address(repayToken),
            newBorrowAmount: newBorrowAmount,
            borrowToken: borrowToken,
            useOracleBorrow: false,
            ltvNum: 0,
            ltvDen: 0
        });

        composer.rebalance(p, e);
        vm.stopPrank();
    }

    function testRebalanceRevertsWhenPaused() public {
        vm.prank(owner);
        composer.pause();

        FheForgeComposer.RebalanceParams memory p;
        FheForgeComposer.RebalanceEncrypted memory e;

        vm.prank(user);
        vm.expectRevert();
        composer.rebalance(p, e);
    }

    function testSweepToken() public {
        vm.prank(owner);
        collateralToken.mint(address(composer), 100 ether);

        vm.prank(owner);
        composer.sweepToken(address(collateralToken), recipient);

        assertEq(collateralToken.balanceOf(recipient), 100 ether);
    }

    function testSweepTokenRevertsOnNonOwner() public {
        vm.prank(user);
        vm.expectRevert();
        composer.sweepToken(address(collateralToken), recipient);
    }

    function testSweepTokenRevertsOnZeroToken() public {
        vm.prank(owner);
        vm.expectRevert(FheForgeBase.ZeroAddress.selector);
        composer.sweepToken(address(0), recipient);
    }

    function testSweepTokenRevertsOnZeroRecipient() public {
        vm.prank(owner);
        vm.expectRevert(FheForgeBase.ZeroAddress.selector);
        composer.sweepToken(address(collateralToken), address(0));
    }

    function testSweepTokenNoBalance() public {
        vm.prank(owner);
        composer.sweepToken(address(collateralToken), recipient);
    }

    function testTransferOwnership() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(owner);
        composer.transferOwnership(newOwner);

        vm.prank(newOwner);
        composer.acceptOwnership();

        assertEq(composer.owner(), newOwner);
    }

    function testOnlyOwnerPause() public {
        vm.prank(user);
        vm.expectRevert();
        composer.pause();
    }

    function testPauseByOwner() public {
        vm.prank(owner);
        composer.pause();
        assertTrue(composer.paused());
    }

    function testUnpauseByOwner() public {
        vm.prank(owner);
        composer.pause();
        vm.prank(owner);
        composer.unpause();
        assertFalse(composer.paused());
    }

    function testOpenPositionNoCollateralNoSupply() public {
        FheForgeComposer.OpenStrategyEncrypted memory e = FheForgeComposer.OpenStrategyEncrypted({
            collateral: InEuint128({
                ctHash: uint256(keccak256("collateral")),
                securityZone: 0,
                utype: 6,
                signature: ""
            }),
            supplyEnc: InEuint128({
                ctHash: uint256(keccak256("supply")),
                securityZone: 0,
                utype: 6,
                signature: ""
            }),
            borrowEnc: InEuint128({
                ctHash: uint256(keccak256("borrow")),
                securityZone: 0,
                utype: 6,
                signature: ""
            })
        });

        FheForgeComposer.OpenStrategyParams memory p = FheForgeComposer.OpenStrategyParams({
            strategyName: "zero",
            workflowHash: keccak256("wf"),
            collateralAmount: 0,
            poolSupplyAmount: 0,
            poolBorrowAmount: 0,
            swapDeadlineOffset: 0,
            strategyId: 0,
            swapAmountIn: 0,
            swapMinOut: 0,
            collateralToken: address(collateralToken),
            borrowToken: address(0),
            swapTokenOut: address(0),
            ltvNum: 0,
            ltvDen: 0,
            useOracleBorrow: false,
            apyTarget: 500,
            loopCount: 1
        });

        vm.prank(user);
        (uint256 strategyId, ) = composer.openPosition(p, e);
        assertEq(strategyId, 1);
    }
}
