# Agent Critique: Developer Relations / Documentation (Domain 6)

> **Critic:** Sisyphus-Jr (Peer Review)
> **Audit Date:** 2026-05-18
> **Source Agent:** agent-6-documentation.md (14 findings across P0/P1/P2)
> **Manifest Section:** WAVE1_MANIFEST.md §6 (lines 261-300)

---

## Preliminary: Severity Definition Mismatch

Before critiquing individual findings, a structural problem must be flagged: **the P0 definition leaks across domains inconsistently.**

The manifest defines P0 as: *"Critical — blocks deployment or causes data loss / security breach."* By this literal standard, **zero** documentation findings qualify as P0. Nothing in the documentation domain can block deployment or cause data loss. The audit implicitly redefines P0 for DevRel to mean *"makes submission fail to communicate value to buildathon judges."*

This matters because it creates false equivalence with real P0s from other domains (INFRA-P0-1 leaked private key, BE-P0-1 all 39 endpoints public). A judge reading the manifest sees 27 P0s total and doesn't know 8 of them are documentation — lower-risk than any other P0.

**Recommendation:** Either rename DevRel P0s to "P-Buildathon / P0-Presentation" to distinguish from security/deployment P0s, or add a note explaining the domain-specific severity scale.

---

## Finding-by-Finding Critique

---

### DOC-P0-1: README opens with FHE jargon — no plain-English pitch

**File:** `README.md:1-3` → `# FheForge — Encrypted DeFi... amt → euint128.`

**Severity Assessment: P0 — CORRECT**

This is the correct severity for a buildathon context. The first two lines a judge sees are incomprehensible to anyone without deep FHE knowledge. The current README has zero "what is this" exposition. Verified: `README.md` is 109 lines, opens immediately into jargon.

**Edge Cases & Scenarios the Original Missed:**

1. **The entire README has no project pitch whatsoever** — The agent focuses on lines 1-3, but the problem extends further. There is no sentence anywhere in the README explaining what FheForge does for a non-technical reader. The "Built" section is a bullet list of contract names, not a value proposition.
2. **No mention of the Buildathon name** — The README doesn't say "Akindo Wave Hacks" or "Wave 4" anywhere. A judge should immediately know which competition this enters.
3. **No team attribution** — Who built this? For a buildathon, judges evaluate the team. Zero team info exists.

**Implementation Risks:**

- **Over-engineering risk**: The agent's suggested rewrite (lines 28-37) is good but runs long. Buildathon judges scan — keep each section to 3-5 bullet points max. The suggested block would benefit from tighter prose.
- **URL dependency**: The rewrite embeds `https://ui-chi-ashy.vercel.app` — this URL might change. If Vercel auto-generates a new URL on deploy, the README breaks.
- **Consistency risk**: If the pitch says "Build encrypted strategies, trade privately" but the frontend has P0 bugs (ConfigPanel re-render loop, ProtocolIcon always WETH), the pitch over-promises.

**Dependencies on Other Domains:** None blocking. The README can be rewritten independently. However, the pitch should be validated against actual app capabilities (which depend on FE fixes).

**Priority Within Domain:** 1st — First thing anyone sees. No dependencies to start, but will need final review after all other fixes.

---

### DOC-P0-2: No "Problem" or "Why FHE" sections

**Severity: P0 — CORRECT** (though arguably P1)

Without a problem statement, the project is a solution in search of a problem. The "Why FHE" section is critical for differentiating from ZK/MPC/TEE approaches.

**Edge Cases & Scenarios the Original Missed:**

1. **Overlap with DOC-P1-2 (RWA section)**: The agent proposes a standalone "Problem" section and a standalone "RWA" section. These overlap significantly — both describe why DeFi privacy matters. They need to be written as complementary, not redundant. The RWA section should be a *use case* of the problem, not a separate problem statement.
2. **FHE comparison table accuracy risk**: The comparison (FHE vs ZK vs MPC vs TEE) must be technically precise. If the agent makes an error (e.g., "ZK can't compute on hidden data" is true for basic proofs but not for zk-SNARKs with recursion), it undermines credibility with technically-literate judges.
3. **Judges may not care about FHE-vs-ZK**: For buildathon judges who are VCs or business people, the technical distinction between FHE and ZK may be noise. The "Why FHE" section should answer "why does this matter for users," not "why is FHE different from ZK."

