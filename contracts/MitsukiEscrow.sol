// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title MitsukiEscrow — Poker escrow for Mitsuki's Room
/// @dev Players deposit USDC, game runs off-chain, dealer settles on-chain
contract MitsukiEscrow {
    IERC20 public immutable usdc;
    address public dealer;
    address public admin;
    bool public paused;

    mapping(address => uint256) public balances;
    mapping(bytes32 => bool) public settled;

    event Deposit(address indexed player, uint256 amount);
    event Withdraw(address indexed player, uint256 amount);
    event Settlement(bytes32 indexed gameId, address winner, uint256 amount);
    event Tip(address indexed from, address indexed to, uint256 amount);

    modifier onlyDealer() {
        require(msg.sender == dealer, "Not dealer");
        _;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Paused");
        _;
    }

    constructor(address _usdc, address _dealer, address _admin) {
        require(_usdc != address(0), "Invalid USDC");
        require(_dealer != address(0), "Invalid dealer");
        require(_admin != address(0), "Invalid admin");
        usdc = IERC20(_usdc);
        dealer = _dealer;
        admin = _admin;
    }

    /// @notice Deposit USDC into the escrow
    function deposit(uint256 amount) external whenNotPaused {
        require(amount > 0, "Zero amount");
        require(usdc.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        balances[msg.sender] += amount;
        emit Deposit(msg.sender, amount);
    }

    /// @notice Withdraw USDC from the escrow
    function withdraw(uint256 amount) external whenNotPaused {
        require(amount > 0, "Zero amount");
        require(balances[msg.sender] >= amount, "Insufficient balance");
        balances[msg.sender] -= amount;
        require(usdc.transfer(msg.sender, amount), "Transfer failed");
        emit Withdraw(msg.sender, amount);
    }

    /// @notice Dealer settles a game — transfer winnings
    function settleGame(
        bytes32 gameId,
        address[] calldata winners,
        uint256[] calldata amounts
    ) external onlyDealer whenNotPaused {
        require(!settled[gameId], "Already settled");
        require(winners.length == amounts.length, "Length mismatch");
        settled[gameId] = true;

        for (uint i = 0; i < winners.length; i++) {
            balances[winners[i]] += amounts[i];
        }
        emit Settlement(gameId, winners[0], amounts[0]);
    }

    /// @notice Tip another address (e.g., tip Mitsuki)
    function tip(address to, uint256 amount) external whenNotPaused {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        balances[msg.sender] -= amount;
        balances[to] += amount;
        emit Tip(msg.sender, to, amount);
    }

    /// @notice Emergency withdraw (admin only, bypasses game logic)
    function emergencyWithdraw(address player) external onlyAdmin {
        uint256 bal = balances[player];
        require(bal > 0, "No balance");
        balances[player] = 0;
        require(usdc.transfer(player, bal), "Transfer failed");
        emit Withdraw(player, bal);
    }

    /// @notice Pause/unpause (admin only)
    function setPaused(bool _paused) external onlyAdmin {
        paused = _paused;
    }

    /// @notice Update dealer address (admin only)
    function setDealer(address _dealer) external onlyAdmin {
        require(_dealer != address(0), "Invalid dealer");
        dealer = _dealer;
    }

    /// @notice Get contract USDC balance
    function totalDeposited() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }
}
