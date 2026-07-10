---
name: harper-testing
description: "adding, repairing, or designing…"
---

# Harper Testing

## Overview

Test Harper apps at the layer that proves the risk:

1. **Pure unit tests** for TypeScript helpers and data transforms.
2. **Resource unit tests** for `Resource` methods with mocked Harper runtime globals.
3. **Integration tests** against a running local Harper component with real schema,
   resources, seed data, and REST/GraphQL responses.
4. **Playwright e2e tests** against the same HTTP surface a user or client calls.

Harper application source lives in TypeScript under `src/`; deployable
`harper-app/resources.js`, `harper-app/resource-*.js`, and `harper-app/web/**` are
generated. Build before integration or e2e tests so the runtime loads the code you
just changed. See [[harper-build-and-deploy]].

## Test pyramid

| Layer | Tool | Use when | Avoid |
| --- | --- | --- | --- |
| Pure unit | Vitest | Validating transforms, validators, serializers, query builders, and other code with no Harper runtime dependency. | Mocking HTTP or tables for logic that can stay pure. |
| Resource unit | Vitest | Exercising `get`, `post`, `search`, `patch`, or permission/error logic in a resource class without booting Harper. | Treating mocked tables as proof that `config.yaml`, `schema.graphql`, or REST exposure works. |
| Integration | Vitest or shell smoke | Proving Harper boots, schema loads, `jsResource` registers code, data seeds, and endpoints respond. | Replacing this with resource mocks after config, schema, or generated artifact changes. |
| E2E | Playwright | Verifying client-observable REST/GraphQL behavior, auth states, error paths, and browser workflows. | Re-testing every pure branch through the browser. |

Use [[e2e-coverage-gaps]] after a suite exists to find missing routes and
non-happy paths. Use this skill when creating or repairing the test patterns
themselves.

## Pure unit tests

Keep business transforms importable without Harper globals:

```typescript
import { describe, expect, it } from 'vitest';
import { normalizePetName } from '../src/pets/normalize';

describe('normalizePetName', () => {
  it('trims and title-cases names', () => {
    expect(normalizePetName('  ada LOVELACE ')).toBe('Ada Lovelace');
  });
});
```

If a resource method contains complex transformation logic, extract the pure part
and test it directly. Leave a thinner resource test for runtime wiring,
authorization, and persistence behavior.

## Resource unit tests

Harper injects runtime globals such as `Resource` and `tables` when it loads
`resources.js`. Unit tests do not get those globals automatically. Test resource
methods by importing code through a seam that accepts mocks, or by setting the
minimal globals before importing the resource module.

Prefer dependency injection for new code:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { createPetsResource } from '../src/resources/pets';

describe('PetsResource.get', () => {
  it('adds adoption status from the table record', async () => {
    const table = {
      get: vi.fn(async () => ({ id: 'pet-1', name: 'Mina', adoptedAt: null })),
    };
    const Pets = createPetsResource({ Resource: class {}, table });

    await expect(Pets.get({ id: 'pet-1' })).resolves.toMatchObject({
      id: 'pet-1',
      name: 'Mina',
      adoptionStatus: 'available',
    });
    expect(table.get).toHaveBeenCalledWith({ id: 'pet-1' });
  });
});
```

When existing code must extend `tables.X` directly, isolate the runtime globals in
a test helper and import the module after setup:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('Pets resource', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('Resource', class {});
    vi.stubGlobal('tables', {
      Pets: class {
        static async get(target: { id: string }) {
          return { id: target.id, name: 'Mina' };
        }
      },
    });
  });

  it('wraps the runtime table', async () => {
    const { Pets } = await import('../src/resources/pets');
    await expect(Pets.get({ id: 'pet-1' })).resolves.toMatchObject({
      id: 'pet-1',
      name: 'Mina',
    });
  });
});
```

Keep mocks narrow. Mock only the table methods, `Resource` base behavior,
`server.resources`, or external fetch calls the method actually uses. If the test
starts recreating Harper's schema, REST routing, or auth behavior, move it to an
integration test.

## Integration tests with local Harper

Use integration tests to prove the component runs as Harper will load it:

1. Install dependencies and build TypeScript: `bun install --frozen-lockfile`
   when needed, then `bun run build`.
2. Start a local Harper process against the component, usually
   `harper dev harper-app` for watch mode or `harper run harper-app` for a
   one-shot test process. Use the project's wrapper command when present.
3. If the test lives outside the app repo, symlink the built component into
   Harper's component directory rather than copying generated artifacts by hand.
   Clean the symlink in teardown.
