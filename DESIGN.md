# DESIGN.md — Statutory

## Thesis

Solo professionals already pay $468–$1,500/yr out of pocket for regulatory currency, yet
every tool they can afford is pull-based search or an unscoped newsletter firehose.
Statutory wins by being push-based and personally scoped — a living rulebook diffed
daily against primary government sources, with span-verified deltas and a billable
client-alert draft attached. The moat is unglamorous: per-jurisdiction source plumbing,
per-user practice-profile mapping that compounds with corrections, and a trust gate
(exact citation + effective date, verified before publication) that generic deep
research demonstrably fails.

## Architecture

### Pipeline (source → diff → triage → synthesis → verification → review → surface)

```
[Sources]                [Deterministic]            [Cheap model]      [Frontier model]
Federal Register API ─┐
eCFR Versioner XML  ──┤  fetch → parse →            triage: map        synthesize ONE
OpenStates v3       ──┼─ normalize → section  ──►   change_event  ──►  delta per
Agency RSS          ──┤  hash → diff vs stored      to topics ×        jurisdiction-topic
State register PDFs ──┘  canonical text             profiles           with citations
(Playwright + parser)         │                                              │
                              ▼                                              ▼
                        change_event                              [Deterministic gate]
                        (only on hash change —                    span string-match +
                        NEVER re-summarize                        regex/model effective-
                        unchanged sections)                       date cross-check
                                                                         │ pass    │ fail
                                                                         ▼         ▼
                                                                  [Human gate]  review
                                                                  attorney      queue
                                                                  review queue  (blocked)
                                                                         │ approved
                                                                         ▼
                                                             publish → fan out to all
                                                             subscribed profiles →
                                                             web rulebook / email /
                                                             Slack / docx export
```

### Cost discipline (who does what)

- **Deterministic code (free):** fetching, parsing, normalization, section hashing,
  diffing, span verification, regex effective-date extraction, fan-out, export
  rendering. This is the bulk of the system and lives in `packages/core` + `packages/pipeline`.
- **Cheap model (~$0.001/change-user pair):** triage only — classify a detected change
  against the jurisdiction × topic taxonomy and match it to practice profiles.
- **Frontier model (authored once, shared):** delta synthesis only — one delta per
  jurisdiction-topic change event, fanned out to every subscriber. Also used once per
  user at onboarding to assemble the initial rulebook (amortized). Per-user marginal
  inference stays at $3–8/mo against $49/mo revenue.

### Scheduling: Inngest (chosen over Temporal)

Inngest is the scheduler/orchestrator: cron-triggered crawls (daily federal, weekly
state registers), step functions with retries per pipeline stage, and event fan-out for
triage/delivery. Rationale: zero infrastructure to operate at this team size, a local
dev server that runs inside `just dev`, and per-step retry/replay that fits a staged
pipeline. Revisit Temporal only if we need long-lived stateful workflows (multi-day
human review SLAs) that outgrow Inngest's model; the pipeline stages are
queue-and-state-machine shaped, so the swap would be contained to `packages/pipeline`.

### Module map (pnpm workspace)