**Implementation Risks:**

- **Technical accuracy**: Must be reviewed by someone with deep FHE knowledge before publishing.
- **Tone risk**: The "Problem" section (lines 52-67) is well-written but accusatory ("DeFi today leaks everything..."). A more neutral tone may be more persuasive.
- **Length**: Two new sections + the RWA section = significant README expansion. Judges scan — keep each under 10 lines or use collapsible sections.

**Dependencies:** Should follow DOC-P0-1 logically (pitch → problem → solution → why FHE). Minor dependency.

**Priority Within Domain:** 2nd — After the elevator pitch, before RWA section.

---

### DOC-P0-3: No architecture diagram in README

**Severity: P0 — DISPUTE (should be P1)**

An architecture diagram is valuable but it's not a submission blocker. The code works without it. The project can be judged without it. P0 should be reserved for things that genuinely block understanding. A diagram enhances understanding but no judge will reject a submission solely for lacking one.

**Edge Cases & Scenarios the Original Missed:**

1. **The diagram already exists**: `conductor/ARCHITECTURE_DIAGRAM.md` (246 lines, 2 mermaid diagrams including a sequence diagram) is a comprehensive reference. The agent correctly notes it's "hidden from judges" but underestimates its quality — it's one of the best assets in the repo.
2. **The diagram is ASPIRATIONAL, not factual**: The diagram shows:
   - "Auth Module — JWT + ThrottlerGuard" → but BE-P0-1 found auth is NOT applied anywhere
   - Monitoring "Grafana + Prometheus" as production infra → but INFRA-P0-7 found it's Docker-local only
   - Including this diagram as-is in the README would present a misleading picture of the current state.
3. **The agent's condensed diagram has a rendering bug**: Both `style BC` and `style CONTRACTS` use `#10b981` (green), making them visually identical. This matters because mermaid rendering errors on GitHub look unprofessional.
4. **No mention of the event indexer or AI module in the condensed diagram**: The full diagram includes these; the condensed version drops them.

**Implementation Risks:**

- **Must annotate aspirational elements**: If the diagram includes JWT auth or production monitoring, it needs a note like "JWT auth: pending implementation" or similar.
- **Mermaid rendering**: GitHub's mermaid renderer is version-specific. Test the diagram in a PR before merging to main.
- **Maintenance burden**: Every architecture change requires updating both the full diagram (in conductor/) and the condensed version (in README). This dual-maintenance is a documentation debt.

**Dependencies:**
- BE-P0-1 (auth): If the diagram shows JWT, it's aspirational today
- INFRA-P0-7 (monitoring): If the diagram shows production monitoring, it's aspirational
- These should be updated when those issues are fixed

**Priority Within Domain:** 5th — After the text content (pitch, problem, FHE, RWA) is finalized. Should link to the existing `conductor/ARCHITECTURE_DIAGRAM.md` as "full architecture" and include a condensed version in README.

---

### DOC-P0-4: Zero screenshots in README

**Severity: P0 — CORRECT** (in buildathon context)

No visual evidence of a working UI is a critical omission for a frontend-heavy buildathon submission.

**Edge Cases & Scenarios the Original Missed:**

