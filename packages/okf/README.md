# @okf/core — scaffold template

App-neutral Open Knowledge Format (OKF v0.1) layer for the pnpm-monorepo apps:
concept-doc model, deterministic YAML frontmatter, byte-stable bundle
rendering, `index.md`/`log.md` generation, and structural validation
(check IDs per [okf-lint-spec.md](../okf-lint-spec.md)). Pure functions,
zero I/O, zero runtime dependencies — writing bundles to disk/S3/git is the
consuming app's job.

**Reference copy:** `flank/packages/okf` (developed there first; keep the two
in sync when fixing bugs). A Rust twin lives at `ibrief/crates/okf` with
byte-identical rendering rules.

## Install into an app

```bash
cp -r .scaffold/okf-core <app>/packages/okf
cd <app> && pnpm install
```

The package is picked up by the shared workspace glob (`packages/*`) and the
root vitest include pattern; `tsconfig.json` extends the app's
`tsconfig.base.json`.

## Invariants

- **Deterministic bytes.** Fixed frontmatter key order, sorted file paths,
  LF endings, single trailing newline. Timestamps come from source data,
  never from the clock. Golden tests enforce this — keep them.
- **Projection-only.** Apps must render bundles from publish-gated state
  only (reviewed, span-verified rows). This package cannot check that;
  the app's export layer owns it.
