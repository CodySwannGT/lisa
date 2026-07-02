---
name: use-the-product
description: Shared methodology for actually USING a project's product the way its real end user would — across product types (DOM web app, HTTP/API backend, canvas game, CLI/library, IaC/CDK). Detects the product's consumer-facing interface, drives it as that consumer, gated by a per-environment mutation policy read from .lisa.config.json (so the agent never mutates production data by accident), and lensed through the project's personas/subagents when it defines them. Invoked by exploratory-qa (files defect/UX tickets) and product-walkthrough (grounds planning in the live product); rarely run standalone.
---

# Use the Product

## The one idea

Every product has a **consumer-facing interface**. To evaluate a product you (1) **detect** that interface, (2) **resolve where you're allowed to drive it and how much you may change**, and (3) **drive it as the real consumer would** — through the project's personas when it has them. This skill owns steps 1–4 below; the **caller** decides what to *do* with what you find (`exploratory-qa` files tickets, `product-walkthrough` grounds planning).

Driving the product means **interacting** with it. Static route scans, HTTP fetches, screenshots-alone, and reading the code are *supporting evidence only* — never a substitute for actually using it.

## 1. Detect the product type & interface

Infer from the repo; if genuinely ambiguous, ask one concise question.

| Signals | Type | Consumer-facing interface |
|---|---|---|
| `vite`/`next`/`angular`/`svelte` + `index.html`, DOM UI | **DOM web app** | the rendered UI in a real browser |
| API server (`nest`/`express`/`fastify`/serverless handlers), OpenAPI, no frontend | **HTTP / API backend** | the API endpoints |
| `phaser`/`pixi`/canvas game | **Canvas game** | the canvas + input (keyboard/pointer), read visually |
| `cdk.json` / Terraform / IaC | **IaC / CDK** | the resources it provisions (+ synth output) |
| `bin/` CLI or published library, no server | **CLI / library** | the commands / public API |

## 2. Resolve the environment & mutation policy — the gate

Read the `exploration` block from `.lisa.config.json` (a repo-local config overrides a global one):

```jsonc
"exploration": {
  "default": "<env-name>",              // which env to use when none is passed
  "environments": {
    "<name>": {
      "url": "https://dev.example.io",  // web/API target (omit for local CLI/game)
      "provision": true,                // IaC/ephemeral: stand up, then tear down
      "mutation": "forbidden | read-only | full",
      "identity": "<test-account ref>", // which login to use (env var / 1Password ref)
      "prodMutationAck": "<one sentence>" // REQUIRED to allow `full` on a production-named env
    }
  }
}
```

Resolve the target env: explicit argument → `default` → infer. Then the **mutation level governs everything**:

- **`read-only`** — only non-mutating interactions: read endpoints (`GET`), view UI without submitting, `cdk synth`/`diff`, `--help`/dry-run. Never create / edit / delete.
- **`full`** — create / edit / delete allowed, but **only as the `identity` test account** and under Mutation Discipline (§5).
- **`forbidden`** — do not exercise this environment at all.

**Safety rules — enforced regardless of config:**

- **No `exploration` block, or an unconfigured env → treat as `read-only`.** Never mutate without an explicit policy.
- **A production-named env (`prod` / `production`) defaults to `forbidden`.** It may be raised to `full` **only** when a written `prodMutationAck` justification is present (this is how a single-environment app — e.g. a local-only game whose only "env" is production and whose mutations are the user's own local save — deliberately opts in). A bare `production: { "mutation": "full" }` with **no** `prodMutationAck` is downgraded to `forbidden`, and you warn.
- **Never sign in as a real user or an admin** — only the `identity` test account.
- If evaluating something *requires* a mutation the policy forbids, stop at that boundary and report it — never escalate your own permissions.

## 3. Discover personas & subagents — soft-detect

Look for the project's personas: `wiki/personas/**` (target-player archetypes, stakeholders) and persona subagents (e.g. the `lisa-phaser` `target-player` / `player-advocate` agents).

- **Present** → drive the product **through each relevant persona**: adopt the archetype's constraints (device, session length, goals, patience, genre-literacy) and evaluate as them; run each archetype for breadth.
- **Absent** → drive as a single **generic representative end user** of the app's stated audience, and say so.

## 4. Drive the product — per type

Apply the interface's *read-only* actions always; the *mutate* actions only when the policy is `full`.

- **DOM web app** — a real browser (Playwright MCP). Land cold on the entry page, then click / type / select / submit visible controls and attempt real tasks; sweep viewport widths. *(The caller's lens supplies the specific things to look for.)*
- **HTTP / API backend** — the consumer is a client, not a browser. Read-only: read the OpenAPI/routes and call safe `GET`s (`curl`/`httpie`). Mutate: exercise representative `POST`/`PUT`/`DELETE` flows with test data as the `identity`; check status codes, payload shapes, and error responses.
- **Canvas game** — a real browser, but the UI is **drawn to a canvas, not the DOM**. Boot it (e.g. `bun run dev` + Playwright), drive via **keyboard/pointer into the canvas**, and read state **visually via screenshots** (not the accessibility tree). Mutation is usually local save state. Judge readability, game-feel, and input responsiveness — not DOM breakpoints.
- **CLI / library** — the interface is the command / public API. Read-only: `--help`, read-only commands, dry-runs. Mutate: run state-changing commands with disposable inputs.
- **IaC / CDK** — the "user" is whoever **consumes the resources the stack provisions** (plus the operator). **Read-only (default):** `cdk synth` → read the generated template; `cdk diff` vs. the deployed env; verify the resources, IAM, and outputs express what a consumer would expect. Flag over-broad IAM, missing/opaque outputs, resources that don't serve their stated purpose, and drift. **Mutate (only when `mutation: "full"` *and* `provision: true` on an ephemeral/sandbox env):** `cdk deploy` to the sandbox → recurse into the API/web playbook against the provisioned resources → `cdk destroy`. Never deploy to a real account without explicit sandbox-provisioning config.

## 5. Mutation Discipline — only when the policy is `full`

A real user creates, edits, and deletes things — exercise those flows when, and only when, the policy allows and always as the `identity` account.

- Use unique names with a clear prefix such as `qa-` or `codex-`.
- Before mutating, identify the cleanup path. After mutating, make a best effort to clean up, then verify it. If cleanup is unavailable, that itself is a finding.
- Avoid destructive bulk actions unless the account/data is clearly disposable.
- Record every mutation performed, cleanup attempts, and any residue left behind.

## What you return

Structured, raw observations for the caller — **what** you did, **as whom** (which persona / generic user), **where** (env + mutation level), **what you saw**, and **what you could not reach and why** (especially policy boundaries you stopped at). You do **not** file tickets or write plans; the caller does.
