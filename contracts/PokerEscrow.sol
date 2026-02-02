// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title PokerEscrow
 * @dev Escrow contract for Mitsuki's Room poker game
 * Players deposit USDC, game runs off-chain, settlements happen on-chain
 */
contract PokerEscrow is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // Roles
    bytes32 public constant DEALER_ROLE = keccak256("DEALER_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    // USDC contract on Base
    IERC20 public immutable USDC;
    
    // Minimum and maximum deposit amounts (6 decimals for USDC)
    uint256 public constant MIN_DEPOSIT = 1_000_000; // $1.00
    uint256 public constant MAX_DEPOSIT = 10_000_000_000; // $10,000.00
    
    // Player balances
    mapping(address => uint256) public playerBalances;
    
    // Game settlement tracking
    mapping(bytes32 => bool) public settledGames;
    
    // Events
    event Deposit(address indexed player, uint256 amount, uint256 newBalance);
    event Withdrawal(address indexed player, uint256 amount, uint256 newBalance);
    event GameSettlement(bytes32 indexed gameId, address[] winners, uint256[] amounts);
    event EmergencyWithdrawal(address indexed player, uint256 amount);
    
    /**
     * @dev Constructor
     * @param _usdc Address of USDC token on Base
     * @param _dealer Address that can trigger game settlements
     */
    constructor(address _usdc, address _dealer, address _admin) {
        require(_usdc != address(0), "Invalid USDC address");
        require(_dealer != address(0), "Invalid dealer address");
        require(_admin != address(0), "Invalid admin address");
        
        USDC = IERC20(_usdc);
        
        // Grant roles
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(DEALER_ROLE, _dealer);
        _grantRole(EMERGENCY_ROLE, _admin);
    }
    
    /**
     * @dev Deposit USDC to play poker
     * @param amount Amount of USDC to deposit (6 decimals)
     */
    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        require(amount >= MIN_DEPOSIT, "Deposit too small");
        require(amount <= MAX_DEPOSIT, "Deposit too large");
        
        // Transfer USDC from player to contract
        USDC.safeTransferFrom(msg.sender, address(this), amount);
        
        // Update player balance
        playerBalances[msg.sender] += amount;
        
        emit Deposit(msg.sender, amount, playerBalances[msg.sender]);
    }
    
    /**
     * @dev Withdraw USDC from poker balance
     * @param amount Amount to withdraw
     */
    function withdraw(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "Amount must be positive");
        require(playerBalances[msg.sender] >= amount, "Insufficient balance");
        
        // Update balance first (CEI pattern)
        playerBalances[msg.sender] -= amount;
        
        // Transfer USDC to player
        USDC.safeTransfer(msg.sender, amount);
        
        emit Withdrawal(msg.sender, amount, playerBalances[msg.sender]);
    }
    
    /**
     * @dev Settle a poker game (only dealer can call)
     * @param gameId Unique game identifier
     * @param winners Array of winner addresses
     * @param amounts Array of amounts each winner receives
     */
    function settleGame(
        bytes32 gameId,
        address[] calldata winners,
        uint256[] calldata amounts
    ) external onlyRole(DEALER_ROLE) nonReentrant whenNotPaused {
        require(!settledGames[gameId], "Game already settled");
        require(winners.length == amounts.length, "Array length mismatch");
        require(winners.length > 0, "No winners specified");
        
        settledGames[gameId] = true;
        
        uint256 totalPayout = 0;
        
        // Process each winner
        for (uint256 i = 0; i < winners.length; i++) {
            require(winners[i] != address(0), "Invalid winner address");
            require(amounts[i] > 0, "Invalid amount");
            
            totalPayout += amounts[i];
            playerBalances[winners[i]] += amounts[i];
        }
        
        // Ensure we have enough funds (this should always be true if game logic is correct)
        require(USDC.balanceOf(address(this)) >= totalPayout, "Insufficient contract funds");
        
        emit GameSettlement(gameId, winners, amounts);
    }
    
    /**
     * @dev Emergency withdrawal in case contract needs to be paused
     * @param player Player to withdraw for
     */
    function emergencyWithdraw(address player) external onlyRole(EMERGENCY_ROLE) {
        require(paused(), "Not in emergency mode");
        
        uint256 balance = playerBalances[player];
        require(balance > 0, "No balance to withdraw");
        
        playerBalances[player] = 0;
        USDC.safeTransfer(player, balance);
        
        emit EmergencyWithdrawal(player, balance);
    }
    
    /**
     * @dev Pause contract (emergency only)
     */
    function pause() external onlyRole(EMERGENCY_ROLE) {
        _pause();
    }
    
    /**
     * @dev Unpause contract
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
    
    /**
     * @dev Get player's current balance
     * @param player Player address
     * @return Player's USDC balance in escrow
     */
    function getBalance(address player) external view returns (uint256) {
        return playerBalances[player];
    }
    
    /**
     * @dev Get total contract USDC balance
     * @return Total USDC held in contract
     */
    function getTotalBalance() external view returns (uint256) {
        return USDC.balanceOf(address(this));
    }
    
    /**
     * @dev Check if a game has been settled
     * @param gameId Game identifier
     * @return True if game has been settled
     */
    function isGameSettled(bytes32 gameId) external view returns (bool) {
        return settledGames[gameId];
    }
}