const { ethers } = require('ethers');
require('dotenv').config();

// All secrets from environment — NEVER hardcode
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL || 'https://mainnet.base.org';
const USDC_ADDRESS = process.env.USDC_ADDRESS || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

if (!PRIVATE_KEY) {
    console.error('❌ PRIVATE_KEY not set. Add it to .env file.');
    process.exit(1);
}

const fs = require('fs');

async function deploy() {
    console.log('🌙 Deploying MitsukiEscrow to Base...\n');

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    console.log(`Deployer: ${wallet.address}`);
    const bal = await provider.getBalance(wallet.address);
    console.log(`ETH: ${ethers.formatEther(bal)}\n`);

    if (bal === 0n) {
        console.error('❌ No ETH for gas. Fund the wallet first.');
        process.exit(1);
    }

    const abi = JSON.parse(fs.readFileSync('contracts/MitsukiEscrow_sol_MitsukiEscrow.abi', 'utf8'));
    const bytecode = '0x' + fs.readFileSync('contracts/MitsukiEscrow_sol_MitsukiEscrow.bin', 'utf8').trim();

    console.log('Deploying...');
    const factory = new ethers.ContractFactory(abi, bytecode, wallet);
    const contract = await factory.deploy(USDC_ADDRESS, wallet.address, wallet.address);

    console.log(`Tx: ${contract.deploymentTransaction()?.hash}`);
    await contract.waitForDeployment();
    const addr = await contract.getAddress();

    console.log(`\n🌙 DEPLOYED: ${addr}`);
    console.log(`BaseScan: https://basescan.org/address/${addr}`);

    fs.writeFileSync('contracts/deployment.json', JSON.stringify({
        contract: addr,
        tx: contract.deploymentTransaction()?.hash,
        network: 'base-mainnet',
        deployer: wallet.address,
        timestamp: new Date().toISOString()
    }, null, 2));

    console.log('Saved to contracts/deployment.json');
}

deploy().catch(e => { console.error('❌', e.message); process.exit(1); });
