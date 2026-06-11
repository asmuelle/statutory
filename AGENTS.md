# AGENTS.md — Operating Manual for AI Coding Agents

## Project Snapshot

**Statutory** is an "UpToDate for solo professionals": a living rulebook of the exact
statutes, agency rules, and rates that govern a user's practice (by jurisdiction ×
specialty), with delta alerts pushed when a monitored source changes and a ready-to-send
client-alert draft (Word/PDF) that converts the subscription into billable output.

- **Who pays:** solo/small-firm employment lawyers, CPAs/tax preparers, HR consultants,
  brokers — individuals who already pay $468–$1,500/yr out of pocket for currency
  (Westlaw, CCH, UpToDate). Entry price ~$49/mo per jurisdiction bundle.
- **Status:** Tier 1 (rank #3 of 12; survived platform-risk review, verdict "weakened").
  Pre-bootstrap: this repo is currently a documentation + harness scaffold. No app code
  exists until milestone M0 (see DESIGN.md).

## Read First

1. `README.md` — research dossier: concept, market evidence, adversarial review, stack.
2. `DESIGN.md` — architecture, data model, milestones M0–M3, risk register.
3. `TOOLS.md` — every command, external API, env var, and CI behavior.

## Commands (single source of truth)

Always use `just` — never raw `pnpm`/`docker` invocations. Recipes fail with a helpful
message until the workspace is bootstrapped (M0).

| Recipe | Purpose |
|---|---|
| `just` | List recipes |
| `just setup` | corepack enable + pnpm install |
| `just dev` | Run dev servers (web + Inngest dev) |
| `just db-up` / `just db-down` | Start/stop local Postgres (pgvector) |
| `just migrate` | Apply Drizzle migrations |
| `just test` | Vitest unit/integration tests |
| `just e2e` | Playwright end-to-end tests |
| `just lint` / `just format` | ESLint / Prettier |
| `just typecheck` | `tsc --noEmit` across workspace |
| `just build` | Production build |
| `just ci` | lint + typecheck + test + build (must pass before any commit) |

## Architecture Summary

A research-pipeline product: deterministic ingestion pulls Federal Register API, eCFR
XML, OpenStates, agency RSS, and state PDF registers into canonical normalized text;
stable section-hash diffing detects real changes; a cheap model triages each change
against practice profiles; a frontier model synthesizes one delta per jurisdiction-topic
(fanned out to all subscribers) behind a span-verification + attorney-review gate; the
Next.js app, email/Slack alerts, and docx export surface the result.

| Module | Responsibility |
|---|---|
| `apps/web` | Next.js 15 App Router: rulebook UI, review queue, exports, billing |
| `packages/core` | Pure TS domain logic: hashing, diffing, span verification, taxonomy |
| `packages/pipeline` | Inngest workers: fetch, parse, diff, triage, synthesize, fan-out |
| `packages/db` | Drizzle ORM schema + migrations (Postgres + pgvector) |

## Coding Standards

- TypeScript strict mode everywhere; no `any` without a comment justifying it.
- Files < 800 lines, functions < 50 lines; organize by feature, not file type.
- Immutability by default — return new objects, never mutate inputs.
- Explicit error handling at every boundary (API fetch, parser, LLM call, DB write).
  Pipeline steps must fail loudly into a dead-letter state, never silently skip.
- Validate all external data at the boundary (zod schemas for API responses and feeds).
- No hardcoded secrets — env vars only, validated at startup (see TOOLS.md table).
- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.

## Testing Policy

- TDD: write the failing test first. 80%+ coverage target. AAA structure.
- Highest-value tests for THIS product, in order:
  1. **Verification gate tests** — seeded-mutation tests proving a corrupted citation,
     altered quote span, or mismatched effective date BLOCKS publication.
  2. **Diff determinism tests** — same source text ⇒ same section hashes; whitespace or
     formatting churn ⇒ no change event (golden fixtures of real eCFR XML).
  3. **Parser tests** — golden-file tests per source format (eCFR XML, FR JSON,
     OpenStates JSON, each state PDF register layout).
  4. **Fan-out tests** — one delta per jurisdiction-topic, delivered to exactly the
     matching profiles.
  5. Playwright e2e for: onboarding → rulebook render; review queue approve → publish;
     client-alert export.
- LLM calls are mocked in unit tests; record/replay fixtures for integration tests.

## PRODUCT INVARIANTS (non-negotiable, each must be enforceable by a test)

1. **Never re-summarize from scratch.** Rulebook content may only change in response to
   a section-hash change event. Unchanged hash ⇒ zero LLM calls, zero rewrites.
2. **Span-verified citations.** Every quoted span in a delta or rulebook section must
   exactly string-match (after canonical normalization) the stored source text of the
   cited version. Any failed match blocks publication — no retry path may bypass it.
3. **Effective dates are double-extracted.** Model extraction and regex/structured
   extraction must agree; disagreement blocks publication and routes to review.
4. **Human review before user-visible publication.** No delta reaches a user surface
   (web, email, Slack, export) without an approved review-queue record. Code paths that
   publish must require `review.status === 'approved'` — enforce in the DB layer too.
5. **Author once, fan out.** Synthesis runs once per jurisdiction-topic change, never
   per user. Per-user LLM spend is limited to triage (~$0.001/change-user pair).
6. **Deterministic before LLM.** Fetching, parsing, normalizing, hashing, diffing, and
   span matching are pure deterministic code in `packages/core`/`packages/pipeline` —
   no model in those paths. Cheap model = triage only. Frontier model = synthesis only.
7. **Provenance is append-only.** Every section version stores source URL, retrieval
   timestamp, content hash, and effective date. Versions are never updated or deleted —
   corrections create new versions that supersede.
8. **Coverage honesty.** The system maintains an explicit coverage manifest
   (jurisdictions × topics × sources actually monitored). UI, alerts, and exports must
   render scope from that manifest and never imply broader monitoring.
9. **Exports carry their evidence.** Client-alert Word/PDF output embeds exact
   citations with effective dates and the configured not-legal-advice framing. An
   export without verified citations must be impossible to generate.
10. **Open sources only, politely.** Crawl only public government sources (Federal
    Register, eCFR, GovInfo, OpenStates, CourtListener, agency feeds, state registers).
    Respect robots.txt and rate limits. Never scrape paywalled publishers (Westlaw,
    Lexis, CCH) — that is both a ToS and an existential legal risk.

## Definition of Done

- [ ] `just ci` passes locally (lint, typecheck, test, build).
- [ ] New behavior covered by tests written first; coverage ≥ 80% on touched packages.
- [ ] No product invariant weakened; invariant-gate tests still pass.
- [ ] Errors handled explicitly; pipeline failures land in dead-letter, not silence.
- [ ] No secrets, no `console.log` debris, no `any` without justification.
- [ ] Migrations included for any schema change; `just migrate` runs clean.
- [ ] Conventional commit message; DESIGN.md updated if architecture changed.
