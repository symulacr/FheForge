// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import { FHE, euint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";

library SharedStrategyMeta {
    struct PositionView {
        euint128 collateral;
        euint128 debt;
    }

    function grantPositionAcl(address caller, euint128 collateral, euint128 debt) internal {
        FHE.allowThis(collateral);
        FHE.allow(collateral, caller);
        FHE.allowThis(debt);
        FHE.allow(debt, caller);
    }

    function grantUpdatedHandle(address caller, euint128 handle) internal {
        FHE.allowThis(handle);
        FHE.allow(handle, caller);

    }
}
