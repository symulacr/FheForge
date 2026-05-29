// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { FheForgeToken } from "../contracts/governance/FheForgeToken.sol";
import { FheForgeTimelock } from "../contracts/governance/FheForgeTimelock.sol";
import { FheForgeGovernor } from "../contracts/governance/FheForgeGovernor.sol";
import { FheForgeTestHelper } from "./FheForgeTestHelper.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IVotes } from "@openzeppelin/contracts/governance/utils/IVotes.sol";

/// @custom:mock
contract FheForgeGovernorTest is FheForgeTestHelper {
    // Governance parameters matching prod intent.
    // clock() uses block.number (Votes default), so voting delay/period are in blocks.
    uint48  constant VOTING_DELAY  = 0;
    uint32  constant VOTING_PERIOD = 100; // blocks
    uint256 constant QUORUM_BPS    = 100; // 1 % of total supply
    uint256 constant MIN_DELAY     = 2 days;

    FheForgeToken    token;
    FheForgeTimelock timelock;
    FheForgeGovernor governor;

    address voter     = makeAddr("voter");
    address recipient = makeAddr("recipient");
    address attacker  = makeAddr("attacker");

    function setUp() public {
        _deployFheMocks();

        // Deploy governance contracts
        token = new FheForgeToken("FheForge", "FHE");
        timelock = new FheForgeTimelock(MIN_DELAY, address(this));
        governor = new FheForgeGovernor(
            IVotes(address(token)),
            timelock,
            VOTING_DELAY,
            VOTING_PERIOD,
            QUORUM_BPS
        );

        // Governor needs PROPOSER and EXECUTOR roles on the timelock
        bytes32 proposerRole = timelock.PROPOSER_ROLE();
        bytes32 executorRole = timelock.EXECUTOR_ROLE();
        timelock.grantRole(proposerRole, address(governor));
        timelock.grantRole(executorRole, address(governor));

        // Mint voting tokens to a delegator
        token.mint(voter, 1000e18);
    }

    // ---- 1. Token deployment metadata ----

    function testTokenDeploymentMetadata() public view {
        assertEq(token.name(), "FheForge");
        assertEq(token.symbol(), "FHE");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), 1000e18);
        assertEq(token.owner(), address(this));
    }

    // ---- 2. Full governance lifecycle ----

    function testGovernanceFullLifecycle() public {
        // --- Delegate voting power ---
        vm.prank(voter);
        token.delegate(voter);
        // getPastVotes requires timepoint < clock(), and the delegation
        // checkpoint lands at the current block.  Advance one block so
        // propose can query clock()-1 and find it.
        vm.roll(block.number + 1);

        // --- Build a proposal: mint 100 tokens to recipient ---
        address[] memory targets   = new address[](1);
        targets[0]                 = address(token);
        uint256[] memory values    = new uint256[](1);
        values[0]                  = 0;
        bytes[] memory calldatas   = new bytes[](1);
        calldatas[0] = abi.encodeWithSelector(FheForgeToken.mint.selector, recipient, 100e18);
        string memory description  = "Mint 100 tokens to recipient";
        bytes32 descriptionHash    = keccak256(bytes(description));

        // --- Propose ---
        vm.prank(voter);
        uint256 proposalId = governor.propose(targets, values, calldatas, description);

        // --- Vote FOR ---
        vm.prank(voter);
        governor.castVote(proposalId, 1); // 1 = For

        // Advance past the voting period (in blocks) so the proposal
        // transitions to Succeeded and can be queued.
        vm.roll(block.number + VOTING_PERIOD + 1);

        // --- Queue (schedules on the timelock with MIN_DELAY) ---
        governor.queue(targets, values, calldatas, descriptionHash);

        // Advance past the timelock delay (wall-clock seconds).
        vm.warp(block.timestamp + MIN_DELAY + 1);

        // --- Execute ---
        governor.execute{value: 0}(targets, values, calldatas, descriptionHash);

        // --- Verify the proposal's effect ---
        assertEq(token.balanceOf(recipient), 100e18);
    }

    // ---- 3. Only owner can mint ----

    function testOnlyOwnerCanMint() public {
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker)
        );
        token.mint(attacker, 100e18);
    }

    // ---- 4. Timelock delay enforced ----

    function testTimelockDelayEnforced() public {
        // --- Delegate ---
        vm.prank(voter);
        token.delegate(voter);
        vm.roll(block.number + 1);

        // --- Build a proposal ---
        address[] memory targets   = new address[](1);
        targets[0]                 = address(token);
        uint256[] memory values    = new uint256[](1);
        values[0]                  = 0;
        bytes[] memory calldatas   = new bytes[](1);
        calldatas[0] = abi.encodeWithSelector(FheForgeToken.mint.selector, recipient, 100e18);
        string memory description  = "Mint 100 tokens";
        bytes32 descriptionHash    = keccak256(bytes(description));

        // --- Propose and vote ---
        vm.prank(voter);
        uint256 proposalId = governor.propose(targets, values, calldatas, description);
        vm.prank(voter);
        governor.castVote(proposalId, 1);

        // Advance past voting period (blocks)
        vm.roll(block.number + VOTING_PERIOD + 1);

        // Queue (schedules on the timelock with MIN_DELAY)
        governor.queue(targets, values, calldatas, descriptionHash);

        // Attempt to execute BEFORE the timelock delay has elapsed
        vm.expectRevert();
        governor.execute{value: 0}(targets, values, calldatas, descriptionHash);
    }
}
