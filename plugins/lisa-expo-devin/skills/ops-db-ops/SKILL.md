---
name: ops-db-ops
description: Database migrations, reverts, schema generation, GraphQL codegen, and the reset/seed/verify state operations for Expo + serverless backend projects. Operates on the backend (TypeORM) and frontend (GraphQL code generation).
allowed-tools:
  - Bash
  - Read
---

# Ops: Database Operations

Manage database migrations, schema generation, GraphQL code generation, and the project's
reset/seed/verify state operations.

**Argument**: `$ARGUMENTS` — operation (`migrate`, `revert`, `generate`, `schema`, `codegen`, `seed`, `reset`, `reset:verify`, `state:inventory`, `state:classify`) and optional environment (default: `dev`)

## Path Convention

- **Frontend**: Current project directory (`.`)
- **Backend**: `${BACKEND_DIR:-../backend-v2}` — set `BACKEND_DIR` in `.claude/settings.local.json` if your backend is elsewhere

## Safety

**CRITICAL**: Never run migrations or reverts against production without explicit human confirmation.

**Destructive state operations are stricter than that.** `reset` (and any `seed` that clears before
it writes) is governed by the `reset-seed-coverage` rule and never runs on the strength of a
confirmation alone:

- Run `--dry-run` first, always, and read what it says it will change. A dry run that reports an
  entity whose ownership it cannot establish is a STOP, not a warning.
- The environment is whatever the adapter resolves server-side. A `--stage`, `TEST_ENV`, URL, host,
  or public build-time variable is a *request* the adapter checks, never the answer. If the requested
  stage and the resolved environment disagree, that is a refusal to investigate — not something to
  re-run with a different flag.
- **Production has no override, in any repo, ever.** There is no flag, variable, or confirmation
  phrase that makes a production reset correct. If one appears to exist, stop and report it.
- Never invent a reset. If the project ships no reset adapter, say so and stop; do not improvise
  deletions with ad-hoc queries or the migration tooling.

## Discovery

Read the backend `package.json` to discover available migration and schema scripts:
- `migration:run:*` — run pending migrations
- `migration:revert:*` — revert last migration
- `migration:generate:*` — generate new migration from entity changes
- `migration:create` — create empty migration
- `generate:sql-schema*` — regenerate SQL schema for MCP
- AWS credential/profile scripts such as `aws:signin:*` and any environment-backed remote profile

Read the backend and frontend `package.json` to discover the state operations. Discover them; do not
assume these exact names — a project may expose them under its own, and this skill runs whatever the
project declares:
- `db:seed` / `seed:*` — write the fixture baseline
- `db:reset` / `reset:*` — converge state back to that baseline
- `db:reset:verify` / `reset:verify:*` — prove the post-state, by exact counts
- `state:inventory` — enumerate what the running environment actually holds
- `check:state-classification` — compare that inventory against the state contract

Read the frontend `package.json` to discover codegen scripts:
- `fetch:graphql:schema:*` — fetch GraphQL schema
- `generate:types:*` — generate TypeScript types

If a state script the operation needs does not exist, report the absence and the scripts that DO
exist. Do not substitute a different script, and do not fall back to running SQL by hand.

## AWS Prerequisite

All database operations (except `codegen`) require AWS credentials. Verify the target profile first:

```bash
cd "${BACKEND_DIR:-../backend-v2}"
aws sts get-caller-identity --profile {aws-profile}
```

If this is an interactive local session and credentials are expired, refresh the backend's local AWS
signin flow. In a headless or remote-routine session, use the preconfigured environment-backed
assume-role profile and do not start an SSO browser/device flow.

## Operations

### migrate (run pending migrations)

**Local database**:
```bash
cd "${BACKEND_DIR:-../backend-v2}"
STAGE={env} bun run migration:run:local
```

**Remote database**:
```bash
cd "${BACKEND_DIR:-../backend-v2}"
STAGE={env} bun run migration:run:remote:local
```

### revert (undo last migration)

**Local database**:
```bash
cd "${BACKEND_DIR:-../backend-v2}"
STAGE={env} bun run migration:revert:local
```

