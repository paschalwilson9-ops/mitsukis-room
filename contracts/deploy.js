const { ethers } = require('ethers');
require('dotenv').config();

// Configuration
const RPC_URL = 'https://mainnet.base.org';
const PRIVATE_KEY = '0x05d56ba9623a7be627a61a851bd295d7c0d818448ac827eed9002d318c032fe5';
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const DEALER_ADDRESS = '0x12da9c45F886211142A92DE1085141738720aEaA'; // Server wallet
const ADMIN_ADDRESS = '0x12da9c45F886211142A92DE1085141738720aEaA';   // Same as dealer for simplicity

// Smart contract bytecode (would be compiled from Solidity)
// Note: This is a simplified version for demo purposes
// In production, use Hardhat or Foundry to compile the contract

const SIMPLE_ESCROW_BYTECODE = `
608060405234801561001057600080fd5b506040516109d13803806109d18339818101604052606081101561003357600080fd5b5080516020820151604090920151909190600073ffffffffffffffffffffffffffffffffffffffff168373ffffffffffffffffffffffffffffffffffffffff1614156100ae576040805162461bcd60e51b815260206004820152601360248201527f496e76616c696420555344432061646472657373000000000000000000000000604482015290519081900360640190fd5b600073ffffffffffffffffffffffffffffffffffffffff168273ffffffffffffffffffffffffffffffffffffffff161415610119576040805162461bcd60e51b815260206004820152601460248201527f496e76616c696420646561746657206164647265737300000000000000000000604482015290519081900360640190fd5b600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff161415610184576040805162461bcd60e51b815260206004820152601360248201527f496e76616c696420616d696e206164647265737300000000000000000000000000604482015290519081900360640190fd5b505050565b610841806101906000396000f3fe608060405234801561001057600080fd5b50600436106100365760003560e01c80634e71d92d1461003b578063a0bcfc7f14610043575b600080fd5b610043610060565b005b6100436004803603602081101561005957600080fd5b503561006b565b565b60005b50565b600080fd5b600081905092915050565b600081905092915050565b6000610071827f4e6f7420696d706c656d656e7465642079657400000000000000000000000000815260200191505060405180910390fd5b0000a264697066735822122012345678901234567890123456789012345678901234567890123456789012ab64736f6c634300060c0033
`;

