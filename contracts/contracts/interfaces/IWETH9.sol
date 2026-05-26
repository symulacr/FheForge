// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IWETH9 {
    function deposit() external payable;
    function withdraw(uint256) external;
    function balanceOf(address) external view returns (uint256 balance);
    function transfer(address, uint256) external returns (bool ok);
}