**Remote database**:
```bash
cd "${BACKEND_DIR:-../backend-v2}"
STAGE={env} bun run migration:revert:remote:local
```

### generate (create new migration from entity changes)

```bash
cd "${BACKEND_DIR:-../backend-v2}"
NAME={migration_name} bun run migration:generate:{env}
```

### create (create empty migration)

```bash
cd "${BACKEND_DIR:-../backend-v2}"
NAME={migration_name} bun run migration:create
```

### schema (regenerate SQL schema for MCP)

```bash
cd "${BACKEND_DIR:-../backend-v2}"
STAGE={env} bun run generate:sql-schema
```

### codegen (regenerate GraphQL types in frontend)

1. **Fetch schema**:
   ```bash
   bun run fetch:graphql:schema:{env}
   ```

2. **Generate types**:
   ```bash
   bun run generate:types:{env}
   ```

**Note**: The backend must be running (locally or deployed) for schema fetching to work.

### seed (write the fixture baseline)

Run the project's discovered seed script for the target environment. A seed is additive or
convergent, never a blind wipe; if the project's seed clears first, treat it as a reset and follow
the reset sequence below.

```bash
cd "${BACKEND_DIR:-../backend-v2}"
{package-manager} run {discovered-seed-script} --stage {env}
```

### reset (converge state back to the baseline)

Never a single command. The sequence is fixed:

1. **Dry run.** `{discovered-reset-script} --dry-run --stage {env}`. Read the enumeration. Stop on
   any entity of unknown ownership, on any `forbidden`-classified entity appearing at all, and on
   any disagreement between the requested stage and the resolved environment.
2. **Classify first if the contract is stale.** If `check:state-classification` reports an
   unclassified entity, the reset does not run — an unclassified entity is neither safe to keep nor
   safe to delete. Fix the state contract, then start over at step 1.
3. **Apply**, passing an idempotency key when running in CI:
   `{discovered-reset-script} --stage {env} --idempotency-key {run-id}`.
4. **Verify** with `reset:verify`. A reset that mutated but did not verify is a failure, not a
   partial success.
5. **Converge check.** Applying a second time must report no further change. If the second run keeps
   deleting, the ownership predicate is wrong — report it rather than re-running.

### reset:verify (prove the post-state)

```bash
{package-manager} run {discovered-verify-script} --stage {env}
```

Verification asserts **exact** expected counts per fixture entity. "At least one" passes against a
leak, which is the condition being guarded.

### state:inventory (enumerate what the environment actually holds)

Produces the runtime inventory the classification check compares against. A complete inventory
covers more than rows: identity-provider objects, object storage prefixes, search indexes, queues
and dead-letter backlogs, caches with a persistence tier, derived and materialized views, and
runtime-created jobs. Record anything that could not be enumerated, with the reason.

### state:classify (compare the inventory to the contract)

```bash
node scripts/check-state-classification.mjs
```

Exit 0 = every entity the environment holds is classified and every policy obligation is met.
Nonzero = an unclassified entity, an unswept `fixture-owned` entity, a stale classification, an
incomplete inventory, or a missing assurance. Report the findings verbatim — each names the entity
and what is missing.

## Output Format

Every state operation returns the standard command envelope on stdout — one JSON object with
`schemaVersion`, `capability`, `mode`, `operation`, `environment`, `contractVersion`, `dryRun`,
`status`, `correlationId`, and `summary{deleted,created,preserved}`. Report from that envelope, not
from prose scraped off stderr. A destructive operation that produced no envelope has not been
verified, whatever its exit code said.

Report operation result:

| Operation | Environment | Target | Status | Details |
|-----------|-------------|--------|--------|---------|
| migrate | dev | local DB | SUCCESS | 2 migrations applied |
| codegen | dev | frontend | SUCCESS | Types regenerated |
| reset | dev | reset adapter | completed | deleted 12 / preserved 31, converged on second apply, correlation `abc123` |
| state:classify | dev | state contract | failed | `public.notes` unclassified — fail closed |