4. Seed data through `dataLoader` fixtures when the project owns static fixtures,
   or through REST/Operations API calls when each test needs dynamic setup.
5. Assert the real REST/GraphQL endpoint and response body.
6. Stop Harper and remove test data, temp components, and symlinks.

Shell smoke tests are acceptable when the project already has that convention.
Keep them strict: exit non-zero on boot failure, seed failure, missing endpoint,
wrong status, or wrong response shape.

Example integration skeleton:

```bash
#!/usr/bin/env bash
set -euo pipefail

bun run build

HARPER_APP_DIR="${PWD}/harper-app"
HARPER_HOME="${HARPER_HOME:-${PWD}/.harper-test}"
BASE_URL="${BASE_URL:-http://127.0.0.1:9926}"

mkdir -p "$HARPER_HOME/components"
ln -sfn "$HARPER_APP_DIR" "$HARPER_HOME/components/pets"

HARPER_HOME="$HARPER_HOME" harper run "$HARPER_APP_DIR" > /tmp/harper-test.log 2>&1 &
HARPER_PID=$!
trap 'kill "$HARPER_PID" 2>/dev/null || true; rm -f "$HARPER_HOME/components/pets"' EXIT

for _ in {1..30}; do
  curl -fsS "$BASE_URL/health" >/dev/null && break
  sleep 1
done

curl -fsS -X POST "$BASE_URL/Pets" \
  -H 'content-type: application/json' \
  --data '{"id":"pet-it-1","name":"Mina"}' >/dev/null

curl -fsS "$BASE_URL/Pets/pet-it-1" | jq -e '.name == "Mina"'
```

Adjust the health path, component name, port, and endpoint names to the project.
Do not commit local `HARPER_HOME`, logs, generated component copies, or secrets.

## Seeding and isolation

Use deterministic test data that cannot collide with developer or CI data:

- Prefix IDs with the test name and a run ID, for example
  `pet-${process.env.GITHUB_RUN_ID ?? Date.now()}`.
- Prefer per-test setup/teardown through REST or Operations API when tests mutate
  records.
- Prefer `dataLoader` fixtures for stable baseline data that every local boot
  should have.
- Make teardown idempotent; deleting a record that is already gone should not fail
  the suite.
- Keep seed fixtures aligned with [[harper-schema-graphql]]. A field or type rename
  must update fixtures, resource tests, verify scripts, and Playwright assertions in
  the same PR.

`dataLoader` is good for fast, declarative baseline rows. REST seeding is better
when the test must exercise validation, defaults, auth, or generated IDs exactly as
clients see them.

## Playwright endpoint tests

Use Playwright for HTTP behavior that needs browser tooling, request contexts,
storage state, tracing, or cross-browser/project coverage. A first endpoint spec
should cover one happy path and one non-happy path:

```typescript
import { expect, test } from '@playwright/test';

test.describe('Pets REST endpoint', () => {
  test('creates and reads a pet', async ({ request }) => {
    const id = `pet-pw-${Date.now()}`;

    const create = await request.post('/Pets', {
      data: { id, name: 'Mina' },
    });
    expect(create.ok()).toBe(true);

    const read = await request.get(`/Pets/${id}`);
    expect(read.status()).toBe(200);
    await expect(read).toHaveJSON(expect.objectContaining({ id, name: 'Mina' }));
  });

  test('rejects invalid payloads', async ({ request }) => {
    const response = await request.post('/Pets', {
      data: { name: '' },
    });

    expect(response.status()).toBeGreaterThanOrEqual(400);
    await expect(response).toHaveJSON(
      expect.objectContaining({
        error: expect.any(String),
      }),
    );
  });
});
```

If the project uses custom auth, set `storageState`, headers, or a request fixture
in Playwright config instead of embedding credentials in specs. Never commit
tokens or local `.env` values.

## Schema and verify coupling

A schema rename or resource route change is a breaking change for every verify
path that names that table, field, endpoint, fixture, or response shape.

In the same PR as a schema/resource change:

- Update `schema.graphql`, TypeScript resources, fixtures, and data loaders.
- Update Vitest resource tests and Playwright endpoint specs.
- Update shell smoke or `scripts/verify*` paths that assert row counts, joins, or
  response keys.
- Run `bun run build`, `bun run typecheck`, and the smallest relevant test command.
- For deploy-affecting changes, boot local Harper or run the project smoke command
  against the deployed endpoint. See [[harper-build-and-deploy]].

Do not report a Harper test change done only because mocks pass. At least one
verify path must prove the generated app still boots and exposes the expected
surface whenever config, schema, resources, generated artifacts, or endpoints are
part of the change.
