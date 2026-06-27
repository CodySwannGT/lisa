# Design: Making Verification Concrete (agent-played UAT)

> Status: **Design / PRD — for review.** Implementation in progress (PR A).
> Date: 2026-06-27 · Scope: Lisa base verification lifecycle + per-type drive
> mechanisms (phaser first).

## 0. Terminology (read first)

**Verification IS UAT.** There is exactly one concept and one gate. "Use the
software the way a user would, against the acceptance criteria" *is* User
Acceptance Testing. This design does **not** add a parallel "UAT" gate, skill, or
vocabulary — it makes the **existing** `verification` rule/flow more concrete.
Where this doc says "UAT" it means verification.

## 1. Problem & goal

Lisa already has a strong verification spine: the `verification` eager rule
("verification is using the software like a user; codify it; reviewer replay
steps"), the non-bypassable `enforce-verification-gate.sh` Stop hook (blocks
"done" until `.lisa/verification-status.json` shows every acceptance criterion
`pass`), the `[EVIDENCE: name]` Per-Work-Unit Evidence Contract, and the
`codify-verification` skill. What's missing is **concreteness + teeth**:

- the codified verification isn't distinctly **required in CI** per type;
- evidence isn't **committed to the repo**;
- there's no **per-change** enforcement that a behavioral change shipped a
  verification spec.

**Goal:** nothing is "done" until an agent has actually exercised the running
software against the acceptance criteria, the proof is **committed**, and it is
**codified as a check CI re-runs** — with a **per-change** requirement.

### Locked decisions (from review)
- **Tier 1 + Tier 2:** a required CI verification check (must exist & pass) PLUS
  the existing no-bypass lifecycle gate (agent playthrough + evidence).
- **Per-change:** every `feat`/`fix` adds/extends a verification spec.
- **Generalized** via a base contract + per-type drive mechanisms; **phaser
  first**.
- **Evidence committed** to `evidence/<ticket>/`.
- **One concept:** verification == UAT (no separate skill/gate).
- **`/lisa:product-walkthrough`** is the shared playthrough driver.
- **`verification-exempt`** label (logged, never silent) for non-behavioral changes.

## 2. Build on what exists — the delta only

| Already in Lisa | This work adds |
| --- | --- |
| `verification` rule + reference | Concreteness: committed evidence, CI re-run, per-change requirement (all framed as verification) |
| `enforce-verification-gate.sh` (Stop hook, verdict-gated) | Reused **as-is**; committed evidence + codified spec become preconditions of a `pass` verdict |
| `[EVIDENCE: name]` manifest (tracker) | The named artifacts are **also committed** under `evidence/<ticket>/` |
| `codify-verification` (Playwright/e2e) | Codified spec lands in `tests/e2e/**` and is the CI gate; writes committed evidence |
| existing CI e2e/Playwright job | Made **required** for enforced types; + a new `verification-coverage` check |

No new parallel rule. No `acceptance-uat` skill.

## 3. Concrete mechanics

1. **Codified proof re-runs in CI.** `codify-verification` puts the spec in
   `tests/e2e/**`; the existing e2e/Playwright CI job runs it; for a type with
   verification **enforced** it is a required check.
2. **Committed evidence** at `evidence/<ticket>/`:
   ```
   evidence/<ticket>/
     verdict.json   # criteria + per-criterion pass/fail + note, verdict, ticket,
                    # commit, lisaVersion, agent, stampedAt (stamped, not generated mid-run)
     state.json     # observed runtime state asserted against
     screenshots/*.png   # downscaled, capped
   ```
   `evidence/**` ignored by lint/format/knip/coverage (proof, not source).
3. **Per-change enforcement.** CI `verification-coverage` job runs
   `scripts/check-verification-coverage.mjs`: a `feat`/`fix` with no
   `tests/e2e/**` (or `tests/verification/**`) delta fails, unless it carries the
   **logged** `verification-exempt` label.
4. **Flag-gated rollout.** A `verify_enforced` workflow input (default `false`)
   gates the CI teeth so types without a drive mechanism are never wedged.

## 4. Per-type drive mechanism (not a new concept — just "how you exercise it")

`/lisa:product-walkthrough` is the shared driver; each type supplies how it drives
the running build:
- **phaser** — Playwright + an in-game **verification test bridge** (env-guarded,
  stripped from prod): seed RNG, read typed state, inject semantic input, step
  frames; deterministic rendering (software GL, fixed `pixelArt`/`antialias`,
  frozen frame) for stable screenshots.
- **nestjs/cdk** — drive HTTP/integration against a running service.
- **rails** — system/request specs. **expo** — Maestro / Playwright-web.

## 5. The loop

```
/lisa:implement (or /lisa:verify)
  ├─ /lisa:product-walkthrough drives the running build through the acceptance flow
  ├─ judge each acceptance criterion vs the spec
  ├─ write committed evidence/<ticket>/ (verdict + state + screenshots)
  └─ codify-verification → tests/e2e/<ticket>.spec.ts (re-runs in CI)
Gate: enforce-verification-gate.sh blocks "done" until the verdict passes
CI: e2e/Playwright job (required when enforced) + verification-coverage (delta present)
```

## 6. Honest limits
- **CI can't prove a spec covers *this* criterion** — only that *a* verification
  spec changed. The semantic guarantee is Tier 2 (the agent's playthrough + the
  committed verdict). By design.
- **Local hooks are bypassable;** the required CI checks are the real teeth.
- **Canvas verification flakes** without determinism — the bridge's seed/step +
  software GL are mandatory.
- **Committed screenshots add git weight** — mandate downscaled + capped PNGs;
  `verdict.json`/`state.json` are the diffable record. Fallback if it bloats:
  commit verdict+state, screenshots as CI artifacts.

## 7. Rollout
- **PR A (base):** extend `verification.md` (+reference) with the three concrete
  mandates; extend `codify-verification`; `scripts/check-verification-coverage.mjs`
  + a `verification-coverage` CI job behind `verify_enforced` (default off);
  `evidence/**` ignores; tests; rebuild plugin artifacts. Existing types
  unaffected (enforced off).
- **PR B (phaser):** the in-game verification test bridge + structure/lint rule,
  deterministic Playwright e2e config, `verify_enforced: true` in phaser's
  `ci.yml`, phaser-specific guidance in the `phaser-testing` skill, template wiring.
- **PR C+:** nestjs / rails / expo / cdk drive mechanisms, each flipping
  `verify_enforced` on when ready.

## 8. Implementation checklist (PR A)
Extend `verification.md` eager (+reference "Making verification concrete (UAT)");
extend `codify-verification`; `scripts/check-verification-coverage.mjs` (pure
`evaluateVerificationCoverage` + CLI, `verification-exempt`); `quality.yml`
`verification-coverage` job + `verify_enforced` input (default false);
`evidence/**` ignored by eslint/prettier/knip/coverage; tests (coverage fn,
workflow + rule wiring); rebuild plugin artifacts; gates; PR.
