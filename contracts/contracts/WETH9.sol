// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract WETH9 {
    error WETH9__InsufficientBalance();
    error WETH9__InsufficientAllowance();
    error WETH9__EthTransferFailed();

    string public name = "Wrapped Ether";
    string public symbol = "WETH";
    uint8 public decimals = 18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Deposit(address indexed dst, uint256 indexed wad);
    event Withdrawal(address indexed src, uint256 indexed wad);
    event Approval(address indexed owner, address indexed spender, uint256 indexed value);
    event Transfer(address indexed from, address indexed to, uint256 indexed value);

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        balanceOf[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    function withdraw(uint256 wad) public {
        if (balanceOf[msg.sender] < wad) revert WETH9__InsufficientBalance();
        balanceOf[msg.sender] -= wad;
        (bool success, ) = payable(msg.sender).call{ value: wad }("");
        if (!success) revert WETH9__EthTransferFailed();
        emit Withdrawal(msg.sender, wad);
    }

    function totalSupply() public view returns (uint256 bal) {
        return address(this).balance;
    }

    function approve(address guy, uint256 wad) public returns (bool ok) {
        allowance[msg.sender][guy] = wad;
        emit Approval(msg.sender, guy, wad);
        return true;
    }

    function transfer(address dst, uint256 wad) public returns (bool ok) {
        return transferFrom(msg.sender, dst, wad);
    }

    function transferFrom(address src, address dst, uint256 wad) public returns (bool ok) {
        if (balanceOf[src] < wad) revert WETH9__InsufficientBalance();
        if (src != msg.sender && allowance[src][msg.sender] != type(uint256).max) {
            if (allowance[src][msg.sender] < wad) revert WETH9__InsufficientAllowance();
            allowance[src][msg.sender] -= wad;
        }
        balanceOf[src] -= wad;
        balanceOf[dst] += wad;
        emit Transfer(src, dst, wad);
        return true;
    }
}
