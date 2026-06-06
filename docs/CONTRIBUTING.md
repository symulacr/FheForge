# Contributing to FheForge

Thanks for your interest! FheForge is an encrypted DeFi protocol built on Arbitrum Sepolia with CoFHE/Fhenix. Here's how to get started.

## Getting Started

1. **Fork** the repository and clone your fork
2. **Set up** each environment (see [README](./README.md#setup)):
   - `contracts/` — `npm install`, requires a `.env` (copy from `.env.example`)
   - `ui/` — `bun install`, requires `.env.local` (copy from `.env.example`)
   - `backend/apps/` — `bun install`, requires `.env.development` (copy from `.env.development.example`)
3. **Run tests** to confirm your setup works:
   ```bash
   cd contracts && node scripts/test-hardened.js && node scripts/test-sharp.js
   cd ../ui && bun run test
   cd ../backend/apps && npm run test
   ```

## Development Workflow

We work in **waves** — each wave is a focused batch of microchanges addressing a specific domain or concern.

1. **Pick a microchange** from the plan (`MICROCHANGE_PLAN_WAVE3.md`) or file an issue
2. **Write tests first** for the change (TDD — test before implementation)
3. **Implement the change** — keep it small and focused
4. **Run affected tests** — forge test for contracts, jest for backend, vitest for frontend
5. **Commit** using [conventional commits](https://www.conventionalcommits.org/):
   - `feat(sc):` for smart contract features
   - `fix(be):` for backend bug fixes
   - `docs:` for documentation changes
   - `test:` for test additions
   - `refactor:` for code restructuring
6. **Open a PR** against the `main` branch

## Code Standards

| Domain | Standard |
|---|---|
| **Solidity** | 0.8.28, CoFHE SDK conventions, OpenZeppelin patterns |
| **TypeScript (Backend)** | Strict mode, NestJS module architecture (controller → service → repository) |
| **TypeScript (Frontend)** | Strict mode, Next.js App Router, wagmi/viem patterns |
| **All** | ESLint + Prettier formatting enforced via CI |

- No `console.log` in production code — use the NestJS `Logger` or structured logging
- All new endpoints need a corresponding Swagger `@ApiTags` / `@ApiOperation` decorator
- All new Solidity functions need `@dev` natspec documentation
- Keep functions small and single-responsibility

## Testing

| Test type | Command | Location |
|---|---|---|
| Foundry (contracts) | `forge test` | `contracts/test-foundry/` |
| Hardhat (contracts) | `npx hardhat test` | `contracts/test/` |
| POSTFIX probes | `node contracts/scripts/test-hardened.js` | Live on-chain probes |
| Backend unit | `npm run test` | `backend/apps/` |
| Frontend unit | `bun run test` | `ui/` |

All new code must include tests. Aim for >50% coverage on contracts and >80% on backend services.

## Pull Request Guidelines

- PR title follows conventional commits (e.g., `feat(sc): add reveal functions for on-chain settlement`)
- Description explains **what** and **why**, not just how
- Links to the relevant microchange (e.g., `Closes MC-029`)
- CI must pass (lint → type-check → test → build)
- Screenshots for frontend changes

## Questions?

Open a [GitHub Discussion](https://github.com/symulacr/FheForge/discussions) or file an issue.
