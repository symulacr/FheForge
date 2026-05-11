// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import { Governor } from "@openzeppelin/contracts/governance/Governor.sol";
import { GovernorCountingSimple } from "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import { GovernorVotes } from "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import { GovernorVotesQuorumFraction } from "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import { GovernorTimelockControl } from "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";
import { IVotes } from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";

contract FheForgeGovernor is
    Governor,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    GovernorTimelockControl
{
    /// @dev 100 tokens threshold for proposal creation
    uint256 public constant PROPOSAL_THRESHOLD = 100e18;

    /// @dev 1 day delay before voting starts
    uint256 private _votingDelay;
    /// @dev 3 day voting window
    uint256 private _votingPeriod;

    constructor(IVotes token, TimelockController timelock, uint256 quorumBPS)
        Governor("FheForge Governor")
        GovernorVotes(token)
        GovernorVotesQuorumFraction(quorumBPS)
        GovernorTimelockControl(timelock)
    {
        _votingDelay = 1 days;
        _votingPeriod = 3 days;
    }

    // Governor: must override due to conflict with GovernorTimelockControl
    function state(uint256 proposalId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (ProposalState)
    {
        return super.state(proposalId);
    }

    // GovernorTimelockControl: must override due to conflict with Governor
    function proposalNeedsQueuing(uint256 proposalId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (bool)
    {
        return super.proposalNeedsQueuing(proposalId);
    }

    // GovernorTimelockControl: must override due to conflict with Governor
    function _queueOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    )
        internal
        override(Governor, GovernorTimelockControl)
        returns (uint48)
    {
        return super._queueOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    // GovernorTimelockControl: must override due to conflict with Governor
    function _executeOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    )
        internal
        override(Governor, GovernorTimelockControl)
    {
        super._executeOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    // GovernorTimelockControl: must override due to conflict with Governor
    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    )
        internal
        override(Governor, GovernorTimelockControl)
        returns (uint256 proposalId)
    {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    // GovernorTimelockControl: must override due to conflict with Governor
    function _executor()
        internal
        view
        override(Governor, GovernorTimelockControl)
        returns (address)
    {
        return super._executor();
    }

    // GovernorSettings: manually implement to avoid conflict with Governor.proposalThreshold
    function votingDelay()
        public
        view
        override
        returns (uint256)
    {
        return _votingDelay;
    }

    // GovernorSettings: manually implement to avoid conflict with Governor.proposalThreshold
    function votingPeriod()
        public
        view
        override
        returns (uint256)
    {
        return _votingPeriod;
    }

    // GovernorSettings: manually implement to avoid conflict with Governor.proposalThreshold
    function proposalThreshold()
        public
        view
        override
        returns (uint256)
    {
        return PROPOSAL_THRESHOLD;
    }
}