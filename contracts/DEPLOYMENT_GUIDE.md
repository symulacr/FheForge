# Privara Smart Contract Deployment Guide

This guide provides step-by-step instructions for deploying the Privara-compatible smart contracts to testnet and mainnet.

## Overview

The Privara integration includes four main smart contracts:

1. **PrivaraStrategyVault** - Confidential strategy vault for encrypted deposits/withdrawals
2. **PrivaraPaymentRouter** - Confidential payment router for encrypted payment routing
3. **PrivaraEscrowManager** - Escrow manager for multi-party confidential operations
4. **ZKVerifier** - Zero-knowledge proof verifier for privacy-preserving verification

## Prerequisites

### Required Software

- Node.js (v18 or higher)
- npm or yarn
- Hardhat
- Git

### Required Accounts

- Deployer wallet with sufficient gas tokens
- Network access (testnet or mainnet RPC)
- Environment variables configured

### Environment Setup

Create a `.env` file in the `contracts/` directory:

```bash
# Network Configuration
PRIVATE_KEY=your_private_key_here
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
ARBITRUM_SEPOLIA_RPC_URL=https://sepolia.arbitrum.io

# Optional: Mainnet Configuration
BASE_MAINNET_RPC_URL=https://mainnet.base.org
ARBITRUM_MAINNET_RPC_URL=https://arb1.arbitrum.io
```

**⚠️ SECURITY WARNING:** Never commit your `.env` file to version control. Add it to `.gitignore`.

## Pre-Deployment Checklist

Before deploying, ensure:

- [ ] All unit tests pass (`npm test`)
- [ ] Contracts have been audited (for mainnet)
- [ ] Gas tokens are available in deployer wallet
- [ ] Network RPC is accessible
- [ ] Environment variables are set correctly
- [ ] Contract addresses are documented for frontend integration

## Deployment Steps

### 1. Install Dependencies

```bash
cd contracts
npm install
```

### 2. Compile Contracts

```bash
npx hardhat compile
```

### 3. Run Tests (Optional but Recommended)

```bash
npm test
```

### 4. Deploy to Testnet

#### Deploy to Base Sepolia

```bash
npm run deploy:base
```

#### Deploy to Arbitrum Sepolia

```bash
npm run deploy:arb
```

Or use the custom Privara deployment script:

```bash
npx hardhat run scripts/deploy-privara-contracts.ts --network base-sepolia
```

### 5. Verify Contracts

After deployment, verify contracts on the respective block explorer:

#### Base Sepolia

```bash
npx hardhat verify --network base-sepolia <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```

**Block Explorer:** https://base-sepolia.blockscout.com

#### Arbitrum Sepolia

```bash
npx hardhat verify --network arb-sepolia <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```

**Block Explorer:** https://arbitrum-sepolia.blockscout.com

### 6. Test Contracts on Testnet

After deployment and verification, test the contracts:

```bash
npx hardhat run scripts/test-privara-contracts.ts --network base-sepolia
```

## Contract-Specific Deployment Notes

### PrivaraStrategyVault

**Constructor Arguments:** None

**Post-Deployment Configuration:**

- Activate strategies using `activateStrategy(strategyId)`
- Set strategy Privara status using `setStrategyPrivaraStatus(strategyId, status)`

**Important Functions:**

- `confidentialDeposit(token, strategyId, amount, permit)`
- `confidentialWithdraw(token, strategyId, amount, permit)`
- `createPermit(owner, token, amount, deadline, nonce)`
- `verifyPermit(permitId)`

### PrivaraPaymentRouter

**Constructor Arguments:** None

**Post-Deployment Configuration:**

- Set fee using `setFee(feeBasisPoints)` (e.g., 100 = 1%)
- Set fee recipient using `setFeeRecipient(recipient)`
- Set compliant addresses using `setCompliant(address, isCompliant)`

**Important Functions:**

- `routePayment(token, recipient, amount, permit)`
- `executeSwap(tokenIn, tokenOut, amount, permit)`
- `batchRoutePayments(token, recipients, amounts, permit)`
- `validateCompliance(address)`

