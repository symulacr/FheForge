# Product

## Register

product

## Users

Crypto-native developers and DeFi power users running leveraged strategies on Arbitrum Sepolia. They connect with MetaMask or Rabby, understand encrypted amounts and ciphertext handles, and expect the protocol to be technically honest — no friendly abstractions hiding the complexity. They use the ReactFlow builder or the AI prompt to compose strategies, then sign transactions with encrypted inputs. They are comfortable with wallets, gas, and on-chain state; they read block explorers and understand what euint128 means.

## Product Purpose

FheForge lets users compose, deploy, and manage encrypted DeFi positions — supply, borrow, swap, and liquidate with amounts stored as euint128 ciphertexts on Arbitrum Sepolia. Only the position owner can decrypt their own balance via a signed FHE permit. The strategy builder (ReactFlow canvas) and AI prompt (Gemini) both converge on the FheForgeComposer contract, executing atomic multi-step strategies on-chain. Success: a user has an open position with encrypted collateral they can verify privately, rebalance without exposing amounts to MEV or liquidation bots, and selectively reveal to auditors via signed permits.

## Brand Personality

Cryptographic, precise, uncompromising. The tool does not apologize for its complexity. Tone: technical reference documentation meets low-level debugger — terse, factual, accurate. No motivational copy. No friendly abstractions. Every number shown is either an encrypted ciphertext hash or a real decimal the user can verify on-chain.

## Anti-references

- Uniswap: rainbow gradients, rounded cards, consumer-friendly color washes, "Swap" as a first-class friendly action
- Aave: navy/teal corporate softness, large padded cards, gentle SaaS UI feel
- MetaMask Portfolio: warm onboarding, big icons, soft radius, "Your portfolio is growing" callouts
- Any DeFi app with gradient hero metrics, pulsing green numbers, or copy that says "maximize your yield"

## Design Principles

1. **Show the ciphertext** — encrypted state should be displayed as what it is (a ciphertext hash), not hidden behind a "Private" label. The cryptography is the feature, not an implementation detail.
2. **Terminal-native density** — information presented at the density of a protocol specification, not a consumer product. Users read rows and tables, not cards with icons.
3. **Earned precision** — every numeric value has a visible source (oracle price, chain state, or estimate). No placeholder values presenting as real data.
4. **No false warmth** — the system is cold and correct by design. UI reflects that: monochrome ramp, sharp edges, monospace throughout. Warmth is carried by the success green on confirmed encrypted state.
5. **Trust through exposure** — surface what the contract actually does (ACL grants, ciphertext handles, transaction hashes) rather than abstracting it away. Informed users make better decisions.

## Accessibility & Inclusion

WCAG 2.1 AA as baseline. All interactive elements keyboard-accessible. Reduced motion respected via existing `@media (prefers-reduced-motion: reduce)` rules. Color is never the sole indicator of state — status labels accompany all status colors. Monospace fonts degrade gracefully to system monospace fallbacks.
