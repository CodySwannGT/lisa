---
name: harper-operations
description: "operating, monitoring, or…"
---

# Harper Operations

## Overview

Use Harper's Operations API when the app built or deployed but runtime behavior is
unknown: a REST endpoint returns 500, a component did not load, logs show worker
errors, a table shape differs from the expected schema, or a deploy job needs to be
checked. The Operations API is the administrative surface; application REST
endpoints are the user-facing data/resource surface.

Cross-check deploy packaging and Fabric topology in [[harper-build-and-deploy]].
Cross-check active extensions and config replacement behavior in
[[harper-config-yaml]]. Cross-check custom Resource method ownership in
[[harper-resources]] and query shape in [[harper-rest-queries]].

## Endpoint, auth, and request shape

Operations API requests are JSON `POST` requests to the operations endpoint. Harper
listens on port `9925` at the root path by default:

```bash
curl -sS http://<harper-host>:9925/ \
  -u "$HARPER_USERNAME:$HARPER_PASSWORD" \
  -H 'Content-Type: application/json' \
  --data '{"operation":"system_information"}'
```

For local development:

```bash
curl -sS http://localhost:9925/ \
  -u "$HARPER_USERNAME:$HARPER_PASSWORD" \
  -H 'Content-Type: application/json' \
  --data '{"operation":"get_components"}'
```

Authentication options:

- Basic auth: `Authorization: Basic ...`, or `curl -u "$USER:$PASS"`.
- JWT operation token: `Authorization: Bearer <token>` from
  `create_authentication_tokens`.
- CLI: `harper login <target>` for persistent remote auth, or environment
  credentials such as `HARPER_CLI_USERNAME` / `HARPER_CLI_PASSWORD`.

Most operational reads require a `super_user` or a role explicitly allowed to run
the named operation. If an operation is denied, check role `operations` permissions
before assuming the endpoint or component is broken.

## High-value operations

| Operation | Use it for | Example |
| --- | --- | --- |
| `get_components` | Confirm component names, files, and configuration loaded from `harper-config.yaml`. | `{"operation":"get_components"}` |
| `describe_all` | See all database/table definitions and record counts visible to the caller. | `{"operation":"describe_all"}` |
| `describe_table` | Confirm table/database names, attributes, and primary key shape. | `{"operation":"describe_table","database":"data","table":"Product"}` |
| `system_information` | Capture runtime, host, and process information for health/debug reports. | `{"operation":"system_information"}` |
| `read_log` | Read Harper's primary `hdb.log` with level/time/filter controls. | `{"operation":"read_log","level":"error","limit":50,"order":"desc"}` |
| `search_jobs_by_start_date` | Find background jobs when deploys, imports, or long operations are involved. | `{"operation":"search_jobs_by_start_date","from_date":"2026-06-16T00:00:00.000+0000","to_date":"2026-06-17T00:00:00.000+0000"}` |
| `get_job` | Inspect one known job id returned by a search or operation response. | `{"operation":"get_job","id":"<job-id>"}` |
| `get_configuration` | Find runtime paths such as `rootPath`, `componentsRoot`, ports, and logging config. | `{"operation":"get_configuration"}` |

Use CLI shortcuts when the operation only needs flat key/value arguments:

```bash
harper get_components target="$HARPER_TARGET" json=true
harper describe_all target="$HARPER_TARGET" json=true
harper read_log target="$HARPER_TARGET" level=error limit=50 order=desc json=true
```

If the CLI cannot represent the nested request body, use `curl` against the
Operations API directly.

## Reading logs

`read_log` reads the primary Harper log (`hdb.log`) and is restricted to
`super_user` roles unless a custom role grants it. Useful parameters include
`level`, `from`, `until`, `limit`, `order`, and `filter`.

Recent errors:

```bash
curl -sS "$HARPER_TARGET" \
  -u "$HARPER_USERNAME:$HARPER_PASSWORD" \
  -H 'Content-Type: application/json' \
  --data '{
    "operation": "read_log",
    "level": "error",
    "limit": 50,
    "order": "desc"
  }'
```

Filter by component, route, or correlation id:

```bash
curl -sS "$HARPER_TARGET" \
  -u "$HARPER_USERNAME:$HARPER_PASSWORD" \
  -H 'Content-Type: application/json' \
  --data '{
    "operation": "read_log",
    "filter": "orders",
    "from": "2026-06-16 00:00:00",
    "limit": 100,
    "order": "desc"
  }'
```

