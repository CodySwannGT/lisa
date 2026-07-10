---
name: harper-auth
description: "adding or debugging Harper…"
---

# Harper Auth

## Overview

Harper uses role-based access control. Every user has one role, and that role
decides which databases, tables, attributes, and operations the user can access.
Use declarative `roles.yaml` for application-owned roles and the Operations API
for environment-owned users, password changes, role audits, and token issuance.

Cross-check extension wiring in [[harper-config-yaml]] before editing roles:
custom `config.yaml` files replace Harper's default config, so `roles` must be
re-declared alongside `rest`, `graphqlSchema`, and `jsResource` when the app needs
all of them. Cross-check endpoint/resource behavior in [[harper-resources]] and
query filters in [[harper-rest-queries]].

## Role model

Harper has built-in roles and custom roles:

| Role type | Use it for | Notes |
| --- | --- | --- |
| `super_user` | Operators, deploy automation, emergency admin work | Full access to operations and data. Do not use for app clients. |
| `structure_user` | Schema/database administration without full data access | Scope narrowly when used; normal app users usually should not need it. |
| Custom role | Application clients, readers, editors, service accounts | Permissions are explicit. Missing database/table entries mean no access. |

Prefer least-privilege custom roles for application traffic. A public read client,
an editor/admin client, and a deploy/operator client should normally be separate
users with separate roles.

## Enable role files

Keep roles in the component root, typically `harper-app/roles.yaml`, and enable
the built-in `roles` extension in `harper-app/config.yaml`:

```yaml
rest: true
graphqlSchema:
  files: 'schema.graphql'
roles:
  files: 'roles.yaml'
jsResource:
  files: 'resources.js'
```

Because `config.yaml` is not merged with Harper's defaults, keep every extension
the component needs in this file. Removing `roles` silently stops role-file
reconciliation; removing `rest` or `jsResource` can make the secured endpoint
disappear while the role still exists.

## Declare roles in `roles.yaml`

Use `roles.yaml` for roles that should be versioned with the app. On startup,
Harper creates missing declared roles and updates existing declared roles to match
the file.

Example: public readers can read orders, but only admins can write:

```yaml
public_reader:
  super_user: false
  app:
    Orders:
      read: true
      insert: false
      update: false
      delete: false
      attributes:
        id:
          read: true
        status:
          read: true
        publicTotal:
          read: true

order_admin:
  super_user: false
  app:
    Orders:
      read: true
      insert: true
      update: true
      delete: false
      attributes:
        internalNotes:
          read: true
          insert: true
          update: true
```

Rules:

- Database keys such as `app` must match the database names in `schema.graphql`.
- Table keys such as `Orders` must match the table type names, not necessarily the
  exported REST path.
- Table-level `read`, `insert`, `update`, and `delete` are the outer gate.
- Attribute permissions narrow field-level access. They cannot grant a capability
  that the table-level permission denies.
- If a database or table is omitted from the role, that role has no access to it.

Use role files for stable app permissions. Use Operations API calls when changing
users, rotating credentials, or inspecting what the deployed system actually has.

## Manage users and roles with Operations API

User and role mutations require a `super_user` caller. Send JSON `POST` requests
to the Operations API, usually port `9925` locally:

```bash
curl -sS http://localhost:9925/ \
  -u "$HARPER_USERNAME:$HARPER_PASSWORD" \
  -H 'Content-Type: application/json' \
  --data '{"operation":"list_roles"}'
```

Create a user for a declared role:

```bash
curl -sS http://localhost:9925/ \
  -u "$HARPER_USERNAME:$HARPER_PASSWORD" \
  -H 'Content-Type: application/json' \
  --data '{
    "operation": "add_user",
    "username": "public-client",
    "password": "replace-with-generated-secret",
    "role": "public_reader",
    "active": true
  }'
```

Change a user's role or password:

```bash
curl -sS http://localhost:9925/ \
  -u "$HARPER_USERNAME:$HARPER_PASSWORD" \
  -H 'Content-Type: application/json' \
  --data '{
    "operation": "alter_user",
    "username": "public-client",
    "role": "order_admin",
    "active": true
  }'
```

Remove a user before removing a role:

```bash
curl -sS http://localhost:9925/ \
  -u "$HARPER_USERNAME:$HARPER_PASSWORD" \
  -H 'Content-Type: application/json' \
  --data '{"operation":"drop_user","username":"public-client"}'
```

Avoid committing real passwords, tokens, or generated secrets. For local examples,
use environment variables or throwaway development credentials.

## Basic auth and JWT operation tokens

Harper accepts Basic auth for Operations API and secured REST calls:

```bash
curl -i http://localhost:9926/app/orders/ \
  -u "$PUBLIC_USERNAME:$PUBLIC_PASSWORD"
```

For clients that should not send Basic auth on every request, create JWT tokens
with `create_authentication_tokens`. This operation is intentionally unauthenticated
but requires the target username and password:

```bash
tokens="$(
  curl -sS http://localhost:9925/ \
    -H 'Content-Type: application/json' \
    --data '{
      "operation": "create_authentication_tokens",
      "username": "'"$PUBLIC_USERNAME"'",
      "password": "'"$PUBLIC_PASSWORD"'"
    }'
)"

operation_token="$(jq -r '.operation_token' <<<"$tokens")"
refresh_token="$(jq -r '.refresh_token' <<<"$tokens")"
```

Use the operation token as a bearer token:

```bash
curl -i http://localhost:9926/app/orders/ \
  -H "Authorization: Bearer $operation_token"
```

