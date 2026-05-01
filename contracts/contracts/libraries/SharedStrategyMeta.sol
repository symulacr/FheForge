// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import { FHE, euint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title  SharedStrategyMeta
/// @notice FHE-ACL grant helpers for strategy-position metadata. Library
///         functions are `internal` and inlined; the only purpose is to
///         de-duplicate the repeated "allowThis + allow(caller)" pattern.
///         Post F-03 the position only carries `collateral` + `debt` —
///         strategy-level params (apyTarget, loopCount) moved to the
///         registry as plaintext metadata.
library SharedStrategyMeta {
    struct PositionView {
        euint128 collateral;
        euint128 debt;
    }

    /// @notice Grant `this + caller` ACL on both handles of a fresh position.
    function grantPositionAcl(address caller, euint128 collateral, euint128 debt) internal {
        FHE.allowThis(collateral);
        FHE.allow(collateral, caller);
        FHE.allowThis(debt);
        FHE.allow(debt, caller);
    }

    /// @notice Grant `this + caller` ACL on an updated euint128 handle.
    function grantUpdatedHandle(address caller, euint128 handle) internal {
        FHE.allowThis(handle);
        FHE.allow(handle, caller);
    }
}