1. **Heavy dependency chain — cannot screenshot until bugs are fixed**: The agent estimates 15 minutes for this task. This is only valid if *all* of the following are resolved first:
   - FE-P0-1 (ConfigPanel infinite re-render — screenshot would show a broken UI)
   - FE-P0-2 (ProtocolIcon always WETH — every protocol shows WETH icon)
   - FE-P0-4 (StrategyPromptDetails is "Coming Soon" stub)
   - INFRA-P0-4 (UI talks to Wave17 contracts, not Wave30 — app may show zero data)
   - INFRA-P0-5 (backend talks to Wave5-6 contracts)
   - INFRA-P1-2 (Base Sepolia artifact doesn't exist)
2. **No `ui/public/screenshots/` directory exists**: The agent says "save to `ui/public/screenshots/`" but this directory must be created.
3. **Screenshot capture requires a funded wallet on Arbitrum Sepolia**: The demo needs test ETH. If the tester doesn't have funded accounts with position data, screenshots will show empty states.
4. **Static screenshots age quickly**: If the UI changes after screenshots are taken (likely during remediation), they'll be outdated.

**Implementation Risks:**

- **Single point of failure**: The demonstration screenshots depend on the entire stack working. If *any* layer is broken, all screenshots are compromised.
- **Fake data risk**: If the tester mints tokens/supplies liquidity just for screenshots, the screenshots show a non-representative state. Better to use real testnet positions.
- **Image optimization**: Unoptimized screenshots (>500KB each) will slow down README loading.

**Dependencies:**
- FE-P0-1, FE-P0-2, FE-P0-4 (frontend bugs)
- INFRA-P0-4, INFRA-P0-5 (address correctness)
- INFRA-P1-2 (Base Sepolia deployment — for that env)
- SC-P1-1 (reveal functions — for "permit-based reveal" screenshot)

**Priority Within Domain:** 7th — Must be deferred until after frontend + infra P0 fixes are applied.

---

### DOC-P0-5: No demo video

**Severity: P0 — CORRECT** (highest-judge-impact item)

**Edge Cases & Scenarios the Original Missed:**

1. **Massive dependency chain — the video requires everything to work**: The 30-minute estimate is unrealistic when factoring in dependencies:
   - The script (20 min to write)
   - Recording setup (10 min)
   - Filming (20 min per take, likely 2-3 takes = 40-60 min)
   - Editing (30-45 min for decent quality)
   - Captions (15 min for SRT or YouTube auto-caption review)
   - Upload + README integration (10 min)
   - **Realistic total: 2-3 hours** of video production work, PLUS all dependency fixes.
2. **Single-presenter dependency**: The script says "Hi, I'm [NAME]" but there's zero team info in the project. Who records this? If no one is comfortable on camera, the video won't happen.
3. **No contingency for demo failures**: The script includes 4 distinct demo segments (wallet connect, DeFi builder, on-chain execution, privacy reveal). If *any* of these fails during recording, the video has a broken segment.
4. **The "permit-based decrypt reveal" (0:30-1:00) depends on SC-P1-1**: The reveal functions (`revealBalance()`, `revealBorrow()`, etc.) don't exist yet.
5. **YouTube publishing requirements**: Account verification takes time. Loom is simpler but less professional. Neither is mentioned as a consideration.
6. **No accessibility**: No captions/subtitles plan mentioned.

**Implementation Risks:**
- **Highest risk item in the entire DevRel domain**: If recording fails, the team loses their highest-judge-impact asset.
- **Technical debt risk**: The video shows the state of the app at recording time. If critical bugs are fixed after recording, the video is misleading.
- **Audio quality**: Poor audio (fan noise, echo, mic quality) makes any demo video look amateurish.
- **Racy content risk**: If the demo accidentally shows a real private key or API key on screen, it's a security breach on video.

**Dependencies:**
- ALL FE-P0 fixes
- INFRA-P0-4, INFRA-P0-5 (correct addresses)
- BE-P0-1 (auth — make sure endpoints aren't blocked)
- BE-P0-3, BE-P0-4 (missing GET endpoints)
- SC-P1-1 (reveal functions for the privacy demo)
- This is the single most dependency-heavy item in the entire domain.

**Priority Within Domain:** 8th — Absolute last P0 item. Everything else must be working first.

---

### DOC-P0-6: 18 research/audit files cluttering root directory

**Severity: P0 — CORRECT** (in buildathon context)

**Edge Cases & Scenarios the Original Missed:**

1. **The "keep in root" list is now out of date**: The agent's plan (line 257) keeps `SISYPHUS_SYNTHESIS.md`, `agent-2-frontend.md`, and `agent-6-documentation.md` in root. But these are also audit artifacts from *this* audit — they should be moved to `docs/research/` or a `docs/audit/` directory alongside the 18 research files.
2. **The file list doesn't include WAVE1_MANIFEST.md or the agent-*.md files**: The WAVE1_MANIFEST.md (35K, 431 lines) and the 6 agent report files (agent-1 through agent-6, totaling ~150K) are new additions since the original agent report. These also belong in an audit subdirectory.
3. **`conductor/ARCHITECTURE_DIAGRAM.md` is in the wrong place**: The architecture diagram is in `conductor/` but there is no `conductor/README.md` or index file. The `conductor/` directory only has:
   - `ARCHITECTURE_DIAGRAM.md` (9064 bytes)
   - `CODEBASE_MASTERY_DOSSIER.md` (26044 bytes) — this is a 26K research file that should also move to `docs/research/`.
4. **No `docs/` directory exists**: The agent says "Move to `docs/research/`" but `docs/` must first be created. Without explicit `mkdir` instructions, this step may be missed.
5. **`git mv` breaks cross-references**: Some research files may contain relative links to other research files. Mass `git mv` will silently break these links.

**Implementation Risks:**
- **Low technical risk** (file moves only)
- **Medium organizational risk**: Deciding what to keep vs. move vs. delete requires judgment. If in doubt, move everything to `docs/research/` rather than deleting.
- **Git history continuity**: `git mv` preserves history but makes `git log --follow` necessary to trace moved files.

**Dependencies:** None on other domains. Can be done immediately.

**Priority Within Domain:** 3rd — Quick win (5 min), no dependencies, instantly improves professional appearance.

---

### DOC-P0-7: No LICENSE file

**Severity: P0 — CORRECT**

No license = no one can legally use, modify, or distribute the code. For an open-source buildathon project, this is a critical oversight.

**Edge Cases & Scenarios the Original Missed:**

1. **License compatibility**: MIT (the agent's suggestion) is permissive, but the project uses OpenZeppelin (MIT) and Hardhat (MIT), so compatibility is fine. However, if the project incorporates code from GPL-licensed projects (e.g., certain Uniswap V3 code might be GPL), MIT would be incompatible. This should be verified.
2. **Copyright holder**: The agent uses "Copyright (c) 2026 FheForge" — but "FheForge" may not be a legal entity. If it's an individual's project, the individual's name should be used.
3. **Year accuracy**: 2026 is future-dated even by the audit date. While legally acceptable (copyright vests upon creation), using the current year is more standard.

**Implementation Risks:** None. MIT license text is boilerplate.

**Dependencies:** None.

**Priority Within Domain:** 1st (tied with DOC-P0-1) — 1 minute to create. No-brainer.

---

### DOC-P0-8: No git tags

**Severity: P0 — DISPUTE (should be P1 or P2)**

Git tags are a nice-to-have for judging, but:
- Zero tags don't block deployment or cause data loss
- Zero tags don't prevent the app from working
- The judging criteria mention "Development Progress" but a CHANGELOG covers this better than tags
- Most judges won't check `git tag --list` — they look at commit history, release page, or README

This is more appropriately P1 (important, not blocking) or P2 (nice to have).

**Edge Cases & Scenarios the Original Missed:**

1. **Timing dilemma**: Should the tag be created NOW (capturing buggy state) or AFTER all fixes (capturing polished state)? The agent doesn't address this. Creating `v1.0.0` now would tag a codebase with 27 P0 bugs across 6 domains — not a great "version 1.0.0."
2. **Tag + Release**: The agent mentions "Also create a GitHub Release" but doesn't specify that releases are separate from tags. A release with release notes is more valuable than a bare tag.
3. **Semantic versioning**: `v1.0.0` implies production readiness. This is a buildathon prototype on testnet. `v0.1.0` or `v0.1.0-buildathon` would be more appropriate.

**Implementation Risks:** Low. Tag creation is reversible (`git tag -d v1.0.0`).

**Dependencies:** Should ideally be created AFTER all P0 fixes across all domains. This creates a soft dependency on every other domain.

**Priority Within Domain:** 9th — After all code fixes, immediately before submission.

---

### DOC-P1-1: No CHANGELOG.md

**Severity: P1 — CORRECT**

A changelog demonstrates sustained development progress, which is a judging criterion. Not a blocker, but valuable.

**Edge Cases & Scenarios the Original Missed:**

1. **The suggested changelog doesn't include the audit findings**: 27 P0 findings were discovered. A changelog that doesn't mention "Security audit conducted, 65 findings remediated" misses a major milestone.
2. **No commit references**: The changelog groups changes by "Waves" but doesn't reference specific commits or PRs. This makes it impossible to verify claims.
3. **No Keep a Changelog compliance**: The suggested format doesn't follow the standard ([keepachangelog.com](https://keepachangelog.com)) which specifies `[Unreleased]` section format, link references at the bottom, etc.
4. **The 30-wave narrative may not be accurate**: The agent groups waves as "Wave 1-4", "Wave 5-9", etc. but this grouping may not match the actual git history. It should be verified against `git log`.

**Implementation Risks:**
- **Accuracy risk**: If wave descriptions don't match actual git history, judges who dig deep may find inconsistencies.
- **Maintenance burden**: A changelog that isn't kept current is worse than no changelog.

**Dependencies:** Should be the last content file created, after all fixes, so it can include them.

**Priority Within Domain:** 10th — Draft early, finalize after all fixes.

---

### DOC-P1-2: Zero mention of RWA in README

**Severity: P1 — DISPUTE (should be P0)**

The project competes in **Track 1: RWA & Compliance**. Having zero mentions of "RWA" (Real World Assets) anywhere in the README is a judging-critical omission. Judges scoring Track 1 entries will look for:
- How does this project serve RWA?
- What compliance features does it offer?
- How does FHE specifically benefit RWA?

Without any of this, the project may be scored as "not relevant to the track" even if the technical work is strong.

This is analogous to submitting to a "DeFi" track and never saying "DeFi" — it would be a P0 omission. The same logic applies here.

**Edge Cases & Scenarios the Original Missed:**

1. **The RWA section must connect to compliance specifically**: Just saying "RWA" isn't enough. The project needs to show HOW FHE enables compliance (selective disclosure, audit trails, encrypted credit scores, etc.) for regulated entities.
2. **Overpromising risk**: The agent's suggested section says "FHE makes DeFi compliance-ready" — this is a strong claim. FHE is not yet recognized by regulators as a compliance solution. Overpromising could backfire with knowledgeable judges.
3. **Missing concrete use case**: The RWA section would be stronger with a named example: "A real estate tokenization platform could use FheForge to let investors hold property tokens without revealing their portfolio."

**Implementation Risks:**
- **Legal risk of overclaiming**: Saying FHE is "compliance-ready" without regulatory guidance could be seen as misrepresentation. Add qualifiers like "enables a path toward compliance."
- **Narrative consistency**: The RWA use case must align with the "Problem" and "Why FHE" sections (DOC-P0-2). All three must tell one coherent story.

**Dependencies:** Should follow DOC-P0-2 (Problem + Why FHE). Minor dependency.

**Priority Within Domain:** 6th — After "Why FHE" section, before technical documentation.

---

### DOC-P1-3: No CONTRIBUTING.md

**Severity: P1 — CORRECT**

**Edge Cases & Scenarios the Original Missed:**

1. **Test commands in the suggested CONTRIBUTING.md may not work**: The agent suggests `bun vitest` for frontend and `bun test` for backend, but FE-P0-1 (ConfigPanel render-side-effect) would cause test failures if tests existed, and BE coverage may be minimal.
2. **No code review requirements**: A CONTRIBUTING.md that doesn't specify review requirements (e.g., "all PRs require 1 approval") sets unclear expectations.
3. **Conventional commits enforcement**: The agent mentions `feat:`, `fix:`, etc. but doesn't say if commitlint or similar enforcement exists.

**Implementation Risks:** Low. Standard template with project-specific adjustments. Risk of becoming outdated.

**Dependencies:** None.

**Priority Within Domain:** 11th — After security documentation.

---

### DOC-P1-4: No SECURITY.md

**Severity: P1 — CORRECT**

**Edge Cases & Scenarios the Original Missed:**

1. **The contact email `security@fheforge.dev` may not exist**: The agent suggests this email address but doesn't verify it exists or is monitored. If the email bounces, the security policy is worse than none.
2. **Response timeline is ambitious for a buildathon team**: 24h acknowledgment, 72h assessment, 7d fix — this is a professional-grade SLA that a small team may not meet. Better to say "we will respond within 7 days" than overpromise.
3. **No PGP key**: For a DeFi/crypto project, vulnerability reports should be encryptable via PGP. The policy should include a PGP fingerprint.
4. **The bug bounty section says "no formal program"**: This contradicts the response timeline which implies active security maintenance. Clarify: "We will acknowledge your report publicly (with permission) but cannot offer financial compensation."

**Implementation Risks:** Low. Standard template.

**Dependencies:** None.

**Priority Within Domain:** 4th (move up) — A security policy is more important than CONTRIBUTING.md for a DeFi project.

---

### DOC-P2-1: No tech stack badge row

**Severity: P2 — CORRECT**

**Edge Cases & Scenarios the Original Missed:**

1. **Badges will go stale**: The agent suggests `build-passing` and `tests-17 passed` as static shields.io URLs. These won't update when the build breaks or test counts change. Dynamic badges (from GitHub Actions or CircleCI) are better but require setup.
2. **"Arbitrum Sepolia" badge may be misleading**: The app is deployed to a testnet. This is fine for a buildathon but should not imply production readiness.
3. **Badge count inflation**: 8 badges may be too many — it clutters the top of the README. Consider 4-5 core badges (Solidity, Next.js, License, Build status).

**Implementation Risks:** Low. Purely cosmetic.

**Dependencies:** Should be updated after test count changes from TEST domain fixes.

**Priority Within Domain:** 12th.

---

### DOC-P2-2: Zero GitHub stars

**Severity: P2 — CORRECT**

**Edge Cases & Scenarios the Original Missed:**

1. **This is a social action, not a code fix**: The agent says "Team members star the repo." This requires social coordination, not code changes. It may be outside the scope of technical remediation.
2. **Repo URL is not documented anywhere**: The agent says "Go to https://github.com/FheForge/FheForge (or the actual URL)" — it doesn't know the actual URL. This ambivalence suggests the repo URL isn't well-known even within the team.
3. **Self-staring ethics**: Team members starring their own repo is standard practice but has diminishing returns past 2-3 stars.

**Implementation Risks:** None for code. Social risk if perceived as gaming.

**Dependencies:** None.

**Priority Within Domain:** 13th (last). Trivial to do but lowest impact.

---

## MISSED FINDINGS

The following issues were NOT identified by agent-6 but should be:

### M1: README's "Known Issues" section publicly documents live security vulnerabilities

**File:** `README.md:65-71`

The README publicly states: *"Dual plain+encrypted input skew — no on-chain `amount == encAmount` enforcement."* This tells attackers exactly where the protocol is vulnerable. While the audit agent-1 flagged this as SC-P0-1, the README should NOT advertise this until a fix is deployed. Either remove from the README or add a clear "Mitigation: CoFHE ZK proof of equality (post-MVP)" status.

**Suggested Severity:** P1 (security-sensitive info in public docs)

### M2: No OpenAPI / Swagger documentation

NestJS supports Swagger automatically, but no `/api` or `/docs` endpoint exists. For a project where the backend has 39 endpoints, zero API documentation is a significant developer experience gap. The manifest lists this as Wave 2 item 8, but it should be in Wave 1 for this domain.

**Suggested Severity:** P2 (developer experience, not blocking but important for a full-stack dApp)

### M3: Architecture diagram in `conductor/` is aspirational, not factual

The mermaid diagram shows:
- "Auth Module — JWT + ThrottlerGuard" → BE-P0-1 says auth is never applied
- "REST API" with routes → BE-P0-3, BE-P0-4 say routes are missing
- "Grafana + Prometheus" as infrastructure → INFRA-P0-7 says monitoring is Docker-local only

If this diagram is included in the README as-is, it presents a fictional architecture. The diagram must either be updated to reflect current state, or annotated with "TODO" markers.

**Suggested Severity:** P1 (misleading documentation)

### M4: No team section anywhere

For a buildathon, judges evaluate the team. There is zero team information — no names, bios, LinkedIn profiles, or GitHub handles in the README or repository. Judging criteria typically include "Team & Experience" (scoring 6/10 per the manifest). A team section is the lowest-effort way to improve this score.

**Suggested Severity:** P1 (directly impacts judging criteria)

### M5: No GitHub issue/PR templates

The repo has no `.github/ISSUE_TEMPLATE/` or `PULL_REQUEST_TEMPLATE.md`. For an open-source project, this signals the project isn't set up for community contributions. CONTRIBUTING.md alone is insufficient.

**Suggested Severity:** P3 (cosmetic, but signals project maturity)

### M6: No `.env.example` synchronization

The README says "Copy `ui/.env.example` → `ui/.env.local`" but there's no validation that `.env.example` lists all required variables. INFRA-P0-4, INFRA-P0-5, INFRA-P1-1 all identify env var gaps. The `.env.example` files should be audited against actual code usage.

**Suggested Severity:** P2 (developer onboarding friction)

### M7: Scoring estimate is unrealistic when factoring dependencies

The agent estimates a **~6.0 to ~8.4 score improvement** from documentation alone. This assumes judges separately score documentation from code functionality. In reality, if the app has critical bugs (ConfigPanel loop, wrong contract addresses, broken auth), no amount of documentation polish will compensate. The scoring estimate should be caveated as "assuming all functional P0 bugs are fixed."

**Suggested Severity:** This is a methodology critique of the agent's analysis, not a finding per se, but it undermines the agent's ROI claims.

### M8: No link to the GitHub repository from the README

The README's "Live" section links to the frontend and API, but there's no "GitHub → https://github.com/..." link. A reader who finds the README elsewhere (e.g., deployed on Vercel) has no way to find the source code.

**Suggested Severity:** P2

---

## CROSS-CUTTING: Dependencies Between This Domain and Others

This domain has the **heaviest outward dependency load** of any domain. Most documentation fixes depend on code fixes being completed first.

| Doc Finding | Depends On | Nature of Dependency |
|---|---|---|
| DOC-P0-4 (screenshots) | FE-P0-1, FE-P0-2, FE-P0-4 | Frontend bugs must be fixed first |
| DOC-P0-4 (screenshots) | INFRA-P0-4, INFRA-P0-5 | Correct addresses required for app to show real data |
| DOC-P0-4 (screenshots) | SC-P1-1 | Reveal functions needed for "permit-based reveal" screenshot |
| DOC-P0-5 (demo video) | ALL of the above | Plus BE-P0-1 (auth), BE-P0-3/4 (endpoints) |
| DOC-P0-5 (demo video) | SC-P1-1 | Privacy reveal segment needs `revealBalance()` etc. |
| DOC-P0-8 (git tag) | ALL P0 fixes across ALL domains | Tag should capture fixed state, not buggy state |
| DOC-P0-3 (diagram) | BE-P0-1 (auth) | If diagram shows JWT, fix must be applied first |
| DOC-P2-1 (badges) | TEST domain | Test count badges depend on actual test results |

**Reverse dependencies (other domains depending on THIS domain):**

| Other Domain | Depends On | Nature |
|---|---|---|
| INFRA (deploy) | DOC-P0-6 (move files) | Clean root before deploy — don't deploy research artifacts |
| Integration (CI) | DOC-P1-1 (CHANGELOG) | CI can auto-generate changelog entries from commits |
| ALL domains | DOC-P0-6 | After files are moved, any tooling referencing old paths breaks |

---

## EXECUTION ORDER (Revised)

The agent-6-documentation.md proposes an execution order but it puts dependency-heavy items (screenshots, video) too early. Here is the revised order based on dependency resolution:

### Phase 1: Independent Quick Wins (No Dependencies)

| Order | Finding | Est. Time | Rationale |
|---|---|---|---|
| 1 | DOC-P0-7 (LICENSE) | 1 min | Zero dependencies, immediate professionalism win |
| 2 | DOC-P0-6 (move research files) | 5 min | Zero dependencies, cleans up root |
| 3 | DOC-P0-1 (elevator pitch) | 5 min | Can draft now, may need minor tweaks later |
| 4 | DOC-P1-4 (SECURITY.md) | 5 min | Important for DeFi, no dependencies |
| 5 | DOC-P0-2 (Problem + Why FHE) | 10 min | Can draft now, complements pitch |

### Phase 2: Context-Dependent Content (After Core Narrative)

| Order | Finding | Est. Time | Rationale |
|---|---|---|---|
| 6 | DOC-P1-2 (RWA section) | 5 min | Builds on "Why FHE" section |
| 7 | DOC-P0-3 (architecture diagram) | 10 min | Should wait for auth fix or annotate aspirational state |
| 8 | DOC-P1-3 (CONTRIBUTING.md) | 5 min | Standard template, low urgency |
| 9 | DOC-P1-1 (CHANGELOG.md draft) | 10 min | Draft now, update after fixes |
| 10 | DOC-P2-1 (badge row) | 3 min | Cosmetic, relies on test counts |

### Phase 3: Dependency-Heavy Items (After Code Fixes)

| Order | Finding | Est. Time | Depends On |
|---|---|---|---|
| 11 | DOC-P0-4 (screenshots) | 15 min capture + depends | FE-P0-1, FE-P0-2, FE-P0-4, INFRA-P0-4, INFRA-P0-5 |
| 12 | DOC-P0-5 (demo video) | 2-3 hours | ALL P0 frontend + backend + infra + SC fixes |
| 13 | DOC-P0-8 (git tag) | 1 min | ALL P0 fixes across ALL domains |
| 14 | M3 (fix architecture diagram accuracy) | 10 min | BE-P0-1, INFRA-P0-7 fixes must be reflected |
| 15 | M4 (add team section) | 5 min | Requires team input |

### Key Insights on the Revised Order

1. **The agent's 1.5-hour estimate is only valid for Phase 1.** Phase 2 adds ~40 min. Phase 3 adds 2-4 hours (mostly video). **Realistic total: 4-6 hours** of documentation work, plus unknown hours of dependency resolution.

2. **The video (DOC-P0-5) is both the highest-impact AND highest-risk item.** It should be the very last documentation task, done only after all code fixes are verified.

3. **DOC-P0-3 (diagram) has a hidden trap**: If included before auth fix and monitoring fix, it's misleading. If included after, it's double maintenance (update diagram, then update again when auth/monitoring are fixed).

4. **DOC-P1-2 (RWA) should be P0, not P1.** This is the single most impactful change for track-specific scoring.

5. **Total elapsed time is at least 3-5 calendar days** for this domain alone, because most items are blocked on other domains. The "1.5 hours" claim in the manifest is misleading without this context.

---

## Summary

| Category | Count |
|---|---|
| Severity downgrade recommended (P0→P1) | 2 (DOC-P0-3, DOC-P0-8) |
| Severity upgrade recommended (P1→P0) | 1 (DOC-P1-2) |
| New findings discovered | 8 (M1-M8) |
| Cross-cutting dependencies identified | 12+ |
| Estimated actual effort | 4-6 hours (vs. agent's 1.5 hours) |
| Items requiring other domains to complete first | 3 (screenshots, video, git tag) |
