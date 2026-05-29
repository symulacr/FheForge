// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Governor } from "@openzeppelin/contracts/governance/Governor.sol";
import { GovernorSettings } from "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import { GovernorCountingSimple } from "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import { GovernorVotes } from "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import { GovernorVotesQuorumFraction } from "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import { GovernorTimelockControl } from "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";
import { IVotes } from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";

contract FheForgeGovernor is
    Governor,
    GovernorSettings,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    GovernorTimelockControl
{
    /// @dev 100 tokens threshold for proposal creation
    uint256 public constant PROPOSAL_THRESHOLD = 100e18;

    // GovernorSettings handles _votingDelay, _votingPeriod, _proposalThreshold internally

    constructor(
        IVotes token,
        TimelockController timelock,
        uint48 votingDelay_,
        uint48 votingPeriod_,
        uint256 quorumBps
    )
        Governor("FheForge Governor")
        GovernorSettings(uint48(votingDelay_), uint32(votingPeriod_), PROPOSAL_THRESHOLD)
        GovernorVotes(token)
        GovernorVotesQuorumFraction(quorumBps)
        GovernorTimelockControl(timelock)
    {}

    // Governor: must override due to conflict with GovernorTimelockControl
    function state(
        uint256 proposalId
    ) public view override(Governor, GovernorTimelockControl) returns (ProposalState state_) {
        return super.state(proposalId);
    }

    // GovernorTimelockControl: must override due to conflict with Governor
    function proposalNeedsQueuing(
        uint256 proposalId
    ) public view override(Governor, GovernorTimelockControl) returns (bool needsQueue) {
        return super.proposalNeedsQueuing(proposalId);
    }

    // GovernorTimelockControl: must override due to conflict with Governor
    function _queueOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint48 scheduledAt) {
        return super._queueOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    // GovernorTimelockControl: must override due to conflict with Governor
    function _executeOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) {
        super._executeOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    // GovernorTimelockControl: must override due to conflict with Governor
    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint256 proposalId) {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    // GovernorTimelockControl: must override due to conflict with Governor
    function _executor()
        internal
        view
        override(Governor, GovernorTimelockControl)
        returns (address executor_)
    {
        return super._executor();
    }

    // Governor + GovernorSettings both define proposalThreshold — must override explicitly
    function proposalThreshold()
        public
        pure
        override(Governor, GovernorSettings)
        returns (uint256 threshold)
    {
        return PROPOSAL_THRESHOLD;
    }

    // GovernorSettings provides votingDelay, votingPeriod, proposalThreshold automatically
}
