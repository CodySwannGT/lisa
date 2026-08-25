# Release evidence reuse

**Issue:** CodySwannGT/lisa#3013 — *release replays quality instead of reusing exact-tree evidence*
**Status:** design, staged. Stage 1 is the verifier; Stage 4 is the first stage that saves a minute.
**Related:** #2829 (declined — the generic moment-budget direction), #3011 (skips only gates already
`off`), #3022 / PR #3153 / PR #3156 (the evidence envelope this design reuses), #3039 and #3096
(check-run name derivation and the per-moment `caller_chain` override), #2049 (the reusable-workflow
permission escalation that produced the standing rule).

---

## 1. What this is and is not

Release calls the full quality workflow again after merge, on a tree that already passed the same
contract on its pull request. In a bounded caller sample, 654 of 946 billed minutes were nested
release-quality work (69%).

This design lets release **reuse a proof it can verify**, and only that. It does not shrink the gate
plan, does not relabel a gate, does not add a `skip_jobs` shortcut, and does not let an absent proof
produce a green anything. #2829 was declined and nothing here revives it: the gate set at the release
moment is unchanged, gate by gate, and every gate not covered by a verified proof runs exactly as it
runs today.

The one-sentence rule the whole document serves:

> A gate may stand down only when a **verified** envelope proves **the same tree** under **the same
> or a stricter contract**, and every unproved dimension makes the gate **run**.

---

## 2. The real call graph

All paths relative to the repository root. Line numbers are as of `650b56424`.

### 2.1 The release path (where the 69% is spent)

| # | File | Where | What |
|---|---|---|---|
| 1 | `cdk/create-only/.github/workflows/deploy.yml` | `:96` | `uses: CodySwannGT/lisa/.github/workflows/release.yml@main` |
| | | `:98-100` | job-level `permissions: contents: write, pull-requests: read` |
| 1' | `.github/workflows/deploy.yml` (Lisa's own) | `:38-43` | workflow-level `contents: write`, `packages: write`, `issues: write`, `pull-requests: write`, `id-token: write` |
| 2 | `.github/workflows/release.yml` | `:371-392` | job `quality` |
| | | `:380-382` | `permissions: contents: read, pull-requests: read` |
| | | `:383` | `uses: ./.github/workflows/quality.yml` |
| | | `:389` | `moment: ${{ inputs.moment \|\| 'pull-request' }}` |
| | | `:394-402` | job `version`, `needs: [… quality …]`, gated on `needs.quality.result == 'success'` |
| 3 | `.github/workflows/quality.yml` | `:296-346` | `gate_plan` — the #3011 planner. Outputs `plan`; `EXPECTED_PLAN_KEYS` at `:315` |
| | | `:389-523` | `gate_legs` — resolves declared gates no built-in job proves |
| | | `:525-…` | `declared_gates` — the matrix that runs them |
| | | every gated job | `needs: [gate_plan]` + `if: … !contains(needs.gate_plan.outputs.plan, '"<job>":"skip"')` |

**Read `release.yml:389` carefully.** The release-side quality call defaults `moment` to
`pull-request`. That is not an accident of this design — it is the current shipped default, and it is
precisely why the release run re-proves the pull-request gate set. The subject and the contract are
already nominally the same; nothing today checks that they *are*.

### 2.2 The pull-request path (where the proof is produced)

| File | Where | What |
|---|---|---|
| `.github/workflows/ci.yml` | `:12-25` | calls `quality.yml` with `contents: read`, `issues: read`, `pull-requests: read` |
| `.github/workflows/quality.yml` | `:270-294` | the least-privilege header: `contents: read` is the **floor**, "Never widen this floor" |

### 2.3 The envelope that already exists

Shipped by #3022 for the deploy-moment runner. Reused verbatim; no second schema.

| File | Where | What |
|---|---|---|
| `all/copy-overwrite/scripts/lisa-run-gates.mjs` | `:985` | `EVIDENCE_SCHEMA = "lisa.gate-evidence/v1"` — and its doc comment already names #3013 |
| | `:995-1008` | `EVIDENCE_VERDICT` — `proved` / `blocked` / `refused` / `no-gates` / `fell-back` / `runner-failed` |
| | `:1039-1060` | `canonical()` + `digest()` — key-ordered sha256 |
| | `:1087-1116` | `planDigest()` — digest of the **resolved plan**, `includeOff: true` |
| | `:1175-1182` | `evidenceSubject()` — `repository`, `tree`, `commit`, `ref` |
| | `:1205-1216` | `evidenceContract()` — `moment`, `runner`, `gates_digest`, `registry_version`, `workflow_ref`, `workflow_sha`, `inputs_digest` |
| | `:1257-1276` | `evidenceProducer()` — `run_id`, `run_url`, `caller_chain`, **`reused_gates`** |
| | `:1311-1328` | `gateEvidence()` — one row: the seven `EVIDENCE_FIELDS` plus `level` and `label` |
| | `:1352-1373` | `evidenceDocument()` |
| `all/copy-overwrite/scripts/lisa-gates.mjs` | `:2688-2696` | `EVIDENCE_FIELDS` |
| | `:2720-2744` | `readEvidence()` — demotes a work-less or stale `pass` to `unknown` |
| | `:935-990` | `QUALITY_JOB_GATES` — the job → gate table |
| `.github/workflows/gates.yml` | `:255` | `LISA_GATE_EVIDENCE_INPUTS: ${{ toJSON(inputs) }}` |
| | `:278-292` | `--evidence=<file>` |
| | `:370-372` | the "runner too old to record" discriminator — greps for the schema token |
| | `:388` | recorded-nothing is **fatal**, not all-clear |
| | `:439-446` | `actions/upload-artifact@v7`, name `lisa-gate-evidence-<slug>-<attempt>` |

