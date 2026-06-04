// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TASK_MANAGER_ADDRESS} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {ITaskManager} from "@fhenixprotocol/cofhe-contracts/ICofhe.sol";
import {MockACL} from "@cofhe/mock-contracts/contracts/MockACL.sol";
import {MockTaskManager} from "@cofhe/mock-contracts/contracts/MockTaskManager.sol";
import {TokenRegistry} from "../contracts/TokenRegistry.sol";
import {StrategyRegistry} from "../contracts/StrategyRegistry.sol";
import {SwapRouter} from "../contracts/SwapRouter.sol";

contract TestHelper is Test {
    TokenRegistry internal tokenReg;
    StrategyRegistry internal stratReg;
    SwapRouter internal router;

    address internal owner = address(this);
    address internal user1 = address(0x1001);
    address internal user2 = address(0x1002);
    address internal token1 = address(0x2001);
    address internal token2 = address(0x2002);
    address internal token3 = address(0x2003);

    function _deployFheMocks() internal {
        // Deploy MockACL at a fresh address
        MockACL mockAcl = new MockACL();

        // Deploy MockTaskManager (constructor does nothing)
        MockTaskManager mockTm = new MockTaskManager();

        // Copy its runtime bytecode to the hardcoded TASK_MANAGER_ADDRESS
        bytes memory tmCode = address(mockTm).code;
        vm.etch(TASK_MANAGER_ADDRESS, tmCode);

        // Initialize the task manager at the expected address
        MockTaskManager(TASK_MANAGER_ADDRESS).initialize(address(this));
        MockTaskManager(TASK_MANAGER_ADDRESS).setACLContract(address(mockAcl));
        MockTaskManager(TASK_MANAGER_ADDRESS).setVerifierSigner(address(0));
    }

    function setUp() public {
        _deployFheMocks();

        tokenReg = new TokenRegistry();
        stratReg = new StrategyRegistry(172800);
        router = new SwapRouter(
            address(0xBEEF),          // executor (non-zero)
            300,                       // minDeadlineOffset (300s)
            3600,                      // maxDeadlineOffset (3600s)
            172800,                    // executorRotationDelay
            address(0xCAFE)            // uniswapV3Router (non-zero)
        );
    }

    /// @dev Helper to build a TokenInfo struct with sane defaults.
    function _makeTokenInfo(
        address token,
        uint16 ltvBps,
        uint16 liqBonusBps,
        bool isLendable,
        bool isBorrowable,
        bool isCollateral
    ) internal pure returns (TokenRegistry.TokenInfo memory) {
        return TokenRegistry.TokenInfo({
            token: token,
            ltvBps: ltvBps,
            liquidationBonusBps: liqBonusBps,
            decimals: 18,
            isLendable: isLendable,
            isBorrowable: isBorrowable,
            isCollateral: isCollateral,
            enabled: true,
            pythPriceId: bytes32(uint256(1)),
            borrowCap: 1e18,
            supplyCap: 1e18
        });
    }
}
