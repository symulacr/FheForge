# FheForge — README Extraction

Source: `README.md` of [github.com/symulacr/FheForge](https://github.com/symulacr/FheForge)

---

## Elevator Pitch

> **FheForge brings fully homomorphic encryption (FHE) to DeFi, letting you build, manage, and automate encrypted financial strategies — without exposing your positions to the world. Supply, borrow, swap, and liquidate with amounts that stay encrypted on-chain. Only you control who can decrypt and verify your position.**

---

## Problem

Today's DeFi is a glass house. Every position, swap, and liquidation is public on-chain. Anyone can see:

- **Your wallet balance and all your trades** — no privacy, no discretion
- **Your liquidation risk in real time** — bots front-run your healthy positions
- **Your strategy's every move** — MEV searchers extract value from your transactions

This isn't just an inconvenience. It's a structural barrier to institutional adoption. Funds, banks, and regulated entities cannot operate with full public visibility.

---

## Why FHE?

Fully Homomorphic Encryption (FHE) lets smart contracts compute on encrypted data without ever decrypting it. Users deposit encrypted amounts; the contract runs supply, borrow, and swap logic on ciphertexts; only the user can reveal their own position.

Comparison against ZK, MPC, TEE:

| Capability                    | ZK        | MPC         | TEE         | **FHE (FheForge)** |
|-------------------------------|-----------|-------------|-------------|-------------------|
| Private input to contract     | ✓ (proof) | ✓ (multi-party) | ✓ (hardware) | **✓ (direct)**   |
| On-chain compute on private data | ✗      | ✗           | ✓ (trusted hw) | **✓ (native)**   |
| No trusted setup or hardware  | ✓         | ✓           | ✗           | **✓**             |
| Selective disclosure          | ✓         | ✓           | ✓           | **✓ (signed permit)** |
| Composability with existing DeFi | Partial | Partial     | Partial     | **✓ (CoFHE)**    |
| No latency overhead           | ✗ (off-chain) | ✗ (rounds) | ✓       | **∼ (CoFHE ~1 block)** |

**FHE is the only technology that allows private, on-chain computation without trusted hardware, trusted parties, or moving execution off-chain.**

---

## Architecture

### Component Diagram

```
USER (Browser / Wallet - MetaMask, Rabby)
    │
    ├──► UI — Next.js 14
    │       ├── Wagmi + Viem (Wallet + Chain)
    │       ├── @cofhe/react SDK (Encrypt/Decrypt)
    │       ├── ReactFlow (Strategy Canvas)
    │       └── Next.js App Router
    │
    ├──► BACKEND — NestJS
    │       ├── REST API
    │       ├── Gemini AI Builder
    │       ├── Simulation Engine
    │       └── Supabase / PostgreSQL
    │
    └──► BLOCKCHAIN — Arbitrum Sepolia
            ├── FheForgeComposer (orchestrator)
            ├── StrategyVault
            ├── LendingPool
            ├── SwapRouter
            ├── PriceOracle
            └── StrategyRegistry
```

### Data Flow

1. User builds a strategy in ReactFlow visual canvas
2. Backend parses and simulates the strategy
3. User confirms on-chain
4. Frontend calls FheForgeComposer
5. Composer orchestrates Vault / LendingPool / SwapRouter with encrypted amounts

### Contracts

| Contract           | Role                                                      |
|--------------------|-----------------------------------------------------------|
| **FheForgeComposer** | Entry-point orchestrator; coordinates multi-step strategies atomically |
| **StrategyVault**  | Open, add to, close positions with encrypted `euint128` collateral |
| **LendingPool**    | Supply, borrow, repay, withdraw — all amounts encrypted   |
| **SwapRouter**     | Intent-based AMM with encrypted `amountIn` / `minOut`     |
| **PriceOracle**    | Multi-source price feed for LTV and liquidation checks     |
| **StrategyRegistry** | Register and discover strategies with encrypted TVL      |
| **StrategyExecutor** | Executes strategy steps on-chain                         |
| **ExecutorContract** | EOA → contract executor (replaced raw EOA)               |
| **TokenRegistry**  | Registered token metadata                                 |

### Privacy Model

- Amounts → `euint128` via CoFHE / Fhenix runtime
- `ZkVerifier` rejects unsigned input — no dummy ciphertexts
- `decryptForView` requires a signed permit — only you read your own position
- Cross-user isolation verified: user B cannot decrypt user A's ciphertext handles

---

## Deployed Contracts — Arbitrum Sepolia (421614)

All contracts deployed `2026-05-29` via `forge-deploy.ts`. Most verified on Arbiscan.

| Contract           | Address                                      | Verified |
|--------------------|----------------------------------------------|----------|
| LendingPool        | `0xff687831dfD3657D6C6879403cE56f53518b378C` | ✅       |
| StrategyVault      | `0xfCb89417e0a21813c84647614764e920bBdFEb94` | ✅       |
| FheForgeComposer   | `0xEab68D8Ee6DC5Ddc10293fF3B1bb21679d81dC8b` | ✅       |
| SwapRouter         | `0x9C9bEb3d95184BbA11AfE1D973927562C8eb0409` | ✅       |
| PriceOracle        | `0x46ef25fDd66Ce1A331942064Ef6879848621fBd9` | ✅       |
| StrategyRegistry   | `0xB39E9B573b8f39fBc407f8F7d9F621481d3E12C8` | ✅       |
| StrategyExecutor   | `0x03De449445c1c11d190b49bf9dBf98FCfC6b58D8` | ✅       |
| TokenRegistry      | `0x68c6A763e85367c4964b36e207DaFfe745B1B980` | ✅       |
| ExecutorContract   | `0x1bF7eb45695A4d9b83F5392F16DC262840B4A7d1` | ❌ (rate-limited) |
| FheForgeToken      | `0x4c348a75B24490F36B14E1f602c6b22AB7Df1cD0` | ✅       |
| FheForgeTimelock   | `0x1BCF1631249aB36Ef7C2E2fC910E2D2c7F30E479` | ✅       |
| FheForgeGovernor   | `0x667F08348509F0499797C51f892d09770Cf1A0C0` | ✅       |

---

## Team

| Name      | Role                                                      | GitHub                                        |
|-----------|-----------------------------------------------------------|-----------------------------------------------|
| symulacr  | Smart Contracts, Backend, Frontend, Infrastructure        | [@symulacr](https://github.com/symulacr)     |

Solo operation — one person covering the full stack (Solidity, TypeScript/React, NestJS, DevOps).

---

## Tech Stack

| Layer           | Technology                                                                                                      |
|-----------------|------------------------------------------------------------------------------------------------------------------|
| Smart Contracts | Solidity 0.8.28, CoFHE SDK, OpenZeppelin, Hardhat + Foundry                                                      |
| Frontend        | Next.js 14, React 18, wagmi v2, viem, @cofhe/react, ReactFlow, Tailwind CSS, shadcn/ui, TanStack Query, Zustand |
| Backend         | NestJS 11, Supabase (PostgreSQL), @nestjs/swagger, Google Gemini AI                                              |
| Blockchain      | Arbitrum Sepolia (CoFHE TaskManager)                                                                             |
| Deployment      | Vercel (frontend), Railway (API)                                                                                 |

---

## Submission Context

- **Buildathon**: Akindo "Private By Design" dApp Buildathon — Wave 5
- **Track**: RWA & Compliance · DeFi & Lending · Privacy Infrastructure
- **Release**: v1.2.0
- **Live App**: https://fheforge-xkq.vercel.app
- **API**: https://fheforge-api-production-6465.up.railway.app
