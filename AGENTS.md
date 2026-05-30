# FheForge — Agent Context

## Design Context

FheForge UI uses a committed design system. Before building or modifying any frontend surface, read:

- **PRODUCT.md** (root) — Register: `product`. Users: crypto-native DeFi power users on Arbitrum Sepolia. 5 principles: show the ciphertext, terminal-native density, earned precision, no false warmth, trust through exposure.
- **DESIGN.md** (root) — Visual system: dark terminal (#0a0a0a bg), JetBrains Mono globally, `border-radius: 0 !important` (hard constraint), single blue accent (#3b82f6) restrained strategy, semantic state colors (success #22c55e / warning #eab308 / destructive #ef4444).

### Key constraints for agents

- Zero border-radius is non-negotiable. No exceptions except badge pill shape.
- JetBrains Mono is the only typeface. No font-family switching.
- Accent (#3b82f6) for primary actions and active state only — not decoration.
- No gradient text, no glassmorphism, no ghost-card (border + large box-shadow together).
- Motion: Framer Motion at 150–250ms ease-out. Every animation has a `prefers-reduced-motion` fallback.
- Copy: no marketing buzzwords, no em dashes, no aphoristic cadence. Verb + object button labels.
- Run `/impeccable` commands for any design work. Context is pre-loaded from PRODUCT.md + DESIGN.md.
