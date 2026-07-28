# Learnings — heredoc-classifier-fps (CodySwannGT/lisa#1958, PR #1994, merge a77ea85eb)

Learner pass, 2026-07-23. Capture-only: no rules files touched, no issues filed, no
commits made. **Zero entries persisted** — the ledger is fully saturated AND was being
concurrently rewritten during this pass (see Budget/Hazard below), so all three durable
candidates are recorded here as **budget-blocked drafts**, ready to persist through the
executable contract (`persistLearningEntry` / `persistConsolidatedLearning`) once gardener
relief (#1787–#1790) lands headroom.

## Budget measurement (evidence for #1959)

The `LEARNINGS_CONTRACT` cap is **4000 utf8 bytes** of the whole rendered document
(`estimateLearningTokens` = `Buffer.byteLength(content,"utf8")`).

The ledger **churned through three distinct states during this single pass** (concurrent
`dss-1`/`dss-2` learner passes, commits `62a59e422`/`4afb4492f`):

| Observation | Bytes | State |
|---|---|---|
| Pass start | 3989 / 4000 | 7 entries (bootstrap, 0d2a, 399a, **9df0**, fffa, model-computed, sll4) |
| Mid-pass | 6961 / 4000 | **git merge-conflict markers embedded** (`<<<<<<< Updated upstream` … `>>>>>>> Stashed changes`) — **unparseable by the contract** (`parseLearningsFile` throws `Invalid project learnings file format` / `exceeds maxTokens 4000`) |
| Pass end (frozen snapshot `/tmp/ledger-snapshot-1958.md`) | **3999 / 4000 (1 byte headroom)** | 8 entries, fully rewritten: 05f0, 1cf6, 877f, b6f5, **bcc1**, c7ba, model-computed, sll4 |

The consolidation target I planned against (`learner-9df011bc59dd`, the "prove-it-works"
class) **was superseded mid-pass** by the concurrent dss passes into `learner-bcc1acfca542`.

### Measured persist attempts (each drafted entry vs the 4000-byte cap, against the 3999-byte end-state)

| Attempt | Type | Rendered doc bytes | Verdict |
|---|---|---|---|
| C1 → supersede `learner-bcc1acfca542` | consolidate | **4204** | **OVER by 204** — writer would throw `exceeds maxTokens 4000 (measured 4204)` |
| C2 append | append | **4756** | **OVER by 756** |
| C3 append | append | **4719** | **OVER by 719** |

Even the leanest option — SLL-6 consolidation of the highest-value candidate into an
existing sibling — overflows by 204 bytes. Unlike the #1960 pass (which recovered space via
three merges of redundant siblings), this pass's candidates are **new failure classes with
no redundant siblings left to collapse**, so there is no consolidation slack. With 1 byte of
headroom, **no append of any real entry is possible.** This is the saturation defect #1959
targets, now also compounded by a concurrent-write / merge-conflict hazard on the single
ledger file.

## Disposition table

