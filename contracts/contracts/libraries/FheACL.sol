// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { FHE, euint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { FHESafeMath128 } from "./FHESafeMath128.sol";

/// @title FheACL
/// @notice Unified FHE access-control library. Canonical source for all ACL patterns.
library FheACL {
    function grantAccess(euint128 handle, address user) internal {
        FHE.allowThis(handle);
        FHE.allow(handle, user);
    }

    function grantAccessBoth(euint128 handleA, euint128 handleB, address user) internal {
        FHE.allowThis(handleA);
        FHE.allow(handleA, user);
        FHE.allowThis(handleB);
        FHE.allow(handleB, user);
    }

    function grantSelf(euint128 handle) internal {
        FHE.allowThis(handle);
    }

    function grantTransient(euint128 handle, address target) internal {
        FHE.allowTransient(handle, target);
    }

    function makePublic(euint128 handle) internal {
        FHE.allowPublic(handle);
    }

    function grantAccessSelf(euint128 handle) internal {
        FHE.allowThis(handle);
        FHE.allow(handle, msg.sender);
        FHE.allowSender(handle);
    }

    function safeIncrease(euint128 stored, euint128 delta, address user) internal returns (euint128 newBalance) {
        FHE.allowThis(delta);
        (, newBalance) = FHESafeMath128.tryIncrease(stored, delta);
        FHE.allowThis(newBalance);
        FHE.allow(newBalance, user);
    }

    function safeDecrease(euint128 stored, euint128 delta, address user) internal returns (euint128 newBalance) {
        FHE.allowThis(delta);
        (, newBalance) = FHESafeMath128.tryDecrease(stored, delta);
        FHE.allowThis(newBalance);
        FHE.allow(newBalance, user);
    }
}