| Path                | Contents                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`          | Next.js 15 App Router, TS strict: rulebook UI, delta feed, review-queue UI, onboarding, exports, billing pages                  |
| `packages/core`     | Pure TS, no IO: normalization, section hashing, diff, span verifier, effective-date extractor, taxonomy, profile-matching logic |
| `packages/pipeline` | Inngest functions: source registry, fetchers/parsers per source type, triage + synthesis callers, fan-out, alert dispatch       |
| `packages/db`       | Drizzle schema + migrations, Postgres + pgvector; repository layer                                                              |

## Data Model Sketch

- **source** — id, kind (`federal_register` \| `ecfr` \| `openstates` \| `agency_rss` \| `state_register_pdf`), jurisdiction, feed URL, parser id, schedule, status, last_crawled_at
- **canonical_section** — id, source_id, citation (e.g. `29 CFR § 541.600`), jurisdiction, topic tags, current_version_id, current_hash
- **section_version** _(append-only)_ — id, section_id, normalized_text, content_hash, retrieved_at, source_url, effective_date, supersedes_version_id
- **change_event** — id, section_id, old_version_id, new_version_id, detected_at, structural_diff, status (`detected → triaged → synthesized → verified → in_review → published` \| `rejected` \| `dead_letter`)
- **practice_profile** — id, user_id, jurisdictions[], practice_areas[], client_types[], topic_weights (learned), correction_history
- **delta** — id, jurisdiction, topic, change_event_ids[], body_md, effective_date, citations[] (each: quote_span, section_version_id, verified_at), verification_status, token_cost
- **review_record** — id, delta_id, reviewer_id, status (`pending` \| `approved` \| `rejected` \| `needs_edit`), notes, decided_at — _publication requires `approved`_
- **delivery** — delta_id × user_id, channel (`web` \| `email` \| `slack`), sent_at, opened_at
- **client_alert** — id, user_id, delta_id, template_id, rendered_docx_url, exported_at
- **user / subscription** — auth, plan tier, jurisdiction bundles, billing ids (Stripe), coverage manifest acceptance

## Key Flows

### 1. Daily federal ingest → published delta

1. Inngest cron fires; fetcher pulls eCFR Versioner XML + Federal Register API for monitored parts.
2. Parser normalizes to canonical section text; `packages/core` computes section hashes.
3. Hash unchanged → stop (invariant 1: no LLM touch). Hash changed → append `section_version`, create `change_event`.
4. Cheap-model triage tags the change with jurisdiction × topic and matches subscribed profiles; no matches → archive event (still versioned).
5. Frontier model synthesizes ONE delta for the jurisdiction-topic: what changed, effective date, affected rulebook sections, quoted statutory spans.
6. Deterministic gate: every quoted span string-matched against stored version text; effective date cross-checked model-vs-regex. Any failure → blocked, `review_record` flagged `needs_edit`.
7. Attorney review queue: approve / edit / reject. Approval publishes.
8. Fan-out: rulebook sections update with versioned history; email/Slack alerts dispatched to matched profiles with client-alert draft link.

### 2. Onboarding → living rulebook

1. User selects jurisdictions, practice areas, client types (questionnaire ≈ 5 min).
2. Profile maps to taxonomy → set of jurisdiction-topic pages (shared, not per-user).
3. Missing pages are assembled once by frontier model from canonical sections, span-verified, attorney-reviewed, then cached for all future users.
4. User sees their rulebook with citations, effective dates, and the coverage manifest ("monitored: Federal + CA, employment; NOT monitoring local ordinances").
5. User confirms/corrects section relevance → corrections update `topic_weights` (the compounding per-user moat).

### 3. Client-alert export (the billable artifact)

1. From a published delta, user clicks "Draft client alert".
2. Template merges delta body, exact citations with effective dates, firm letterhead fields, and the configured not-legal-advice framing.
3. docx-templater renders Word/PDF; export recorded in `client_alert`. Export is impossible if any citation lacks `verified_at` (invariant 9).

### 4. Verification failure path

1. Synthesis output contains a quote that fails string-match (e.g. model paraphrased "shall" → "must").
2. Gate blocks; `change_event` → `in_review` with diff of expected vs produced span; nothing user-visible.
3. Reviewer fixes the quote or rejects; fixed deltas re-run the gate (no bypass).
4. Failure rate is a tracked metric — it is the product's core health number.

### 5. State register (PDF) ingest

1. Weekly Inngest cron; Playwright fetches the state bulletin PDF.
2. PDF parser (marker/Textract-class) extracts text; parsed output diffed against stored canonical text — same hash/diff machinery as XML sources.
3. Low-confidence parses route to dead-letter for manual inspection, never silently into the diff stream.

## Product & Visual Design Direction

**Annotated statute book, modernized.** The audience bills hours against this output —
the UI must read like an authority, not a startup dashboard. Paper-warm ivory surfaces
(`oklch(97% 0.01 90)`-family), near-black ink text; a serif with legal/editorial weight
(Newsreader or Source Serif) for rulebook prose and display, paired with a precise mono
(IBM Plex Mono) for citations, section numbers, and hashes. Color is strictly semantic,
never decorative: amber = pending effective date, green = span-verified, oxblood red =
superseded/repealed, slate = under review. Deltas render as ledger-style entries with a
left rule and effective-date margin notes; version history reads like redlines
(strikethrough old, underline new). Density over whitespace; margin annotations over
modals; zero gradient blobs.

## Milestones

### M0 — Bootstrap (`just ci` green with code)

Scaffold the pnpm workspace exactly per the module map: root `package.json` with
`dev/test/e2e/lint/format/typecheck/build` scripts, TS strict configs, ESLint +
Prettier, Vitest + Playwright wiring, `docker-compose.yml` (pgvector/pgvector:pg16),
Drizzle baseline migration for the data model above, Inngest dev wiring, `.env.example`.
**Accept:** `just setup && just db-up && just migrate && just ci` all pass locally; CI
runs the full (non-guarded) path green.

### M1 — Thin vertical slice: Federal employment law, end to end

Scope: eCFR Title 29 Parts 541, 778, 785 (exempt status, overtime, hours worked) +
Federal Register documents touching them. One demo practice profile (CA employment
lawyer). Full pipeline: ingest → hash/diff → triage → synthesis → verification gate →
review queue (minimal UI) → rulebook page + email alert.
**Accept:** replaying the 2024 DOL exempt-salary-threshold amendment through the
pipeline from archived fixtures produces a published, span-verified delta with the
correct effective dates; an unchanged re-crawl produces zero LLM calls and zero events.

### M2 — Trust layer

Span-verification and effective-date cross-check enforced in the DB/publish path (not
just pipeline code); attorney review queue UI with edit/approve/reject + audit log;
provenance display on every section (source URL, retrieved, version history); coverage
manifest rendered in app and embedded in exports; seeded-mutation test suite in CI.
**Accept:** a deliberately corrupted citation in a test delta cannot reach published
state by any code path; every published section shows full provenance; mutation tests
run in `just ci`.

### M3 — Monetization wiring

Stripe subscriptions: Core $49/mo (1 jurisdiction bundle, annual default), Practice Pro
$99/mo, Small-firm $149/mo (3 seats), +$15–19/mo per added jurisdiction. Client-alert
docx/PDF export (the billable artifact) gated to paid plans; Slack integration;
onboarding → trial → paywall flow.
**Accept:** test-mode checkout → active subscription → jurisdiction add-on purchase →
export of a white-labeled client alert, all covered by Playwright e2e; webhook handling
idempotent.

### M4 — Live data plane / go-live readiness

Real regulatory sources flowing through the existing gate: live Federal Register +
eCFR fetchers, real Anthropic adapters, the daily runner, and alert delivery —
config-gated, deterministic gates non-bypassable.

Scope:

1. **Live fetchers (keyless)** in `packages/pipeline/src/sources`: a Federal Register
   API client (documents endpoint, agency/date filtered, tiny queries) and an eCFR
   Versioner client (title structure + point-in-time section XML, e.g. 29 CFR
   541.600), both parsing into the existing `ParsedSection`/`FederalRegisterDoc`
   model with the same stable section-hash diffing. All external payloads validated
   at the zod boundary; malformed payloads are rejected loudly.
2. **Real Anthropic adapter** implementing the existing `TriageModel` +
   `SynthesisModel` seams (Messages API, forced tool-use, retry/backoff, refusal →
   the event is dropped to dead-letter, never published). Config-gated on
   `ANTHROPIC_API_KEY`; the deterministic mocks remain the default and the fixture
   replay scenario always uses mocks. The span-verification gate is provider-
   independent: corrupted adapter output blocks publication exactly like corrupted
   mock output.
3. **Daily runner**: `just daily` executes crawl → hash-diff → triage → synthesize →
   gate → review-queue against fixtures (default) or `--live` (Federal Register +
   eCFR only), emitting a structured run ledger (sources, sections checked, changes
   detected, gate outcomes, review-queue states). It never publishes and never sends
   alerts — publication still requires the attorney review queue. The schedulable
   entrypoint is documented (TOOLS.md), not started.
4. **Resend alert adapter** for the delta-alert path: config-gated on
   `RESEND_API_KEY`, fetch-stub tested; alert dispatch renders through
   `renderEmailAlert`, so alerts can only ever derive from published (gate-passed,
   reviewed) deltas — enforced by construction and by test.
5. **CI discipline**: `just ci` stays green with no docker and no network. Anything
   that touches a live endpoint lives in `just test-live` (`*.livetest.ts`, separate
   vitest config, excluded from ci, graceful skip when offline).

**Accept:** `just ci` green offline; fetch-stub unit tests cover both live clients,
the Anthropic adapter (including retry, refusal, malformed-output rejection, and the
gate blocking corrupted adapter output), and the Resend sender (including the
published-deltas-only invariant); `just test-live` fetches a real eCFR section that
diffs as unchanged against itself and a real Federal Register document that maps
into the model; `just daily` produces a complete run ledger from fixtures and
`just daily --live` from the live sources.

**Status notes (delivered vs deferred):** Delivered: live FR + eCFR clients with
live smoke tests, Anthropic Messages adapter (fetch-stub verified; not exercised
against the real API — no credentials exist in this environment), Resend adapter
(fetch-stub verified, same constraint), daily runner with fixtures/--live modes and
run ledger. Deferred: Inngest-scheduled execution (entrypoint documented only),
OpenStates/agency-RSS/state-PDF sources, Slack delivery, and wiring the daily
runner to the Postgres store (it runs against the in-memory store; the DB publish
gate remains enforced by the M2 triggers).

## Risks & Mitigations (from the adversarial review)

| #   | Risk                                                                                                                            | Mitigation                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **One mutated citation is a product-killing event** (Stanford RegLab: 17–33% hallucination even in Lexis/Westlaw AI)            | Hard deterministic span-match gate + effective-date cross-check + mandatory attorney review before any publication; seeded-mutation tests in CI; verification failure rate tracked as the primary health metric (invariants 2–4).                            |
| 2   | **Completeness is unprovable** — a missed local ordinance or case-law reinterpretation breaks the "never miss a change" promise | Sell scoped monitoring, not omniscience: explicit coverage manifest in UI and every export (invariant 8); CourtListener case-law signals for monitored statutes; launch promise limited to listed sources.                                                   |
| 3   | **Vertical incumbents with distribution** (Mitratech Mineral, SixFifty, Checkpoint/KeyCite alerts) already ship change alerts   | Wedge where they don't sell: self-serve individual professional at $49/mo (incumbents are enterprise/quote-priced); the per-user correction loop compounds into a profile-mapping asset they can't bundle; client-alert export ties product to user revenue. |
| 4   | **State register PDF grind** — ~25 states are weekly PDF dumps; "50 states" is an 18-month parsing project                      | Launch federal + 8–12 API-friendly states; one parser module per register format with golden-file tests; coverage manifest keeps the promise honest while states ship incrementally (flow 5 dead-letters low-confidence parses).                             |
| 5   | **Quiet-period churn** — sparse deltas in a narrow jurisdiction-specialty makes $49/mo feel cancellable; CPAs are seasonal      | The rulebook is the retention surface, not the alert: "confirmed current as of <date>" stamps give quiet weeks positive value; weekly digest even when nothing changed; annual billing as default; jurisdiction add-ons as the NRR engine.                   |