---

## 3. The permission wall, and the one shape that fits through it

This section exists because it eliminates every architecture that looks obvious.

### 3.1 The measured facts

1. `checks: read` is not obtainable inside `gates.yml` (recorded on #3013 as a comment). Neither
   `continuous-gates.yml` nor `deploy.yml` grants it; a called workflow's `permissions:` is a
   **ceiling**, and an omitted scope is zeroed, not inherited.
2. The same wall applies to `release.yml`, and harder. `release.yml:374-379` records it in the file:
   *"release.yml is ITSELF a called workflow (host deploy.yml invokes it), so a scope requested here
   must be granted by every one of those hosts or their whole run dies at startup with zero jobs."*
   GitHub's failure mode is a startup error naming the scope — not a silent downgrade.
3. `cdk/create-only/.github/workflows/deploy.yml:98-100` grants the release call exactly
   `contents: write` and `pull-requests: read`. Every consumer's `deploy.yml` is **create-only**, so
   Lisa cannot change what existing consumers grant.

**Consequence, stated as a hard constraint:** `release.yml` and `quality.yml` may request **no new
permission scope, ever**. Adding `actions: read` to `release.yml` would kill the release run of every
consumer whose `deploy.yml` predates the change, at startup, with zero jobs and no gate output. That
is strictly worse than the redundant run this issue is about.

### 3.2 What is scope-free

`actions/upload-artifact` and a **same-run** `actions/download-artifact` authenticate with the Actions
**runtime token**, not `GITHUB_TOKEN`. `quality.yml:284-286` already states this in its own
least-privilege audit: *"artifact upload/download and cache use the run-scoped runtime token, not
GITHUB_TOKEN."* `gates.yml:439-446` already uploads an evidence envelope under `contents: read`.

A **cross-run** artifact read is the only part that needs `actions: read`.

### 3.3 The shape

Split the operation at exactly the permission boundary:

```
  PR run (a separate workflow run)
  ci.yml ──► quality.yml  [contents: read]
                 └─ evidence_record ──► artifact "lisa-gate-evidence-pull-request-<attempt>"
                                        (upload: runtime token, no scope)

  Release run (one run; release.yml and quality.yml are nested calls inside it)
  deploy.yml  [top-level workflow — CAN hold any scope]
    └─ quality_evidence  [permissions: actions: read, contents: read]
         · finds the PR run for HEAD and downloads its envelope   ← the only cross-run read
         · re-uploads the bytes into THIS run as "lisa-inbound-gate-evidence"
    └─ release.yml@main  [unchanged permissions]
         └─ quality.yml  [contents: read — unchanged]
              └─ gate_plan
                   · same-run download of "lisa-inbound-gate-evidence"   ← no scope
                   · runs the verifier against LOCALLY OBSERVED facts
                   · emits skip decisions into the plan it already emits
```

Three properties fall out, and they are why this shape was chosen over the alternatives:

- **No scope is added to any reusable workflow.** `quality.yml` keeps its `contents: read` floor
  byte-for-byte; `release.yml` keeps `contents: read, pull-requests: read`. No startup failure is
  possible anywhere, on any consumer, ever.
- **The caller is a dumb pipe.** It fetches bytes and re-uploads them. It cannot decide that a gate
  may stand down, because the verifier that decides runs inside `quality.yml` and checks every
  dimension against facts it observes locally — the tree it checked out, the gates block it resolved,
  the workflow sha it is running as, the inputs it was handed. A forged or substituted envelope buys
  nothing; it fails a check and every gate runs.
- **Absence is the default everywhere.** On a pull-request run there is no inbound artifact. On every
  existing consumer's release run there is no inbound artifact, because their create-only
  `deploy.yml` has no fetch job. The download misses, the plan is `{}`, and every job runs — the
  behaviour that ships today, unchanged, with no migration and no ruleset edit.

### 3.4 Alternatives considered and rejected

| Alternative | Why not |
|---|---|
| `release.yml` reads the PR run's artifact directly | Needs `actions: read`; declaring it kills every non-granting caller's run at startup (§3.1.2, §3.1.3). |
| `release.yml` declares no `permissions:` and inherits | Inherits `contents: write` + `id-token: write` from Lisa's `deploy.yml` — the opposite of minimal — and still gets `actions: none`, so it still cannot read. |
| Read check-run conclusions instead of an envelope | `checks: read`, same wall. And *"a green status is not evidence"* — the issue says so, and a skipped required job reports success (§4.4). |
| `actions/cache` | A cache written on `refs/pull/N/merge` or a feature branch is not readable from `main`. Cache scoping is one-directional the wrong way. |
| A git ref / git note written by the PR run | Needs `contents: write` on the pull-request path. `quality.yml:294` — *"Never widen this floor."* |
| Commit the envelope into the tree | It would change the tree it attests. |
| Pass the whole envelope down as a `workflow_call` input | Works, but puts a ~8 KB JSON blob through an input with a platform size limit, and adds an input to `release.yml` that every caller must learn. The same-run artifact carries arbitrary size with no interface change. |
| Pass a pre-computed **plan** down as an input | Moves the trust boundary to the caller. The caller would then be able to make a gate stand down by asserting it. Rejected on principle: the verifier must re-derive from local facts. |

---

## 4. The attestation

### 4.1 Schema — reused, not reinvented

`lisa.gate-evidence/v1`, exactly as `lisa-run-gates.mjs:985` defines it. The doc comment there
already anticipates this design:

> *Shared verbatim with the release verifier in CodySwannGT/lisa#3013. Two producers — this one at
> the deploy moments, that one at `pull-request` — and ONE schema … The verifier keys on
> `contract.moment` and refuses to satisfy a `pre-deploy:*` gate with a `pull-request` envelope
> regardless of tree match, so the two producers never compete.*

No field is added to the envelope. Everything the verifier needs is already there. What is added is a
**classification**, which lives in the registry (§5), not in the envelope — because the classification
is a property of the gate, not of one observation of it.

### 4.2 The second producer: `evidence_record` in `quality.yml`

The deploy-moment producer is `lisa-run-gates.mjs`, which runs every gate in-process and therefore
has a `GateRun` to record. The pull-request moment has no such object: `quality.yml`'s gates are
~25 hand-written jobs. So the second producer is an **aggregator job**.

```yaml
evidence_record:
  name: 🧾 Record Gate Evidence
  permissions:
    contents: read           # unchanged floor; upload uses the runtime token
  needs: [gate_plan, lint, lint_slow, typecheck, …]   # every QUALITY_JOB_GATES job
  if: always()
  runs-on: ubuntu-latest
  steps:
    - checkout
    - run: node <resolver> quality-evidence
             --moment=${{ inputs.moment }}
             --job-results='${{ toJSON(needs) }}'
             --plan='${{ needs.gate_plan.outputs.plan }}'
             --skip-jobs='${{ inputs.skip_jobs }}'
             --evidence=$RUNNER_TEMP/lisa-gate-evidence.json
      env:
        LISA_GATE_EVIDENCE_INPUTS: ${{ toJSON(inputs) }}
        LISA_GATE_EVIDENCE_CALLER_CHAIN: <derived, or unset — see below>
    - uses: actions/upload-artifact@v7
      with:
        name: lisa-gate-evidence-${{ inputs.moment }}-quality-${{ github.run_attempt }}
```

`quality-evidence` is a new subcommand implemented **by calling the same exported helpers**
`lisa-run-gates.mjs` already uses (`evidenceSubject`, `evidenceContract`, `evidenceProducer`,
`gateEvidence`, `evidenceDocument`). One schema, one implementation of the header, two callers.

**Status mapping, conservative by construction.** A GitHub job `result` is not a proof:

| job `result` | row `status` | why |
|---|---|---|
| `success` **and** the plan action for that job was `run` **and** its token is not in `skip_jobs` | `pass` | it ran and it passed |
| `success` but plan action was `skip`, or its token appears in `skip_jobs` | `unknown` | this is the vacuous green — a required context that ran zero steps. It must never become a `pass` row. |
| `failure` | `fail` | |
| `skipped`, `cancelled`, anything else | `unknown` | nothing measured the property |

That table is the producer's whole safety argument, and it is a direct application of the doctrine at
`lisa-run-gates.mjs:1010-1018`: only PASSED becomes `pass`; everything else becomes `unknown`, which
is neither an accusation nor a credit.

**`work` stays `null`** until a per-job prover-output parser exists. `readEvidence`
(`lisa-gates.mjs:2727-2732`) demotes a `pass` with no work count to `unknown` for any gate whose
registry entry names one — so the conservative value fails safe and a gate with a declared `work`
count is simply not reusable yet. That is a gap, and it is named here rather than papered over.

**`reused_gates` is derived, never hardcoded.** The producer writes the set of gates whose row came
from a reused proof, read from `gate_plan`'s own reuse ledger. On a pull-request run that set is
empty because there is no inbound artifact — but it is empty *by derivation*, so the invariant is
enforced rather than assumed. See §6.

### 4.3 Where it is stored and how release gets it

- **Stored:** as a workflow artifact of the pull-request quality run, named
  `lisa-gate-evidence-pull-request-<run_attempt>`. Same naming family as `gates.yml:443-445`.
  Artifact retention is the repository default; an expired artifact is simply absent, which is the
  fail-closed case.
- **Retrieved (cross-run, in the caller):** `deploy.yml`'s `quality_evidence` job, holding
  `actions: read`, resolves the pull request merged into `HEAD` and the quality-bearing run for its
  head SHA, downloads the artifact, and re-uploads the bytes into the release run as
  `lisa-inbound-gate-evidence`.
- **Retrieved (same-run, in `gate_plan`):** `actions/download-artifact@v4` with
  `name: lisa-inbound-gate-evidence` and `continue-on-error: true`. A miss leaves no file.

**Why "a green status is not evidence" is honoured.** The verifier never reads a check run, a commit
status, or a run conclusion. It reads a document that states *what tree*, *under what contract*, *by
what run*, *at what time*, *for each gate, at what level*. Every one of those is checked. A run
conclusion carries none of them.

**Why the artifact is a trusted source despite being writable by any job in the run.** Two arms:
(a) within a run, only workflow files from the base repository can upload — a fork pull request runs
the base repo's workflow definitions, so a fork cannot add an uploading job; (b) it does not matter,
because the verifier trusts nothing about the artifact's provenance and re-checks every dimension
against locally observed facts. The artifact is a transport, not an authority.

### 4.4 The skipped-required-check hazard, and why reuse does not step on it

**Fact:** a skipped job reports SUCCESS to branch protection. "Did not run" and "passed" are the same
signal to a ruleset. `quality.yml:78-113` documents this at length, and the
`🔒 Skipped Required Checks` job (`quality.yml:3660`) exists to detect it.

**Why reuse is nonetheless allowed to skip a job at the release moment, and only there:**

1. Branch-protection required contexts are evaluated **on pull requests**. The release-side quality
   run happens on a `push` to the default branch, after merge. Its check runs are not matched against
   a ruleset; they gate the `version` job through `needs` + `needs.quality.result == 'success'`
   (`release.yml:397-402`), and a skipped `needs` dependency resolves to a non-`success` result for
   the *reusable-workflow call* only if the call itself is skipped, which it is not.
2. The verifier is **only ever consulted at a moment whose evidence it verified**. It cannot make a
   pull-request-moment job stand down on a pull-request run, because on that run there is no inbound
   artifact to verify (§3.3).
3. The skip is never silent. §7 requires the ledger and the skipped set to be provably the same set,
   and makes the summary job **fail** when they are not.

**What is explicitly forbidden:** a `skip_jobs` token, a blanket switch, or any path where the
*absence* of evidence produces a skip. Absence produces `{}`, and `{}` runs everything.

---

## 5. The gate partition, against the real registry

Three classes. The class is a property of the **gate**, declared in the registry, defaulting to
`never`.

```jsonc
// .lisa.config.json — per-gate override
"gates": {
  "dependency-vulnerability": {
    "pull-request": "required",
    "reuse": { "class": "time-sensitive", "max_age_minutes": 60 }
  }
}
```

A built-in default table `GATE_REUSE_CLASS` lives beside `QUALITY_JOB_GATES` in `lisa-gates.mjs`, so
the known gates are classified on day one. **A gate id absent from both the table and the project's
declaration is `never`.** A test derives the table's key set from the registry's gate ids and fails
when a gate is added without a classification — so a new gate cannot silently inherit one, and cannot
silently become reusable.

### 5.1 Class A — deterministic, reusable

Same tree + same contract ⇒ same verdict. No external state is consulted. These are the minutes.

| gate | job (`QUALITY_JOB_GATES`) | note |
|---|---|---|
| `code-style` | `lint` | |
| `code-style-slow` | `lint_slow` | |
| `format-conformance` | `format` | |
| `type-correctness` | `typecheck` | |
| `build-integrity` | `build` | |
| `dead-code` | `dead_code` | |
| `conflict-residue` | `conflict_markers` | |
| `structural-rules` | `sg_scan` | |
| `test-correctness` | `test_unit` | |
| `test-meaningfulness` | `test_mutation` | |
| `test-node-suites` | `test_node_suites` | |
| `threshold-monotonicity` | `threshold_ratchet` | compares against the committed ledger, which is in the tree |
| `journey-coverage` | `e2e_coverage` | static analysis of routes vs specs |
| `behavior-contract` | `bdd_coverage` | a **diff** gate; see the caveat below |
| `state-classification` | `state_classification` | |
| `learnings-budget` | `learnings_budget` | |
| `security-floor-integrity` | `floor_collisions` | reads the lockfile and the floors, both in the tree |
| `coverage-adequacy` | `verification_coverage` | `pull_request`-only today (`quality.yml:1191`); reuse is a no-op for it |
| `performance-budget` | `performance_budget` | see below |

**`behavior-contract` and any diff gate.** These resolve a base revision. `release.yml:19-25` already
records that a diff gate *"fails structurally on a push-triggered release because there is no base
revision to diff"*. Reusing the pull-request proof of a diff gate is therefore not merely cheaper —
it is the only place the gate is meaningfully provable. The verifier still requires the tree to match;
the diff that produced the verdict is captured in `contract.gates_digest` only as the gate's
declaration, not as the base, so a diff gate's row is reusable **only when `subject.commit` also
matches**, not just `subject.tree`. That is a strictly stronger binding for this sub-class, and it is
stated here so it is implemented rather than discovered.

**`performance-budget` is deterministic, deliberately.** Its measurement varies with runner speed, so
it is not a pure function of the tree. But the property it gates is a property of the code, and
runner variance is noise in both directions: rerunning it on the release path adds a second sample of
the same noise, not a second proof. Reusing the pull-request verdict is the same rigour at a
different sample. If a project disagrees it declares `"class": "time-sensitive"` with a window.

### 5.2 Class B — time-sensitive, reusable inside a window

The verdict depends on external state that changes without the tree. `readEvidence` already enforces
the window (`lisa-gates.mjs:2733-2742`) — the design supplies the number, per gate, into the row's
`max_age_minutes`.

| gate | job | window | why that window |
|---|---|---|---|
| `dependency-vulnerability` | `npm_security_scan`, `snyk` | 60 min | Advisory databases publish continuously. The window bounds how long we accept not having re-queried one. 60 minutes sits comfortably above the observed merge→release latency (minutes) and well below the interval over which a *given lockfile's* advisory set meaningfully changes. Re-proving is also cheap for this gate, so the cost of a narrow window is small. |
| `credential-leakage` | `secret_scanning` | 60 min | The detector ruleset is vendor-side and updates without notice. Same reasoning, same cost profile. |
| `license-compliance` | `license_compliance` | 60 min | Registry license metadata can change under a pinned version (a relicense, a corrected manifest). Rare, but externally sourced. Uniform 60 rather than a bespoke number, because a per-gate number nobody can justify is worse than one number that is stated and overridable. |

**The window is declared, never inferred.** A gate classified `time-sensitive` with no
`max_age_minutes` is a configuration error and `validate` refuses it — the same posture as every
other half-written declaration in this registry. An inferred window would be a number the system
made up about how stale a security answer may be.

### 5.3 Class C — never satisfiable by pull-request evidence

| gate | job | why |
|---|---|---|
| `traceability` | `work_item_traceability` | `pull_request`-only (`quality.yml:3908`). It does not run on the release path today; nothing to reuse and nothing to save. |
| `static-security` | `sonarcloud` | The main-branch analysis is a **publishing** action — it updates the project's server-side baseline — not only a proof. Skipping it would silently stop maintaining the baseline every later PR is measured against. |
| `e2e-browser` | `playwright_e2e_aggregate` | Environment-specific: it exercises a running application. |
| `e2e-native` | `maestro_e2e` | Environment-specific: a device and a build. |
| `environment-reset` | `environment_reset` | Environment-specific by definition. |
| `environment-reseed` | `environment_reseed` | Environment-specific by definition. |
| `code-review` | (`await` gate) | Awaits a third-party signal *about a pull request*. There is no pull request at the release moment. |
| `artifact-freshness` | — | Cheap, and it is the guard that catches a stale generated artifact; a gate whose job is to detect drift should not be satisfied by a record of a previous run. |
| `gate_config_validity`, `skipped_required_checks` | `NON_DECLARABLE_JOBS` | *"A gate whose job is to detect silencing cannot itself be silenceable"* (`quality.yml:107-112`). Reuse is a form of silencing. They are seconds. |

**Pre-deploy, post-deploy, approval, publishing and environment-specific gates need no list.** The
verifier refuses any row whose envelope's `contract.moment` is not the moment being planned. A
`pre-deploy:production` gate can only be satisfied by a `pre-deploy:production` envelope, and a
pull-request envelope carries `contract.moment: "pull-request"`. This is structural, so it cannot go
stale when a gate is added. The Class C table above exists for gates that share the *same* moment and
must still never be reused; the moment check handles everything else for free.

---

## 6. Circular reuse

The hazard: run B reuses run A's evidence, then emits its own envelope; run C reuses B's; nothing was
ever proved. `lisa-run-gates.mjs:1244-1254` already names it and ships the field that closes it.

Three independent arms, all fail-closed:

1. **`producer.reused_gates` non-empty ⇒ the whole envelope is refused as a source.** Primary proof
   only. The field is emitted from day one, empty, precisely so that an absent field and an empty one
   are distinguishable — a reader can tell "this producer never reuses" from "this producer predates
   the field."
2. **`producer.caller_chain` deeper than the pull-request path ⇒ refused.** #3039 established that a
   check run's name is the `/`-joined chain of job names reaching it, and #3096 added a per-moment
   override. A release-path envelope carries a two-level chain (`🚀 Release / 🔍 Quality Checks`);
   a pull-request envelope carries one. Only a chain the *caller derived* is trusted; a `null` chain
   is ineligible, which is the safe direction (`lisa-run-gates.mjs:1218-1229`).
3. **`contract.moment` must equal the moment being planned.** A release run planning `pull-request`
   accepts only a `pull-request` envelope — and the release run's own envelope, if it emits one, is
   refused by arm 1 the moment it reused anything.

The producer must write `reused_gates` **from `gate_plan`'s ledger**, not as a literal `[]`. A
hardcoded empty list would make arm 1 an assertion about the code rather than a fact about the run.

---

## 7. The verifier

A new subcommand on the existing resolver: `lisa-gates.mjs reuse-plan`.

```
node scripts/lisa-gates.mjs reuse-plan
     --moment=<moment>
     --evidence=<path>              # the inbound envelope
     --tree=<sha>  --commit=<sha>   # locally observed
     --workflow-ref=<ref> --workflow-sha=<sha>
     --inputs=<json>
     --json
```

It emits, per gate, `{"gate": …, "job": …, "decision": "reuse"|"run", "why": …, "proof": <run_url>|null}`,
and a top-level `verdict` naming the envelope-level outcome. `gate_plan` folds the `reuse` decisions
into the `{job: "run"|"skip"}` map it already emits and already validates against
`EXPECTED_PLAN_KEYS` (`quality.yml:315`).

### 7.1 Fail-closed behaviour, per failure mode

Envelope-level failures discard the **whole** envelope. Row-level failures affect **one** gate.

| # | Dimension | Failure | Verdict | Effect |
|---|---|---|---|---|
| **Envelope-level — every gate runs** |
| 1 | availability | no artifact, download error, empty file | `unavailable` | all run |
| 2 | availability | file larger than the stated byte budget | `unavailable` | all run |
| 3 | parse | not JSON, not an object, `gates` not an array | `malformed` | all run |
| 4 | schema | `schema !== "lisa.gate-evidence/v1"` | `malformed` | all run — the token is refused literally, never best-effort parsed past (`lisa-run-gates.mjs:970-976`) |
| 5 | verdict | envelope `verdict !== "proved"` | `not-proved` | all run — `blocked`, `refused`, `no-gates`, `fell-back`, `runner-failed` are all "nothing to reuse" |
| 6 | subject | `subject.repository !== GITHUB_REPOSITORY` | `subject-mismatch` | all run |
| 7 | subject | `subject.tree !== <locally observed HEAD^{tree}>`, or either is null | `subject-mismatch` | all run |
| 8 | contract | `contract.moment !== <moment being planned>` | `contract-mismatch` | all run |
| 9 | contract | `contract.gates_digest` null, or `!==` the digest recomputed locally from the checked-out registry | `contract-mismatch` | all run |
| 10 | contract | `contract.workflow_ref` / `workflow_sha` null, or `!==` the workflow this run is executing | `contract-mismatch` | all run — a consumer calls `@main`, so the same tree can be judged by a different workflow (`lisa-run-gates.mjs:1184-1191`) |
| 11 | contract | `contract.inputs_digest` null, or `!==` the digest of this run's normalized inputs | `contract-mismatch` | all run |
| 12 | contract | `contract.registry_version` null, or **older than** this run's | `contract-mismatch` | all run — a newer registry may declare more, or declare it stricter |
| 13 | producer | `producer.reused_gates` non-empty | `derivative` | all run (§6) |
| 14 | producer | `producer.caller_chain` null or deeper than the pull-request path | `unattributable` | all run |
| 15 | producer | `producer.run_id` or `producer.run_url` null | `unattributable` | all run — evidence nobody can go and read is not auditable |
| 16 | process | the verifier exits non-zero, times out, or writes an unparsable plan | `verifier-failed` | all run — `gate_plan` already treats an invalid plan as `{}` (`quality.yml:336-341`) |
| 17 | shape | any plan key outside `EXPECTED_PLAN_KEYS`, any value not `run`/`skip` | `verifier-failed` | the whole plan is discarded → all run |
| **Row-level — that gate runs, no other decision changes** |
| 18 | coverage | the gate required at this moment has no row in `gates[]` | `uncovered` | that gate runs |
| 19 | status | `readEvidence` returns `fail` or `unknown` (including work-less and stale) | `not-proved` | that gate runs |
| 20 | level | row `level` is weaker than the level this moment requires (`optional` evidence for a now-`required` gate) | `level-downgrade` | that gate runs (`lisa-run-gates.mjs:1284-1289`) |
| 21 | freshness | Class B and `observed_at` older than the declared window | `stale` | that gate runs |
| 22 | freshness | Class B and `max_age_minutes` is null on the row | `stale` | that gate runs — an unbounded time-sensitive row is not fresh, it is unmeasured |
| 23 | class | the gate is Class C | `never-reusable` | that gate runs, unconditionally, even with a perfect row |
| 24 | class | the gate id has no classification anywhere | `unclassified` | that gate runs (the default is `never`) |
| 25 | diff gates | Class A diff sub-class and `subject.commit` does not match | `subject-mismatch` | that gate runs (§5.1) |
| 26 | prover | Class B and `prover.version` is null | `unattributable` | that gate runs |

**Row 26, and a doc-comment correction that ships with it.** `lisa-run-gates.mjs:1298-1302` states
unconditionally that *"the verifier treats a null-version row as uncoverable and reruns."* Taken
literally, nothing is ever reusable, because the pull-request producer cannot resolve a version for
every hand-written job. The rule is right for the case it was written about and too broad for the
rest: for a **Class B** gate the prover is an external scanner whose version determines what it can
find, so a null version is disqualifying. For a **Class A** gate the binding that matters is
`subject.tree` + `contract.gates_digest` + `contract.workflow_sha`, all non-null by construction, and
a null `prover.version` weakens nothing. The PR that ships the verifier **must** narrow that comment
in the same commit, so the two do not drift.

**There is no `skip_jobs` path, no blanket switch, and no verdict that produces a skip from absence.**
Every row in the table above resolves to *run*. The only value that resolves to *skip* is a row that
passed every one of checks 1-26.

### 7.2 What the verifier never does

- It never reads a check run, a commit status, or a run conclusion.
- It never infers a freshness window.
- It never treats an unknown gate id as reusable.
- It never emits a decision for a gate that is not in `EXPECTED_PLAN_KEYS`.
- It never fails the run. An optimization that can redden a release is not an optimization.

### 7.3 The audit ledger

`gate_plan` writes the full per-gate decision list to `$GITHUB_STEP_SUMMARY` and to an artifact
`lisa-reuse-ledger`, naming for each gate: the decision, the reason token from the table above, and —
for a reuse — the originating `run_url`, `run_id`, and `observed_at`.

A `reuse_audit` job (`needs:` every gated job, `if: always()`) then asserts the two sets agree:

> the set of jobs whose `result` is `skipped` **because of the plan** equals the set of gates the
> ledger marked `reuse`.

It **fails** when they do not. That is what keeps "skipped" and "reused" from becoming two different
things — the exact failure mode `quality.yml:3660`'s `🔒 Skipped Required Checks` job exists to catch,
applied to this mechanism.

---

## 8. Fixtures

One golden envelope, and one fixture per dimension that corrupts **exactly one field**. Every fixture
asserts two things, and the second is what makes them one-at-a-time fixtures rather than a pile of
negative tests:

1. the expected gate (or every gate) reruns, with the expected reason token;
2. **no other gate's decision changes** relative to the golden run.

| fixture | mutation | expected |
|---|---|---|
| `golden` | none | every Class A gate `reuse`; every Class B gate `reuse` within window; every Class C gate `run` |
| `tree-mismatch` | one hex char of `subject.tree` | all run, `subject-mismatch` |
| `tree-null` | `subject.tree: null` | all run, `subject-mismatch` |
| `repository-mismatch` | `subject.repository` | all run, `subject-mismatch` |
| `moment-pre-deploy` | `contract.moment: "pre-deploy:production"` | all run, `contract-mismatch` |
| `gates-digest-mismatch` | one hex char | all run, `contract-mismatch` |
| `gates-digest-null` | `null` | all run, `contract-mismatch` |
| `workflow-sha-mismatch` | one hex char | all run, `contract-mismatch` |
| `workflow-ref-mismatch` | a different ref | all run, `contract-mismatch` |
| `inputs-digest-mismatch` | one hex char | all run, `contract-mismatch` |
| `registry-version-older` | `4.8.0` vs local `4.9.0` | all run, `contract-mismatch` |
| `registry-version-newer` | `4.10.0` | **reuse** — a stricter producer is acceptable; the rule is same-or-stricter |
| `schema-token-wrong` | `lisa.gate-evidence/v2` | all run, `malformed` |
| `schema-token-absent` | key deleted | all run, `malformed` |
| `not-json` | truncated bytes | all run, `malformed` |
| `gates-not-array` | `gates: {}` | all run, `malformed` |
| `verdict-blocked` | `verdict: "blocked"` | all run, `not-proved` |
| `verdict-no-gates` | `verdict: "no-gates"` | all run, `not-proved` |
| `verdict-fell-back` | `verdict: "fell-back"` | all run, `not-proved` |
| `reused-gates-nonempty` | `producer.reused_gates: ["code-style"]` | all run, `derivative` |
| `caller-chain-nested` | two-element chain | all run, `unattributable` |
| `caller-chain-null` | `null` | all run, `unattributable` |
| `run-id-null` | `producer.run_id: null` | all run, `unattributable` |
| `oversize` | padded past the byte budget | all run, `unavailable` |
| `absent` | no file at all | all run, `unavailable` |
| `row-missing` | delete the `code-style` row | `code-style` runs (`uncovered`); everything else unchanged |
| `row-status-fail` | `code-style.status: "fail"` | `code-style` runs (`not-proved`); everything else unchanged |
| `row-status-unknown` | `"unknown"` | `code-style` runs; everything else unchanged |
| `row-level-downgrade` | `code-style.level: "optional"` | `code-style` runs (`level-downgrade`) |
| `row-work-null` | a work-declaring gate with `work: null` | that gate runs (`not-proved`, via `readEvidence`) |
| `row-stale` | Class B row `observed_at` = now − 61 min | that gate runs (`stale`); Class A unchanged — **this is the AC scenario "time-sensitive evidence expires"** |
| `row-fresh-boundary` | now − 59 min | that gate reuses |
| `row-max-age-null` | Class B row `max_age_minutes: null` | that gate runs (`stale`) |
| `row-prover-version-null` | Class B row | that gate runs (`unattributable`); Class A with the same mutation still reuses |
| `class-c-perfect-row` | a flawless `static-security` row | it runs anyway (`never-reusable`) |
| `unclassified-gate` | a row for a gate id in no table | it runs (`unclassified`) |
| `plan-key-unknown` | verifier emits a key outside `EXPECTED_PLAN_KEYS` | whole plan discarded, all run |
| `verifier-crash` | resolver exits 1 | all run, `verifier-failed` |

Each fixture also asserts a **negative**: no fixture ever produces a `skip` for a gate the golden run
ran, and no fixture ever produces a plan with a value other than `run` or `skip`.

---

## 9. Staged plan

Each stage is a separate PR and each names what it proves **alone**. Stage 4 is the first one that
saves a minute, and it is last on purpose.

### Stage 1 — the verifier and its fixtures. *(no wiring; zero minutes saved)*

- `GATE_REUSE_CLASS` in `all/copy-overwrite/scripts/lisa-gates.mjs`, beside `QUALITY_JOB_GATES`,
  plus the per-gate `reuse` declaration and its `validate` rules (a `time-sensitive` class with no
  `max_age_minutes` is refused).
- `reuse-plan` subcommand implementing §7.1 in full.
- The complete fixture suite from §8.
- The doc-comment narrowing at `lisa-run-gates.mjs:1298-1302` (§7.1, row 26).
- A derivation test: every registry gate id has a classification, or the test fails.

**What it proves alone:** every corruption dimension forces a rerun, one at a time, with no
cross-contamination; the default for an unclassified gate is `run`; a `time-sensitive` gate with no
window is a configuration error. This is the falsifiability arm of the acceptance criteria, and it
ships first because it is the part that must be right.

**What it explicitly does not do:** nothing calls it. It is a library, not an inert control — it makes
no claim in CI, so it cannot report success while doing nothing.

### Stage 2 — the producer.

- `quality-evidence` subcommand (reusing `lisa-run-gates.mjs`'s exported header helpers).
- `evidence_record` job in `.github/workflows/quality.yml`, plus `quality-rails.yml` parity.
- Artifact upload. Nothing consumes it.

**What it proves alone:** a real pull-request run emits a schema-valid `lisa.gate-evidence/v1`
envelope; its `subject.tree` equals the merge commit's tree for an up-to-date branch — the empirical
premise the whole design rests on, **measured on real runs rather than assumed**; the vacuous-green
mapping (§4.2) turns a `skip_jobs`-suppressed job into an `unknown` row rather than a `pass`; and
`reused_gates` is empty by derivation.

### Stage 3 — the consumer.

- `gate_plan` attempts the same-run download of `lisa-inbound-gate-evidence`, runs `reuse-plan`,
  merges `skip` decisions into its existing plan output, and writes the §7.3 ledger.
- The `reuse_audit` job.

Nothing uploads the inbound artifact yet, so on every run — Lisa's and every consumer's — the download
misses and the plan is unchanged.

**What it proves alone:** the wiring is live and the absent-evidence path is byte-identical to today's
behaviour, observed on real runs rather than argued. That is the single most important negative
property in the design and it gets its own stage.

### Stage 4 — the pipe. *(the stage that saves the minutes)*

- `quality_evidence` job in `.github/workflows/deploy.yml` (Lisa's own) with
  `permissions: actions: read, contents: read`.
- The same job in the five `*/create-only/.github/workflows/deploy.yml` templates.
- A `lisa doctor` advisory naming a `deploy.yml` that calls `release.yml` without the fetch job, so
  existing consumers can see what they are leaving on the table and adopt it deliberately.

**Reach, stated honestly:** `deploy.yml` is **create-only** in every stack, so this reaches new
repositories and Lisa itself. Existing consumers keep paying until they adopt a documented one-job
change. That is a real limitation of this design and it is the price of not being able to add a scope
to a reusable workflow (§3.1). Lisa itself is where the 69% was measured, so the measurement closes
on Lisa regardless.

### Stage 5 — measurement and the audit summary.

- The before/after billed-minute report, sampled over N release runs on Lisa via
  `GET /repos/{o}/{r}/actions/runs/{id}/timing`, reporting **observed** savings for the sample and
  **projected** monthly savings separately and labelled as such. The issue's own framing —
  *"estimates from a bounded sample, not billing-ledger totals"* — is the standard the report is held
  to.
- The release step-summary ledger surfaced in `release.yml`'s summary output.

---

## 10. Acceptance criteria → mechanism

| Scenario | Mechanism |
|---|---|
| exact evidence avoids a redundant prover | §7.1 rows 1-26 all pass ⇒ `gate_plan` emits `"<job>":"skip"`; the ledger records the originating `run_url` |
| a changed subject reruns quality | §7.1 rows 6-12 — tree, moment, gates digest, workflow ref/sha, inputs digest, registry version |
| time-sensitive evidence expires | §5.2 windows + §7.1 rows 21-22, via the existing `readEvidence` bound |
| verifier ambiguity fails safe | §7.1 rows 1-5, 16-17 — every one resolves to *all run*, and `gate_plan` already discards an invalid plan |
| deployment quality remains independent | §5.3 plus the structural `contract.moment` check — a pull-request envelope can never satisfy a `pre-deploy:*` gate |
| the optimization is falsifiable and measured | §8 fixtures (one dimension at a time, plus the no-other-decision-changed assertion) and Stage 5 |

---

## 11. Open questions for the owner

1. **`test-integration` classification.** Lisa's integration suite is hermetic, so it is Class A here.
   A consumer whose integration tests reach a live service must declare it `time-sensitive` or
   `never`. Should the built-in default for `test-integration` be Class A (correct for Lisa, wrong
   and expensive-to-discover for a consumer with a live dependency) or `never` (safe everywhere,
   forfeits one of the largest single savings until each project opts in)? The design currently says
   Class A; the conservative answer is `never`.
2. **Artifact retention.** A repository with a short artifact retention window will see `unavailable`
   more often. That is correct behaviour, not a bug, but it makes savings vary by setting, and the
   Stage 5 report should say so.
3. **Reach.** §9 Stage 4 — is a documented, doctor-advised one-job change to `deploy.yml` an
   acceptable adoption path for existing consumers, or should a migration be built?