### PrivaraEscrowManager

**Constructor Arguments:** None

**Post-Deployment Configuration:**

- Set emergency withdrawer using `setEmergencyWithdrawer(withdrawer)` (defaults to owner)

**Important Functions:**

- `createEscrow(token, amount, recipient, releaseTime, approvers)`
- `approveEscrow(escrowId)`
- `releaseEscrow(escrowId)`
- `cancelEscrow(escrowId)`
- `emergencyWithdraw(escrowId)`

### ZKVerifier

**Constructor Arguments:** None

**Post-Deployment Configuration:**

- Add verifiers using `setVerifier(verifier, authorized)`

**Important Functions:**

- `verifyProof(proof, publicInputs)`
- `verifyProofForTransaction(transactionHash, proof, publicInputs)`
- `storeProof(transactionHash, proof, publicInputs)`
- `revokeProof(proofHash)`

## Deployment Scripts

### Main Deployment Script

Location: `scripts/deploy-privara-contracts.ts`

This script:

- Deploys all four Privara contracts
- Configures initial settings
- Exports ABIs to `ui/abis/`
- Saves deployment data to `deployments/<network>.json`

### Test Script

Location: `scripts/test-privara-contracts.ts`

This script tests:

- Confidential deposit/withdraw flows
- Payment routing
- Escrow operations
- ZK proof verification

## Post-Deployment Steps

### 1. Update Frontend Configuration

Update the frontend with deployed contract addresses:

```typescript
// ui/config/contracts.ts
export const CONTRACT_ADDRESSES = {
  baseSepolia: {
    PRIVARA_VAULT: "0x...",
    PRIVARA_ROUTER: "0x...",
    PRIVARA_ESCROW: "0x...",
    ZK_VERIFIER: "0x...",
  },
  arbitrumSepolia: {
    PRIVARA_VAULT: "0x...",
    PRIVARA_ROUTER: "0x...",
    PRIVARA_ESCROW: "0x...",
    ZK_VERIFIER: "0x...",
  },
};
```

### 2. Update Backend Configuration

Update the backend with deployed contract addresses:

```typescript
// backend/apps/src/privara/infrastructure/privara.config.service.ts
export const PRIVARA_CONTRACTS = {
  baseSepolia: {
    vaultAddress: "0x...",
    routerAddress: "0x...",
    escrowAddress: "0x...",
    verifierAddress: "0x...",
  },
  // ...
};
```

### 3. Monitor Contracts

Set up monitoring for:

- Transaction volume
- Gas usage
- Error rates
- Emergency events

### 4. Document Deployment

Record:

- Deployment timestamps
- Contract addresses
- Deployer addresses
- Transaction hashes
- Configuration settings

## Network-Specific Information

### Base Sepolia

- **Chain ID:** 84532
- **RPC:** https://sepolia.base.org
- **Explorer:** https://sepolia.basescan.org
- **Gas Token:** Sepolia ETH

### Arbitrum Sepolia

- **Chain ID:** 421614
- **RPC:** https://sepolia.arbitrum.io
- **Explorer:** https://sepolia.arbiscan.io
- **Gas Token:** Sepolia ETH

### Base Mainnet

- **Chain ID:** 8453
- **RPC:** https://mainnet.base.org
- **Explorer:** https://basescan.org
- **Gas Token:** ETH

### Arbitrum Mainnet

- **Chain ID:** 42161
- **RPC:** https://arb1.arbitrum.io
- **Explorer:** https://arbiscan.io
- **Gas Token:** ETH

## Gas Estimation

Approximate gas costs for deployment:

| Contract             | Deployment Gas | Est. Cost (Base) | Est. Cost (Arbitrum) |
| -------------------- | -------------- | ---------------- | -------------------- |
| PrivaraStrategyVault | ~2,500,000     | ~$0.50           | ~$0.10               |
| PrivaraPaymentRouter | ~2,000,000     | ~$0.40           | ~$0.08               |
| PrivaraEscrowManager | ~1,800,000     | ~$0.36           | ~$0.07               |
| ZKVerifier           | ~1,500,000     | ~$0.30           | ~$0.06               |
| **Total**            | **~7,800,000** | **~$1.56**       | **~$0.31**           |