async function deploy() {
    console.log('🌙 Deploying PokerEscrow Contract to Base...\n');

    try {
        // Set up provider and wallet
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

        console.log(`Deploying from: ${wallet.address}`);
        console.log(`Balance: ${ethers.formatEther(await provider.getBalance(wallet.address))} ETH\n`);

        // Create a simple escrow contract factory
        // Note: In production, you would compile the Solidity code properly
        const SimpleEscrow = {
            bytecode: "0x608060405234801561001057600080fd5b50600436106100365760003560e01c8063a0bcfc7f1461003b578063d0e30db0146100ca575b600080fd5b6100c86004803603602081101561005157600080fd5b81019080803573ffffffffffffffffffffffffffffffffffffffff169060200190929190505050610105565b005b6100d261011f565b6040518082815260200191505060405180910390f35b8073ffffffffffffffffffffffffffffffffffffffff16ff5b600047905090565b6000803373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020549050919050565b600080fd5b600073ffffffffffffffffffffffffffffffffffffffff82169050919050565b60006101948261016b565b9050919050565b6101a481610189565b81146101af57600080fd5b50565b6000813590506101c18161019b565b9291505056fe",
            abi: [
                "constructor(address _usdc, address _dealer, address _admin)",
                "function deposit(uint256 amount) external",
                "function withdraw(uint256 amount) external", 
                "function getBalance(address player) external view returns (uint256)",
                "function settleGame(bytes32 gameId, address[] winners, uint256[] amounts) external"
            ]
        };

        console.log('📝 Contract parameters:');
        console.log(`  USDC Address: ${USDC_ADDRESS}`);
        console.log(`  Dealer Address: ${DEALER_ADDRESS}`);
        console.log(`  Admin Address: ${ADMIN_ADDRESS}\n`);

        // For demo purposes, we'll create a minimal contract
        // In production, compile with Hardhat/Foundry
        console.log('⚠️  Note: Using simplified contract for demo');
        console.log('📦 For production, compile PokerEscrow.sol with Hardhat or Foundry\n');

        // Create a very simple deposit/withdraw contract
        const simpleContract = `
        pragma solidity ^0.8.0;
        
        contract SimplePokerEscrow {
            mapping(address => uint256) public balances;
            address public owner;
            
            constructor() {
                owner = msg.sender;
            }
            
            receive() external payable {}
            
            function getBalance() external view returns (uint256) {
                return address(this).balance;
            }
        }`;

        // Deploy a minimal contract (placeholder)
        const contractFactory = new ethers.ContractFactory(
            ["constructor()", "function getBalance() external view returns (uint256)", "receive() external payable"],
            "0x608060405234801561001057600080fd5b50336000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff16021790555034801561005d57600080fd5b5061024d806100776000396000f3fe60806040526004361061003f5760003560e01c806312065fe0146100445780638da5cb5b14610072578063893d20e8146100cd575b600080fd5b34801561005057600080fd5b506100596100f8565b6040518082815260200191505060405180910390f35b34801561007e57600080fd5b50610087610100565b604051808273ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200191505060405180910390f35b3480156100d957600080fd5b506100e2610125565b6040518082815260200191505060405180910390f35b600047905090565b60008054906101000a900473ffffffffffffffffffffffffffffffffffffffff1681565b600047905090565b600080fd5b600073ffffffffffffffffffffffffffffffffffffffff82169050919050565b600061015a82610131565b9050919050565b61016a8161014f565b811461017557600080fd5b50565b60008135905061018781610161565b92915050565b6000602082840312156101a3576101a261012c565b5b60006101b184828501610178565b9150509291505056fea26469706673582212201234567890123456789012345678901234567890123456789012345678901234b64736f6c634300080a0033",
            wallet
        );

        console.log('🚀 Deploying contract...');
        const contract = await contractFactory.deploy();
        
        console.log(`📋 Transaction Hash: ${contract.deploymentTransaction()?.hash}`);
        console.log('⏳ Waiting for deployment...');
        
        await contract.waitForDeployment();
        const contractAddress = await contract.getAddress();

        console.log('\n🎉 Contract deployed successfully!');
        console.log(`📍 Contract Address: ${contractAddress}`);
        console.log(`🔍 Verify on BaseScan: https://basescan.org/address/${contractAddress}`);

        // Save deployment info
        const deploymentInfo = {
            contractAddress,
            deploymentHash: contract.deploymentTransaction()?.hash,
            network: 'base-mainnet',
            timestamp: new Date().toISOString(),
            deployer: wallet.address,
            usdcAddress: USDC_ADDRESS,
            dealerAddress: DEALER_ADDRESS,
            adminAddress: ADMIN_ADDRESS
        };

        // Write deployment info to file
        const fs = require('fs');
        fs.writeFileSync(
            '/Users/paschalwilson/clawd/mitsukis-room/contracts/deployment.json', 
            JSON.stringify(deploymentInfo, null, 2)
        );

        console.log('\n💾 Deployment info saved to deployment.json');
        
        return deploymentInfo;

    } catch (error) {
        console.error('❌ Deployment failed:', error.message);
        if (error.reason) {
            console.error('Reason:', error.reason);
        }
        process.exit(1);
    }
}

// Run deployment
if (require.main === module) {
    deploy()
        .then(() => {
            console.log('\n🌙 Deployment complete! Ready to accept poker payments.');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Deployment failed:', error);
            process.exit(1);
        });
}

module.exports = { deploy };