Refresh an expired operation token with the refresh token:

```bash
curl -sS http://localhost:9925/ \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $refresh_token" \
  --data '{"operation": "refresh_operation_token"}'
```

Treat operation tokens and refresh tokens as credentials. Never log them, commit
them, paste them into tickets, or store them in browser-accessible app config.

## Exported resources and `context.user`

Exported tables and custom Resources inherit the caller's role permissions.
If a role cannot read or write the underlying table, Harper should deny the REST
or GraphQL request before app logic treats it as successful.

Use custom Resource checks when the rule depends on request identity, tenant
ownership, or business state that is not expressible in `roles.yaml`:

```javascript
export class Orders extends tables.Orders {
  static async post(target, data, context) {
    const user = context.user;
    if (!user) {
      const error = new Error('Authentication required');
      error.statusCode = 401;
      throw error;
    }

    if (user.role !== 'order_admin') {
      const error = new Error('Forbidden');
      error.statusCode = 403;
      throw error;
    }

    return super.post(target, await data, context);
  }
}
```

Pass `context` through when delegating to tables or other resources:

```javascript
await tables.OrderEvents.post(
  target,
  {
    orderId,
    type: 'created',
    createdBy: context.user?.username,
  },
  context,
);
```

Guidance:

- Use `roles.yaml` for coarse table/attribute access and Resource logic for
  request-specific policy.
- Do not trust client-provided role, user id, tenant id, or permission claims.
  Read identity from `context.user`.
- Do not put `context` in module-level state; it belongs to one request.
- Do not use `requestWithoutAuthentication` for normal application routes. If a
  webhook must bypass Harper auth, verify its signature first and keep its table
  writes narrowly scoped.

## Session cookies are `SameSite=None` — guard state-changing POSTs

Harper hardcodes the session cookie's `SameSite=None` attribute on HTTPS. The
browser therefore attaches the session cookie to **cross-site** requests, so a
same-origin app cannot rely on `SameSite` to block CSRF on cookie-authenticated,
state-changing routes (`POST`/`PUT`/`PATCH`/`DELETE`).

Add an app-side origin check in the resource before mutating. Reject requests
whose `Origin` (or `Referer` fallback) is not an allowed origin:

```javascript
const ALLOWED_ORIGINS = new Set([
  'https://app.example.com',
]);

function requireSameOrigin(context) {
  const headers = context.requestContext?.headers ?? context.headers;
  const origin =
    headers?.get?.('origin') ??
    headers?.get?.('referer');
  const ok =
    typeof origin === 'string' &&
    [...ALLOWED_ORIGINS].some((allowed) => origin.startsWith(allowed));
  if (!ok) {
    const error = new Error('Cross-origin request rejected');
    error.statusCode = 403; // Harper reads statusCode, not status
    throw error;
  }
}

export class Watchlists extends tables.Watchlists {
  static async post(target, data, context) {
    requireSameOrigin(context);
    // ...authorization and write
    return super.post(target, await data, context);
  }
}
```

Guidance:

- Call the check on every cookie-authenticated state-changing route. Read-only
  `GET` handlers and token/`Authorization: Bearer` APIs (not cookie-driven) do
  not need it.
- Prefer an allowlist of exact origins over substring matching that a lookalike
  host could satisfy.
- This is defense the app owns; Harper will not add it for you.

## Verification matrix

Run the local app, create the test users, and check unauthenticated, reader, and
admin behavior against the same endpoint:

```bash
harper dev harper-app

# Unauthenticated request should be denied.
curl -i http://localhost:9926/app/orders/

# Reader can read.
curl -i http://localhost:9926/app/orders/ \
  -u "$PUBLIC_USERNAME:$PUBLIC_PASSWORD"

# Reader cannot write.
curl -i -X POST http://localhost:9926/app/orders/ \
  -u "$PUBLIC_USERNAME:$PUBLIC_PASSWORD" \
  -H 'Content-Type: application/json' \
  --data '{"id":"ord_1","status":"new"}'

# Admin can write.
curl -i -X POST http://localhost:9926/app/orders/ \
  -u "$ADMIN_USERNAME:$ADMIN_PASSWORD" \
  -H 'Content-Type: application/json' \
  --data '{"id":"ord_1","status":"new"}'
```

Expected results:

| Caller | Read | Write |
| --- | --- | --- |
| No credentials | `401` or auth denial | `401` or auth denial |
| `public_reader` | `200` | `403` or permission denial |
| `order_admin` | `200` | `200` or expected validation response |

Also verify metadata with a restricted user when debugging permissions:

```bash
curl -sS http://localhost:9925/ \
  -u "$PUBLIC_USERNAME:$PUBLIC_PASSWORD" \
  -H 'Content-Type: application/json' \
  --data '{"operation":"user_info"}'
```

If the status code is unexpected, check in this order:

1. `config.yaml` still enables `roles`, `rest`, `graphqlSchema`, and `jsResource`.
2. `roles.yaml` database/table names match the schema.
3. The user is active and assigned to the intended role.
4. The route being tested is the exported table/resource path you meant to secure.
5. Resource code passes `context` through to `super` and nested table calls.

## Sources

- [Users & Roles Configuration](https://docs.harperdb.io/reference/v5/users-and-roles/configuration)
- [Operations Reference](https://docs.harperdb.io/reference/v5/operations-api/operations)
- [Components Overview](https://docs.harperdb.io/reference/v5/components/overview)