| # | Candidate | Disposition |
|---|-----------|-------------|
| 1 | Adversarial-review-until-clean for grammar-emulating security code; re-attack **each fix's own new logic** (469 green tests + clean quality review still would-have-shipped 5 RCEs; only 5 iterated adversarial rounds with live executable reproducers found them) | **budget-blocked draft** `learner-92e12e1031ea` — **consolidates into `learner-bcc1acfca542`** (same "green/fixtures prove nothing → hunt bypasses with live reproducers" class; adds the grammar-emulation + re-attack-each-fix nuance and #1958/#1994 provenance; keeps first_learned 2026-07-19; confidence **high** — corroborated across #1754/#1766/#1960/#1958). Measured 4204/4000 |
| 2 | Python Unicode str-ops (`isspace`/`splitlines`/`strip`/`split`) are supersets of bash's ASCII lexing; every use in a shell-parsing security control is a latent parser-vs-bash desync — use explicit ASCII sets | **budget-blocked draft** `learner-61ebea1d46c5` — new entry; `scope:upstream-candidate` (root cause in Lisa-managed `parity-safety-net-heredoc.py`); confidence **medium** (single flow, but two distinct predicates R2 `isspace` + `splitlines` each with proven live reproducers). Measured 4756/4000 |
| 3 | Knowing when to STOP an unbounded hardening effort: when emulating an external grammar for a security boundary becomes a per-round arms race, escalate the stop/scope decision to a human with the threat-model reframing and move the durable fix to a different layer (#1982 content-guard backstop) | **budget-blocked draft** `learner-9533fb99de37` — new entry; folds in candidate 4's threat-model reframing (accidental-guardrail vs adversarial-boundary); confidence **medium** (single occurrence, concrete evidence: 5 bounded rounds + #1982 layer-change). Measured 4719/4000 |
| 4 | Threat-model calibration: rating crafted-evasion bypasses of an accident-guardrail as CRITICAL may over-invest; severity depends on adversarial-vs-accidental intent | **dropped — folded into #3** (its actionable core is the guardrail-vs-boundary reframing, which is #3's escalation payload; not durable as a standalone and would sibling #3) |
| 5 | Manifest/debris hygiene: an untracked `.playwright-mcp` scratch dir got scanned into the evidence manifest and blocked the final gate; gitignore transient MCP output | **dropped — one-off, already remediated in-PR** (commit `3c507efdc` dropped the debris + gitignored it; not a recurring durable rule; hostile-default drop) |

## Budget-blocked drafts (ready to persist once headroom exists)

```json
{"id":"learner-92e12e1031ea","rule":"A control must prove it works, not just run green: red-leg a deliberate failure and, for grammar-emulating guards, hunt bypasses with live executable reproducers, re-attacking each fixs own new logic — green fixtures hid 5 RCEs here.","why":"Vacuous self-skipped gates (#1766/#1754) and HIGH guard bypasses behind 138 (#1960) then 469 (#1958) green fixtures were caught only by live-reproducer attack; #1958 took 5 rounds re-attacking each fix.","provenance":["CodySwannGT/lisa#1766","CodySwannGT/lisa#1754","https://github.com/CodySwannGT/lisa/issues/1958","https://github.com/CodySwannGT/lisa/pull/1994"],"first_learned":"2026-07-19","last_confirmed":"2026-07-23","confidence":"high"}
{"id":"learner-61ebea1d46c5","rule":"Shell-parsing Python in a security control must use explicit ASCII sets, never Unicode str predicates (isspace/splitlines): each is a superset of bashs ASCII lexing and a parser-vs-bash desync that smuggles live substitutions past the wall.","why":"#1958 shipped 469 green tests, yet security re-attack found str.isspace() (NBSP/FS/ideographic space) and splitlines() Unicode supersets each smuggling a live $(...) past the heredoc wall (R2).","provenance":["https://github.com/CodySwannGT/lisa/issues/1958","https://github.com/CodySwannGT/lisa/pull/1994","plugins/src/base/hooks/parity-safety-net-heredoc.py","scope:upstream-candidate"],"first_learned":"2026-07-23","last_confirmed":"2026-07-23","confidence":"medium"}
{"id":"learner-9533fb99de37","rule":"A control emulating an external grammar (bash lexer) whose hardening becomes a per-round bypass arms race should stop: escalate to a human with the guardrail-vs-adversarial-boundary reframing and move the durable defense to a lower layer.","why":"#1958 ran 5 adversarial rounds (R1-R5) chasing bash-emulation desyncs; the durable fix was a different layer (#1982 content-guard backstop making wall-misses non-critical), not a 6th round.","provenance":["https://github.com/CodySwannGT/lisa/issues/1958","https://github.com/CodySwannGT/lisa/pull/1994","https://github.com/CodySwannGT/lisa/issues/1982"],"first_learned":"2026-07-23","last_confirmed":"2026-07-23","confidence":"medium"}
```

- C1 must be persisted with `persistConsolidatedLearning(root, c1, { supersede: ["learner-bcc1acfca542"] })` (merge the still-true content of bcc1). **Re-verify bcc1 still exists at persist time** — it was itself created by a concurrent pass this session and could be superseded again.
- C2 and C3 via `persistLearningEntry(root, entry)`.

## Upstream candidates (marked, never filed — gardener routes these)

- **Candidate 2** carries `scope:upstream-candidate`: the shared quote/comment/lexing model in
  `parity-safety-net-heredoc.py` (a Lisa-managed hook surface) should replace Python
  Unicode-aware string predicates with explicit ASCII sets across all five walkers. Per the
  learner contract this was **not** filed as an issue.

## Hazard note (concurrent write on the ledger)

The single `.lisa/PROJECT_LEARNINGS.md` file was observed in a **git merge-conflict state**
(conflict markers embedded, 6961 bytes, contract-unparseable) mid-pass, then rewritten to a
clean 3999-byte 8-entry state by concurrent `dss-1`/`dss-2` learner passes. This matches the
`ui-concurrent-queue-merge-hazards` class: parallel sessions serializing writes through one
saturated ledger produce transient corruption and lost/superseded entries. Relevant to #1959
beyond raw saturation: the relief valve must also address **concurrent-writer contention**,
not just headroom.
