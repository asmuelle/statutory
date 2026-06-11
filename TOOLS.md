# TOOLS.md — Commands, APIs, Env, CI

## just Recipes

| Recipe | What it does | When to run |
|---|---|---|
| `just` | Lists all recipes | Orientation |
| `just setup` | `corepack enable` + `pnpm install` | After clone / lockfile change |
| `just dev` | `pnpm dev` — Next.js app + Inngest dev server | Daily development |
| `just db-up` | `docker compose up -d postgres` (pgvector/pgvector:pg16) | Before dev/test needing DB |
| `just db-down` | Stops the Postgres container | Cleanup |
| `just migrate` | Drizzle migrations via `packages/db` | After schema changes, after pull |
| `just test` | `pnpm test` (Vitest, workspace-wide) | Before every commit; in TDD loop |
| `just e2e` | `pnpm e2e` (Playwright) | Before PR; after UI/flow changes |
| `just lint` | `pnpm lint` (ESLint) | Before commit (hook also auto-fixes) |
| `just format` | `pnpm format` (Prettier write) | Rarely needed manually (hook formats) |
| `just typecheck` | `pnpm typecheck` (`tsc --noEmit`) | Before commit |
| `just build` | `pnpm build` | Before PR; verifies prod build |
| `just ci` | lint → typecheck → test → build | The gate. Must be green before commit |

All recipes print a helpful failure message and exit 1 until the workspace is
bootstrapped (no `package.json` yet — see DESIGN.md M0).

## External Data Sources & APIs

| Source | What we pull | Auth env var | Rate/cost notes | Link |
|---|---|---|---|---|
| Federal Register API | Daily rule/notice metadata + full text | none | Free, no key; throttle ourselves to ~1 req/s | https://www.federalregister.gov/developers/documentation/api/v1 |
| eCFR (Versioner API + bulk XML) | Point-in-time CFR section XML — the diffing backbone | none | Free; excellent structured diffability; cache all versions | https://www.ecfr.gov/developers/documentation/api/v1 |
| GovInfo API | Bulk statute/register packages | `GOVINFO_API_KEY` | Free via api.data.gov; default 1,000 req/hr | https://api.govinfo.gov/docs/ |
| Regulations.gov v4 | Dockets, proposed rules, comments | `REGULATIONS_GOV_API_KEY` | Free via api.data.gov; ~1,000 req/hr; batch nightly | https://open.gsa.gov/api/regulationsgov/ |
| OpenStates v3 | State bills/legislation by jurisdiction | `OPENSTATES_API_KEY` | Free tier is tightly throttled (small daily quota) — cache aggressively, sync nightly | https://docs.openstates.org/api-v3/ |
| CourtListener REST | Case-law signals (e.g., decisions reinterpreting statutes) | `COURTLISTENER_API_TOKEN` | Free; generous authed quota (~5k/hr) | https://www.courtlistener.com/help/api/rest/ |
| Agency RSS (DOL, IRS, EEOC, NLRB, state agencies) | Sub-regulatory guidance announcements | none | Free; poll daily; per-feed parser registry | per-agency feed URLs in source registry |
| State register PDFs (~25 states, weekly bulletins) | Scraped via Playwright, parsed via marker/Textract-class pipeline, then diffed against stored canonical text | (AWS creds if Textract is chosen) | The 18-month grind; ship states incrementally, never promise 50 | per-state URLs in source registry |
| Anthropic API | Haiku-class triage; Sonnet-class delta synthesis | `ANTHROPIC_API_KEY` | Triage budget ~$0.001/change-user pair; synthesis authored once per jurisdiction-topic and fanned out | https://docs.anthropic.com |
| Resend | Email delta alerts + digests | `RESEND_API_KEY` | Pay-as-you-go; batch sends | https://resend.com/docs |
| Slack incoming webhooks | Per-user delta alerts | per-user webhook URL stored encrypted in DB (not env) | Free | https://api.slack.com/messaging/webhooks |
| Inngest | Scheduled crawls + pipeline step functions | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Free dev server locally (`npx inngest-cli dev`) | https://www.inngest.com/docs |
| Stripe (M3) | Subscriptions, jurisdiction add-ons | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Test mode until launch | https://docs.stripe.com |

## Required Env Vars

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection (local: docker compose; CI: service container) |
| `ANTHROPIC_API_KEY` | Triage + synthesis model calls |
| `GOVINFO_API_KEY` | GovInfo bulk data (api.data.gov key) |
| `REGULATIONS_GOV_API_KEY` | Regulations.gov v4 (api.data.gov key) |
| `OPENSTATES_API_KEY` | OpenStates v3 state-legislation sync |
| `COURTLISTENER_API_TOKEN` | CourtListener REST API |
| `RESEND_API_KEY` | Transactional email + alert digests |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | Pipeline scheduling (prod; dev server needs none) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Billing (M3 only) |

Keep a committed `.env.example` with names only. Validate presence at startup; fail fast.

## Local Services

- **Postgres 16 + pgvector** via `docker compose` (`pgvector/pgvector:pg16`), started
  with `just db-up`. Owns versioned rulebook sections, effective-date history, profiles,
  review queue, and embeddings for the topic taxonomy.
- **Inngest dev server** runs inside `just dev` for local cron/step execution.

## CI (.github/workflows/ci.yml)

- Triggers on `push` and `pull_request`; single job on `ubuntu-latest`.
- Steps: checkout → setup-just → Node 22 + corepack → **bootstrap guard** → install → `just ci`.
- **Bootstrap guard:** if `package.json` is absent, the job emits a notice and skips
  install/build steps — the docs-only scaffold stays green. Once M0 lands, the full
  `pnpm install --frozen-lockfile` + `just ci` path runs automatically.
- A `pgvector/pgvector:pg16` service container is wired via `DATABASE_URL` for tests
  (only exercised once bootstrapped).

## AI Harness Notes (.claude/settings.json)

- **PostToolUse hooks:** Prettier auto-formats every written/edited `.ts/.tsx/.js/.jsx/.json/.css/.md`
  file; ESLint `--fix` runs on `.ts/.tsx`. Both are no-ops until `package.json` exists.
- **Stop hook:** `tsc --noEmit` runs at session end (once bootstrapped) — type errors
  surface even if you forgot `just typecheck`.
- **Permissions:** `just`, `pnpm`, `node`, `npx vitest`, `npx playwright`,
  `docker compose`, and read-only git are pre-allowed.
- **Useful subagents:** `planner` before any multi-file feature; `tdd-guide` for new
  pipeline stages (verification gate work especially); `code-reviewer` after every
  change set; `security-reviewer` for anything touching user profiles, Slack webhooks,
  exports, or billing; `build-error-resolver` when `just ci` breaks.
