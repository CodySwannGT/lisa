# Bounded-Claims Evidence System

When a report says a piece of software is "verified," that word has to mean something specific, or it means nothing. Before this system, a claim that a button worked in the browser could be backed by nothing more than a passing unit test — and the report read exactly the same as one backed by a screenshot of the button actually working.

The bounded-claims evidence system fixes that. **Every claim names the boundary it reaches, and a claim counts as established only when the evidence behind it is of a kind that reaches that boundary.** A report you read at the gate now states its own limits.

This page is the end-to-end map: what the four disciplines are, where each one is enforced, which two configuration switches control how strict it is, and how strictness gets turned up over time.

Shipped by PRD [#1738](https://github.com/CodySwannGT/lisa/issues/1738), tickets #1835–#1841.

## The core idea, in one line

**Unit tests ≠ browser behavior ≠ a healthy deployment ≠ standards compatibility.**

Each of those is a different *boundary*. Evidence collected at one boundary never proves a claim at another. A passing unit test is a quality prerequisite — it proves the code unit behaves in isolation, and nothing more.

## The claim-boundary taxonomy

Every claim binds to exactly one boundary from a closed set, and each boundary is discharged only by evidence of the kinds that reach it:

| Boundary | What it asserts | Established by | Cannot be established by |
|---|---|---|---|
| `code-unit` | pure-logic behavior in isolation | unit `test-run-log` | — (and it satisfies no other boundary) |
| `browser` | user-visible UI behavior | `screenshot`, `recording` | a unit `test-run-log` |
| `http-api` | request/response contract | `http-transcript` | a unit `test-run-log` |
| `cli` | command behavior | `cli-output` | prose |
| `data` | persisted state | `db-query-output`, `state-dump` | a unit `test-run-log` |
| `deploy-health` | a healthy running deployment | `deploy-log` | any pre-deploy artifact |
| `performance` | latency / throughput / frame timing | `perf-trace` with methodology | a screenshot |
| `standards-compat` | conformance to an external standard | `cli-output` / `test-run-log` from the compat runner | assertion prose |

The contract lives in the `claim-evidence-mapping` rule pair — a short load-bearing `rules/eager` head and the full `rules/reference` body. Every other surface cites it; none restates it.

## The four disciplines

### 1. Bounded claims

The verdict file every flow writes — `.lisa/verification-status.json`, schema **v2** — records, for each claim, a `claim_id`, the plain-language `statement`, its `boundary`, the `required_evidence_kinds` that reach that boundary, and the `evidence_refs` that were actually cited. Citing evidence whose kind does not reach the boundary is a defect, not a matter of taste.

### 2. Not established

Every verdict and every evidence comment carries a **Not established** section: what was *not* proved — boundaries not exercised, environments not tested, behavior consciously left out of scope. It is never omitted and never blank; with nothing outstanding it renders `None outstanding — reviewed`, and a `not_established_reviewed` flag attests that somebody asked the question even when the answer was "nothing." A report that lists only what passed is unreadable at a gate: a journey that skipped an edge state looks identical to one that covered it.

### 3. Artifact identity

A claim applies only to the artifact its evidence was collected against. The verdict pins `artifact.head_sha` — the commit the run observed — and every evidence entry pins the `artifact_head_sha` in force when it was captured, a `sha256` content digest, and `captured_at`. Pre-merge evidence counts for a merge commit only when that head is a parent of the merge, using the one ancestry-plus-deploy-run definition of "what shipped" that `lisa-drive-pr-to-merge` already owns. A mismatched SHA or a digest that no longer recomputes fails loudly, naming both values.

### 4. Two-bucket security findings

A security finding is **proven** only when it has both a reproducer of a reaching kind and a bounded impact or exploitability statement. Missing either, it renders **unproven**, with its reason stated — and it stays in the security section. It is never quietly demoted to maintenance work because nobody could prove it yet.

## Where each discipline is enforced

| Surface | What it does | Runtime |
|---|---|---|
| `claim-evidence-mapping` rule pair | states the contract | every agent with a rules surface |
| `lisa-implement` step 2a | tells the flow to write the v2 verdict, and carries the prose gate | all six agents |
| `enforce-verification-gate.sh` Stop hook | refuses to let the flow stop on a non-terminal or contract-violating verdict | **Claude only** |
| `lisa-spec-conformance` / `spec-conformance-specialist` | cross-checks each shipped requirement's proof against its claim's boundary, artifact identity, and Not-established review; a mismatch is a `BOUNDARY_MISMATCH` finding forcing a `DIVERGES` verdict | all six agents |
| `lisa-tracker-evidence` and the vendor evidence skills | refuse to post an evidence comment missing the required sections or identity values | all six agents |
| `lisa-security-review` / `lisa-security-zap-scan` | split findings into the proven and unproven buckets | all six agents |
| `tests/fixtures/verification/` fixture suite | drives five named failure modes through the real hook, twice — enforcement off and on | CI |

## The two configuration flip points

Both live in `.lisa.config.json`, and both are deliberately conservative out of the box:

| Setting | Default | Effect |
|---|---|---|
| `verification.gate.enforceBoundaries` | `false` | While `false`, the Stop hook's v2 claim, identity, and Not-established checks are **advisory** — a violation is reported to stderr but does not block. Set to `true` and the same violations block completion. |
| `security.review.unprovenBucket` | `security-unproven` | The label an unproven security finding renders under. It stays inside the security section under whatever name you give it. |

An advisory warning is a defect to fix now, not a warning to live with — it becomes blocking on the ratchet.

## The advisory → blocking ratchet

New enforcement lands **advisory-first** so an existing project is never red on day one. Turning it up is a deliberate, reviewed act, governed by the same threshold-ratchet discipline as every other Lisa gate: thresholds may only tighten, and loosening one requires an explicit allow entry merged in its own PR first.

The path for a project is:

1. Adopt the disciplines. Verdicts are written in v2; violations are reported but do not block.
2. Read the advisories. Each one is a real gap between what a report claimed and what its evidence reached.
3. Fix them, then flip `verification.gate.enforceBoundaries` to `true` in its own PR. From then on the gate blocks.
4. The flag never goes back down without a ratchet allow entry.

## Six-agent parity, and the one honest gap

Claude Code is the reference implementation; a discipline that only Claude sees is a discipline five of six agents ignore. The source of truth is `plugins/src/base/`, and `bun run build:plugins` fans it to Claude, **Codex** (via the `.codex-plugin` pointer inside the Claude artifact), **Cursor**, **Antigravity** (agy), and **Copilot**. **OpenCode** reads the same `.claude/skills` and `AGENTS.md` surfaces directly. `bun run check:plugins` fails if any generated artifact drifts from source.

Two representation gaps are documented rather than dropped:

- **The Stop hook is Claude-only.** No other runtime can refuse to stop. On those harnesses the prose gate in `lisa-implement` carries the same v2 expectations by convention, and the flow records its own self-check in the completion summary.
- **Antigravity artifacts carry no rules tree.** The obligation travels in the skills instead, which every runtime does carry.

Where a surface cannot be represented, the rule is always the same: cite the contract, continue, and write the gap down. Never block on an absent surface, and never let a discipline silently disappear.

## Related

- `plugins/src/base/rules/reference/claim-evidence-mapping.md` — the full contract
- `plugins/src/base/rules/reference/verification.md` — the verification framework and artifact-type taxonomy
- [Pattern B Per-Agent Plugin Variants](../architecture/pattern-b-fan-out-spec.md) — how the fan-out works