_Note: Gas costs vary based on network conditions and gas prices._

## Security Considerations

### Pre-Deployment Security

- [ ] Code audit completed
- [ ] Test coverage > 80%
- [ ] No critical vulnerabilities found
- [ ] Access control reviewed
- [ ] Emergency procedures documented

### Post-Deployment Security

- [ ] Monitor for unusual activity
- [ ] Set up alerting for large transactions
- [ ] Regular security reviews
- [ ] Keep emergency withdrawer secure
- [ ] Document all configuration changes

### Emergency Procedures

If an issue is detected:

1. **Pause Operations:** Use emergency withdrawal if needed
2. **Notify Team:** Alert development and security teams
3. **Investigate:** Review logs and transaction history
4. **Mitigate:** Apply patches or upgrades if necessary
5. **Communicate:** Inform stakeholders if user funds are at risk

## Troubleshooting

### Common Issues

#### Deployment Fails with "Insufficient Funds"

**Solution:** Ensure deployer wallet has enough gas tokens for deployment costs.

#### Contract Verification Fails

**Solution:**

1. Check constructor arguments match exactly
2. Ensure network is correct
3. Try using the block explorer's verification interface

#### Transactions Fail on Testnet

**Solution:**

1. Check RPC endpoint is accessible
2. Verify gas price is sufficient
3. Ensure nonce is correct (reset if needed)

#### ABIs Not Exported

**Solution:** Ensure `ui/abis/` directory exists and is writable.

## Support and Resources

### Documentation

- [Hardhat Documentation](https://hardhat.org/docs)
- [Base Documentation](https://docs.base.org)
- [Arbitrum Documentation](https://docs.arbitrum.io)
- [Fhenix Documentation](https://docs.fhenix.zone)

### Community Support

- Base Discord: https://discord.gg/base
- Arbitrum Discord: https://discord.gg/arbitrum
- Fhenix Discord: https://discord.com/invite/FuVgxrvJMY

### Emergency Contacts

- Development Team: [internal contact]
- Security Team: [internal contact]
- Project Lead: [internal contact]

## Version History

| Version | Date       | Changes                              |
| ------- | ---------- | ------------------------------------ |
| 1.0.0   | 2025-04-24 | Initial deployment guide for Week 10 |

## Appendix

### A. Environment Variables Reference

```bash
# Required
PRIVATE_KEY=0x...  # Deployer wallet private key
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
ARBITRUM_SEPOLIA_RPC_URL=https://sepolia.arbitrum.io

# Optional (for mainnet)
BASE_MAINNET_RPC_URL=https://mainnet.base.org
ARBITRUM_MAINNET_RPC_URL=https://arb1.arbitrum.io

# Optional (for custom networks)
CUSTOM_RPC_URL=https://your-custom-rpc-url
CUSTOM_CHAIN_ID=12345
```

### B. Deployment Script Commands

```bash
# Deploy to Base Sepolia
npm run deploy:base

# Deploy to Arbitrum Sepolia
npm run deploy:arb

# Deploy to custom network
npx hardhat run scripts/deploy-privara-contracts.ts --network custom

# Verify contract on Base Sepolia
npx hardhat verify --network base-sepolia <ADDRESS>

# Verify contract on Arbitrum Sepolia
npx hardhat verify --network arb-sepolia <ADDRESS>

# Run tests
npm test

# Run specific test file
npx hardhat test test/PrivaraStrategyVault.test.ts
```

### C. Contract Address Format

Contract addresses should be stored in checksum format:

```typescript
const address = "0x1234...abcd"; // Checksummed
```

Use `ethers.getAddress()` to ensure checksum format:

```typescript
const checksumAddress = ethers.getAddress("0x1234...abcd");
```

---

**Last Updated:** 2025-04-24
**Document Version:** 1.0.0
**Status:** Active
