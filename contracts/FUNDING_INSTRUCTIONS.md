# FheForge — Testnet Funding Instructions

Two fresh wallets have been generated for end-to-end testnet deployment + testing
on **Arbitrum Sepolia** (chain id `421614`). The private keys live in
`contracts/.env` — never commit that file or reuse these keys on mainnet.

## Wallets

| Role | Address | Purpose |
| --- | --- | --- |
| Deployer | `0xEf13D578777B1CAeF1b27edC743AB175230450Ec` | Pays gas for contract deployment + setVault. After deployment, automatically forwards 25% of its remaining balance to the tester wallet. |
| Tester | `0xA2ad1b1cAe13146D656F56b7e6ae3774dE485a51` | Used by `scripts/test-live.ts` and frontend integration tests. Never holds the deployer key. |

## Step 1 — Fund the Deployer with Sepolia ETH

You need at least **0.04 ETH** on Arbitrum Sepolia at the deployer address
(0.02 for deployment gas, 0.01 forwarded to tester, 0.01 buffer).

### Direct Arbitrum Sepolia faucets (preferred — no bridging)

- https://www.alchemy.com/faucets/arbitrum-sepolia (0.1 ETH per day, requires
  Alchemy account)
- https://faucet.quicknode.com/arbitrum/sepolia (0.025 ETH per 12h)
- https://faucet.triangleplatform.com/arbitrum/sepolia (0.01 ETH)
- https://www.arbitrum.io/faucet (0.001 ETH every 24h)

Paste the deployer address `0xEf13D578777B1CAeF1b27edC743AB175230450Ec` into
the faucet, request, and verify with:

```sh
cd contracts && npx hardhat run scripts/check-wallet-balance.js --network arb-sepolia
```

### Bridge from Sepolia (if Arbitrum Sepolia faucets are dry)

1. Get Sepolia ETH from one of:
   - https://www.alchemy.com/faucets/ethereum-sepolia (0.5 ETH/day)
   - https://sepoliafaucet.com (0.5 ETH/day)
   - https://faucetlink.to/sepolia (multi-aggregator)
2. Bridge to Arbitrum Sepolia at https://bridge.arbitrum.io (select Sepolia
   → Arbitrum Sepolia, ~10 min for L2 confirmation).

## Step 2 — Deploy

Once the deployer balance is at least 0.04 ETH on Arbitrum Sepolia, run:

```sh
cd contracts
npx hardhat run scripts/deploy.ts --network arb-sepolia
```

The script will:
1. Deploy `StrategyRegistry`, `StrategyVault`, `LendingPool`, `SwapRouter`
2. Wire vault to registry (`registry.setVault(vault)`)
3. Export ABIs to `ui/abis/`
4. Write deployment record to `deployments/421614.json`
5. Print `NEXT_PUBLIC_*` env vars to paste into `ui/.env.local`
6. Forward 25% of remaining deployer balance to the tester wallet

## Step 3 — Tokens for Testing

The vault accepts any ERC-20 as collateral (`MockERC20` is included for local
testing). On Arbitrum Sepolia you have two paths:

### Option A: Use the included MockERC20 (recommended for end-to-end smoke)

After deployment, deploy a fresh `MockERC20` from any account, mint 1 M tokens
to the tester, then use that token address in `openPosition` / `supply`. The
`MockERC20` constructor mints 1e24 (1 M * 1e18) to the deployer; `mint(address,
uint256)` is unrestricted.

### Option B: Use real testnet USDC

Arbitrum Sepolia USDC (Circle): `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`

Faucet: https://faucet.circle.com (paste tester address, select Arbitrum
Sepolia, request 10 USDC). Then approve the vault and pool:

```sh
cast send 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d \
  "approve(address,uint256)" <VAULT_ADDR> 1000000000 \
  --rpc-url $ARBITRUM_SEPOLIA_RPC_URL \
  --private-key $TESTER_PRIVATE_KEY
```

### Option C: Swap ETH → USDC on testnet

Most testnet AMMs are unmaintained on Arbitrum Sepolia. Stick with the faucet
or `MockERC20` path. If you absolutely need a swap, use the SwapRouter
contract you just deployed in mock-executor mode (the deployer is the executor
by default, so it can settle intents itself).

## Step 4 — Verify deployment + run live tests

```sh
cd contracts
npx hardhat run scripts/test-live.ts --network arb-sepolia
```

This script reads `deployments/421614.json`, exercises every deployed
contract's read methods, and reports per-call results.

## Troubleshooting

- **"insufficient funds for gas"**: deployer balance < gas cost. Top up via
  faucet.
- **"replacement transaction underpriced"**: previous tx still pending. Wait
  ~30s and retry.
- **"FHE precompile not found"**: the network does not support CoFHE. Verify
  you are on Arbitrum Sepolia (not Ethereum Sepolia).
