---
name: harper-realtime
description: This skill should be used when adding or troubleshooting Harper (HarperDB/Fabric) real-time behavior: MQTT topics, WebSocket resource subscriptions, resource publish/subscribe handlers, SSE-style streaming routes, and local subscriber verification. Pairs with harper-resources, harper-config-yaml, harper-schema-graphql, and harper-build-and-deploy.
---

# Harper Realtime

## Overview

Harper exposes live data through the same Resource model used for REST and
GraphQL. Exported tables/resources can be addressed as MQTT topics and WebSocket
paths, while custom resources can override the messaging handlers when the default
table behavior is not enough.

Use real-time primitives when the product needs pushed state: live feeds, activity
streams, collaborative views, device telemetry, or status updates. Do not replace
these with client polling unless the issue explicitly asks for polling.

## Resource and topic model

- A GraphQL type marked `@table @export` creates a default exported table resource.
- An exported JavaScript Resource class from `resources.js` creates a resource
  endpoint with the class name as the path/topic root.
- Resource paths map naturally to subscription targets: collection-level
  subscriptions use the resource name, and record-level subscriptions append the
  record id or path segment.
- MQTT supports multi-level topics and wildcards. Use `resource/#` for a resource
  subtree and `resource/+/status` for one path segment.
- WebSocket subscriptions target the REST resource URL. For example,
  `ws://localhost:9926/Activity/123` subscribes to the `Activity` resource record
  with id `123`.

Keep the URL/topic names stable. If a UI depends on `Activity/123`, changing the
resource export name is an API break.

## Resource methods

The MQTT plugin routes broker messages through Resource methods:

| Method | Use |
| --- | --- |
| `subscribe(target, context)` | Authorize and shape subscription reads for a resource or record. |
| `publish(target, message, context)` | Accept or transform messages written to a topic/resource. |
| `connect(incomingMessages)` | Customize WebSocket connection behavior for a resource. |

For table-backed resources, prefer default behavior until the product needs a
custom message shape, authorization check, fan-out, or derived event. When
overriding, preserve built-in table behavior with `super.subscribe(...)` or
`super.publish(...)` where that behavior is still wanted.

```javascript
export class Activity extends tables.Activity {
  static async publish(target, message, context) {
    const payload = await message;
    await super.publish(target, payload, context);
    return { ...payload, acceptedAt: Date.now() };
  }
}
```

For WebSocket-only behavior, implement `connect(incomingMessages)` and return an
async iterable. Use the default `super.connect()` stream when you only need to
push extra server messages or clean up on disconnect.

## Transport choices

| Transport | Best fit | Notes |
| --- | --- | --- |
| MQTT | Device streams, backend subscribers, wildcard topics, durable clients. | Plain MQTT defaults to port `1883`; MQTTS defaults to `8883`. |
| MQTT over WebSocket | Browser or edge clients using MQTT semantics. | Uses the HTTP port, default `9926`, with the `mqtt` WebSocket subprotocol. |
| Resource WebSocket | Browser live views tied to one REST resource path. | Enabled with the `rest` plugin unless `rest.webSocket: false` is set. |
| SSE/custom streaming route | One-way browser updates when WebSocket is not appropriate. | Implement as a project route; do not assume SSE automatically subscribes to Resource changes. |

Authentication is usually required for MQTT. When `mqtt.requireAuthentication` is
`false`, authorization still applies at the resource/table level, so public
connections must be explicitly allowed by roles or resource logic.

## config.yaml wiring

Component-level `config.yaml` enables the app surface:

```yaml
rest: true
graphqlSchema:
  files: schema.graphql
jsResource:
  files: resources.js
```

The root Harper `harper-config.yaml`, not the component `config.yaml`, owns broker
ports and MQTT authentication:

```yaml
mqtt:
  network:
    port: 1883
    securePort: 8883
  webSocket: true
  requireAuthentication: true
```

Keep the `rest`, `graphqlSchema`, and `jsResource` declarations together when a
project has a custom component `config.yaml`. Harper does not merge custom
component config with defaults. See [[harper-config-yaml]].

## Filtering and message shape

- Prefer record-level subscriptions (`Resource/<id>`) when the UI watches one
  entity; use collection or wildcard subscriptions only when the product needs a
  feed.
- Keep published messages typed and small. Send the changed record or a compact
  event envelope, not a full page payload.
- Include stable identifiers in custom events: resource name, id, operation, and
  timestamp are usually enough.
- Treat inaccessible or unauthenticated subscribe attempts as authorization
  failures, not empty streams.
- Do not disable the audit log for tables that need real-time messages or
  replication; Harper uses it for live subscriptions.

## Fabric and replication

For clustered/Fabric deployments, real-time behavior must match the deploy target:

- Verify against the same environment that users connect to, not only a local
  single-node process.
- Use `replicated=true` when deploying a component that needs to run across Fabric
  nodes. See [[harper-build-and-deploy]].
- Keep event handlers idempotent. A subscriber may reconnect and replay from the
  latest known state.
- If a bug appears only across nodes, capture the target URL, topic/path, node
  count when known, and the exact publish/subscribe commands in the evidence.

## Local verification

1. Build generated Harper assets from source:

   ```bash
   bun run build
   ```

2. Start the component:

   ```bash
   harper dev harper-app
   ```

3. In another shell, subscribe to a topic or WebSocket path:

   ```bash
   npx mqtt sub -h localhost -p 1883 -u HDB_ADMIN -P "$HARPER_PASSWORD" -t 'Activity/#' -v
   ```

   ```bash
   npx wscat -c ws://localhost:9926/Activity/123
   ```

4. Publish or mutate the watched record:

   ```bash
   npx mqtt pub -h localhost -p 1883 -u HDB_ADMIN -P "$HARPER_PASSWORD" -t 'Activity/123' -m '{"status":"live"}'
   ```

5. Confirm the subscriber receives the expected message shape and that a normal
   REST/GraphQL read returns the same resulting state.

Record the command, topic/path, payload, and observed message in PR evidence. If a
local Harper binary or credentials are unavailable, report that blocker instead of
claiming the subscription was verified.

## Project conventions

- Write resource code in TypeScript under `src/`; `harper-app/resources.js` is a
  generated artifact. See [[harper-resources]].
- If real-time work changes `config.yaml`, update the project Fabric runbook and
  re-run the smoke path. See [[harper-config-yaml]].
- Prefer a pushed update over a polling workaround when the issue asks for live
  behavior.
- For Lisa plugin edits, change `plugins/src/harper-fabric`, run
  `bun run build:plugins`, and commit both source and generated plugin copies.

## Sources

- [Resources overview](https://docs.harperdb.io/reference/v5/resources/overview)
- [Resource API](https://docs.harperdb.io/reference/v5/resources/resource-api)
- [WebSockets](https://docs.harperdb.io/reference/v5/rest/websockets)
- [MQTT configuration](https://docs.harperdb.io/reference/v4/mqtt/configuration)
- [Transaction logging](https://docs.harperdb.io/reference/v5/database/transaction)
