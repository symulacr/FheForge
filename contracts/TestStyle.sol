// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract test_contract {
    uint private x;
    uint y;
    
    function TEST_FUNC(uint a) public pure returns (uint) {
        assembly {
            let z := a
        }
        return a;
    }
    
    function longLine() public pure {
        // This is a very long line that should definitely exceed the maximum line length limit of one hundred and thirty characters per line which is quite generous for solidity code
    }
}
