# justfile — Statutory. Single source of truth for commands (see TOOLS.md).
# Repo is a docs-only scaffold until M0; guarded recipes explain themselves.

# List available recipes
default:
    @just --list

# (internal) Fail helpfully until the pnpm workspace exists (milestone M0)
_bootstrapped:
    @if [ ! -f package.json ]; then \
        echo "ERROR: package.json not found — repo is not bootstrapped yet."; \
        echo "This is a docs-only scaffold. Run milestone M0 first (see DESIGN.md):"; \
        echo "  scaffold the pnpm workspace (apps/web, packages/core|pipeline|db)."; \
        exit 1; \
    fi

# Enable corepack and install workspace dependencies
setup: _bootstrapped
    corepack enable
    pnpm install

# Run dev servers (Next.js app + Inngest dev server)
dev: _bootstrapped
    pnpm dev

# Start local Postgres with pgvector (docker compose)
db-up:
    @if [ ! -f docker-compose.yml ]; then \
        echo "ERROR: docker-compose.yml not found — created in milestone M0 (see DESIGN.md)."; \
        exit 1; \
    fi
    docker compose up -d postgres

# Stop local Postgres
db-down:
    @if [ ! -f docker-compose.yml ]; then \
        echo "ERROR: docker-compose.yml not found — nothing to stop."; \
        exit 1; \
    fi
    docker compose down

# Apply Drizzle migrations (packages/db)
migrate: _bootstrapped
    pnpm --filter @statutory/db migrate

# Run unit/integration tests (Vitest, workspace-wide; no database needed)
test: _bootstrapped
    pnpm test

# Run DB-backed integration tests (publish-gate triggers; needs DATABASE_URL)
test-db: _bootstrapped
    @if [ -z "${DATABASE_URL:-}" ]; then \
        echo "ERROR: DATABASE_URL is not set — the DB trust-gate suite needs Postgres."; \
        echo "Run:  just db-up && just migrate   then re-run with, e.g.:"; \
        echo "  DATABASE_URL=postgres://statutory:statutory@localhost:5434/statutory_dev just test-db"; \
        exit 1; \
    fi
    pnpm test:db

# Run end-to-end tests (Playwright, chromium; starts its own Next dev server)
e2e: _bootstrapped
    pnpm e2e

# Lint the workspace (ESLint)
lint: _bootstrapped
    pnpm lint

# Format the workspace (Prettier write)
format: _bootstrapped
    pnpm format

# Type-check the workspace (tsc --noEmit)
typecheck: _bootstrapped
    pnpm typecheck

# Production build of all packages and the web app
build: _bootstrapped
    pnpm build

# Full gate: lint + typecheck + test + build (must be green before commit)
ci: lint typecheck test build
