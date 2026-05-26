// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";

contract FheForgeTimelock is TimelockController {
    constructor(
        address admin
    )
        TimelockController(
            2 days /* minDelay */,
            new address[](0) /* proposers — set after governor deployed */,
            new address[](0) /* executors — anyone */,
            admin
        )
    {}
}
