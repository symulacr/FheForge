// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";

contract FheForgeTimelock is TimelockController {
    constructor(
        uint256 minDelay,
        address admin
    )
        TimelockController(
            minDelay,
            new address[](0) /* proposers — set after governor deployed */,
            new address[](0) /* executors — anyone */,
            admin
        )
    {}
}
