// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import { FHE, euint128, ebool } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { FHESafeMath128 } from "./FHESafeMath128.sol";

library SharedStrategyMeta {
    struct PositionView {
        euint128 collateral;
        euint128 debt;
    }

    /// @dev Grant persistent ACL on position handles: allowThis + allow(caller).
    function grantPositionAcl(address caller, euint128 collateral, euint128 debt) internal {
        FHE.allowThis(collateral);
        FHE.allow(collateral, caller);
        FHE.allowThis(debt);
        FHE.allow(debt, caller);
    }

    /// @dev Grant ACL on a single updated handle: allowThis + allow(caller).
    function grantUpdatedHandle(address caller, euint128 handle) internal {
        FHE.allowThis(handle);
        FHE.allow(handle, caller);
    }

    /// @dev Grant persistent ACL: allowThis + allow(user). Same as grantUpdatedHandle
    ///      but named for clarity on non-position handles.
    function grantAcl(euint128 handle, address user) internal {
        FHE.allowThis(handle);
        FHE.allow(handle, user);
    }

    /// @dev Safe increase with ACL grant. Returns new balance with ACL set.
    function safeIncrease(euint128 stored, euint128 delta, address user) internal returns (euint128) {
        (, euint128 newBalance) = FHESafeMath128.tryIncrease(stored, delta);
        FHE.allowThis(newBalance);
        FHE.allow(newBalance, user);
        return newBalance;
    }

    /// @dev Safe decrease with ACL grant. Returns new balance with ACL set.
    function safeDecrease(euint128 stored, euint128 delta, address user) internal returns (euint128) {
        (, euint128 newBalance) = FHESafeMath128.tryDecrease(stored, delta);
        FHE.allowThis(newBalance);
        FHE.allow(newBalance, user);
        return newBalance;
    }
}