In local `harper dev`, also watch the terminal output. The dev command restarts
worker threads on file changes and prints console/log output close to the failing
request. Use `harper run` or a deployed local instance when you need to restart the
main thread, not only workers.

## Logging from Resources

For Resource methods, log enough to identify the request path, authenticated user
or tenant id, and failing branch without emitting secrets or whole request bodies.
Prefer structured, searchable messages:

```javascript
export class Orders extends tables.Orders {
  static async post(data, context) {
    const input = await data;
    console.info('orders.post received', {
      orderId: input.id,
      userId: context.user?.id,
    });

    try {
      return await super.post(input, context);
    } catch (error) {
      console.error('orders.post failed', {
        orderId: input.id,
        message: error?.message,
      });
      throw error;
    }
  }
}
```

Guidance:

- Use `console.info` or `console.debug` for normal trace points, and
  `console.warn` / `console.error` for actionable failures.
- Never log passwords, tokens, cookies, API keys, raw Authorization headers, or
  full personal data payloads.
- Include a request id or deterministic entity id when the caller can provide one.
- Remove noisy temporary logs once the root cause is fixed, or lower them to debug.

## Debugging a 500 endpoint

When a deployed REST endpoint returns 500, follow this path before changing code:

1. Identify the exact endpoint, method, payload, authenticated user, target URL,
   and timestamp. Save a reproducible `curl` command with headers scrubbed.
2. Confirm the component is installed and named as expected:

   ```bash
   harper get_components target="$HARPER_TARGET" json=true
   ```

3. Read recent errors around the failing timestamp:

   ```bash
   harper read_log target="$HARPER_TARGET" level=error limit=100 order=desc json=true
   ```

4. Check table/resource shape when the failure mentions a missing table, attribute,
   index, relationship, or schema directive:

   ```bash
   curl -sS "$HARPER_TARGET" \
     -u "$HARPER_USERNAME:$HARPER_PASSWORD" \
     -H 'Content-Type: application/json' \
     --data '{"operation":"describe_all"}'
   ```

5. Reproduce locally with the same built artifact path:

   ```bash
   bun run build
   harper dev harper-app
   curl -i http://localhost:9926/<project>/<resource-path>
   ```

6. Isolate the smallest Resource method or table call involved. If the route uses a
   custom Resource, call its underlying table/search operation directly when safe,
   then add one temporary log at the branch boundary that chooses the failing path.
7. Fix source files, not generated deploy artifacts. Rebuild and repeat the same
   local `curl`, then repeat the deployed smoke path after redeploy.

Treat the incident as unresolved until the same request path returns the expected
status and the logs no longer show the error.

## Health and deploy checks

After deploy or restart, check:

- Component inventory: `get_components` includes the expected project and files.
- System/runtime info: `system_information` returns from the target node.
- Configuration: `get_configuration` shows the expected operations/API ports,
  `rootPath`, `componentsRoot`, and logging configuration.
- Schema/data shape: `describe_all` or `describe_table` matches the expected
  database/table definitions and exported tables.
- Logs: `read_log` has no new error entries for the deploy/restart window.
- Jobs: `search_jobs_by_start_date` and `get_job` show background work completed
  when deploy, import, backup, or long-running data operations were involved.
- Public smoke: the project-specific HTTP smoke command passes from the same route
  users will hit. For Fabric, verify through the public route and any direct
  node/region route the project exposes.

## What is not available

Do not invent observability that the target does not expose:

- If there is no Fabric credential or operations role, you cannot prove remote
  component state; ask for credentials or a trusted operator readback.
- If the app does not emit a request id, logs may not be attributable to one HTTP
  request. Reproduce in a narrow time window or add a safe correlation id first.
- If a Fabric project hides direct node/region URLs, verify through the public
  route and record that node-level proof is unavailable.
- If Harper returns an auth/permission denial for `read_log`,
  `system_information`, or component operations, treat it as an access blocker,
  not as evidence that logs or components are empty.
- Third-party APM, trace collection, and performance tuning are outside this
  skill. Capture Harper-native facts first, then escalate to the project's
  runbook or platform owner.

## Sources

- [Operations API Overview](https://docs.harperdb.io/reference/v5/operations-api/overview)
- [Operations Reference](https://docs.harperdb.io/reference/v5/operations-api/operations)
- [Logging Operations](https://docs.harperdb.io/reference/v5/logging/operations)
- [Applications / Component Operations](https://docs.harperdb.io/reference/v5/components/applications)
