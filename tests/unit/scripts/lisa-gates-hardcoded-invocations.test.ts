/**
 * What the façade says when nothing declared the property it just proved, and
 * what a seeded declaration is allowed to claim.
 *
 * The order these two have to happen in is the whole design: a built-in may not
 * be deleted, and an absent declaration may not be made fatal, until a
 * declaration is guaranteed to exist — because a required context that runs
 * zero steps reports GREEN. So reporting comes first and is behaviour-neutral,
 * and seeding is deliberately conservative: it declares only what it can prove
 * reproduces the built-in it replaces.
 *
 * Imported STATICALLY, and that is load-bearing rather than stylistic. The
 * mutation gate's resolver indexes literal specifiers only — Vite cannot see a
 * computed `import()` either — so a suite that loaded the registry dynamically
 * would never join the run, and every mutant in the table below would be
 * reported uncovered while this file passed. That is the silent-green shape
 * this whole subsystem exists to remove.
 *
 * @module tests/unit/scripts/lisa-gates-hardcoded-invocations
 */
import { describe, expect, it } from "vitest";

import {
  HARDCODED_INVOCATIONS,
  isDeclarableAt,
  REGISTRY,
  seedGates,
  unconfiguredAt,
  validateGates,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

const PUSH = "push";
const PULL_REQUEST = "pull-request";
const PRE_PUSH_SURFACE = "pre-push-hook";
const TYPE_CORRECTNESS = "type-correctness";
const MUTATION = "test-meaningfulness";
const E2E_BROWSER = "e2e-browser";

/**
 * The scripts the TypeScript template force-pins into a host project.
 *
 * A seeded declaration may only name a task the project actually has, so these
 * assertions run against a realistic manifest rather than an invented one —
 * otherwise they would prove restraint the fleet never gets.
 */
const TEMPLATE_SCRIPTS: Record<string, string> = {
  lint: "oxlint && eslint . --quiet",
  "lint:slow": "eslint . --config eslint.slow.config.ts --quiet",
  typecheck: "tsc --noEmit",
  build: "tsc",
  "format:check": "prettier --check .",
  "test:cov": "vitest run --coverage",
  "test:cov:unit": "vitest run --coverage --exclude='**/integration/**'",
  "test:integration": "vitest run tests/integration",
  "knip:check": "knip",
  "check:work-item": "node scripts/lisa-work-item.mjs validate-pr",
  "check:work-item:push": "node scripts/lisa-work-item.mjs validate-push",
};

/**
 * Findings for the pre-push surface under one gates block.
 * @param declared - The gates block
 * @returns The findings
 */
const atPush = (declared: object): ReturnType<typeof unconfiguredAt> =>
  unconfiguredAt({
    gates: declared,
    moment: PUSH,
    surface: PRE_PUSH_SURFACE,
  });

/** The edit-time moment the on-edit scripts actually fire at. */
const POST_TOOL = "post-tool";

describe("the hardcoded-invocation table", () => {
  it("records both classes, and every entry carries the gate it should be governed by", () => {
    const classes = new Set(HARDCODED_INVOCATIONS.map(entry => entry.facade));
    expect([...classes].sort((a, b) => a.localeCompare(b))).toEqual([
      "consults-then-falls-back",
      "never-consults",
    ]);
    for (const entry of HARDCODED_INVOCATIONS) {
      expect(Object.hasOwn(REGISTRY, entry.gate)).toBe(true);
      expect(entry.command.length).toBeGreaterThan(0);
      expect(entry.artifact.length).toBeGreaterThan(0);
    }
  });

  it("says which moments a gate may legally be declared at", () => {
    expect(isDeclarableAt(TYPE_CORRECTNESS, PUSH)).toBe(true);
    expect(isDeclarableAt(MUTATION, PUSH)).toBe(false);
    expect(isDeclarableAt("code-style", "pre-tool")).toBe(false);
    expect(isDeclarableAt("no-such-gate", PUSH)).toBe(false);
  });
});

describe("reporting what ran unconfigured", () => {
  it("reports a property with no declaration, naming the gate and why", () => {
    const finding = atPush({}).find(hit => hit.gate === TYPE_CORRECTNESS);
    expect(finding).toBeDefined();
    expect(finding?.reason).toContain("not declared");
    expect(finding?.command).toContain("typecheck");
    expect(finding?.declaration).toContain(TYPE_CORRECTNESS);
  });

  it("says so when the gate cannot legally be declared at the moment that runs it", () => {
    const mutation = unconfiguredAt({ gates: {}, moment: PUSH }).find(
      finding => finding.gate === MUTATION
    );
    expect(mutation?.declarable).toBe(false);
    expect(mutation?.declaration).toBeNull();
    expect(mutation?.reason).toContain("cannot legally be declared");
  });

  it("says so for a surface that consults no declaration at all", () => {
    // RETARGETED, not loosened. This asked about the on-edit surface, which
    // read no declaration at all until the edit-time façade landed; asserting
    // it there now would be asserting something false. The property is still
    // real and still needs a control, so it moves to the surface that still
    // has it: the sourced verification extension, which contains no gate
    // lookup of any kind.
    const finding = unconfiguredAt({
      gates: {},
      moment: PUSH,
    }).find(hit => hit.artifact.endsWith("pre-push.verify"));

    expect(finding).toBeDefined();
    expect(finding?.reason).toContain("no gate lookup at all");
  });

  it("stays silent about a gate the project declared", () => {
    expect(
      atPush({ [TYPE_CORRECTNESS]: { push: "required" } }).map(
        finding => finding.gate
      )
    ).not.toContain(TYPE_CORRECTNESS);
  });

  it("stays silent about a gate the project declared off", () => {
    // `off` is a decision, not an omission. Reporting it would train an
    // operator to ignore the report, which is the only thing that makes a
    // report-only control worthless.
    expect(
      atPush({ "dead-code": { push: "off" } }).map(finding => finding.gate)
    ).not.toContain("dead-code");
  });

  it("still reports a gate proved by await, because the built-in ran anyway", () => {
    const finding = atPush({
      "dependency-vulnerability": {
        push: { level: "required", await: "some-scanner" },
      },
    }).find(hit => hit.gate === "dependency-vulnerability");
    expect(finding?.reason).toContain("await");
  });

  it("is not silenced by a declaration the validator refuses", () => {
    // RE-CHOSEN AGAINST THE POST-#2920 REGISTRY, deliberately, and not simply
    // retargeted. The case this replaced declared `code-style` at `pre-tool`
    // and proved that buys no silence — but `code-style` is LEGAL at the
    // moment those scripts are now recorded at, so retargeting would have left
    // a control whose premise no longer holds, testing nothing while staying
    // green. That is the exact defect this epic exists to remove.
    //
    // The property is unchanged: a declaration `validate` REFUSES must not buy
    // silence from a report, because a config error is not a configuration.
    // `test-meaningfulness` runs at push and may not be declared there, so it
    // is still refused, and there is still a finding it could wrongly silence.
    const illegal = { [MUTATION]: { [PUSH]: "required" } };
    const silent = unconfiguredAt({ gates: {}, moment: PUSH });
    const withIllegal = unconfiguredAt({ gates: illegal, moment: PUSH });
    // The POSITIVE CONTROL, without which the equality above could hold
    // because suppression never happens at all. A legal declaration DOES
    // shorten the list, so an unchanged list under the illegal one is the
    // guard working rather than the mechanism being inert.
    const withLegal = unconfiguredAt({
      gates: { [TYPE_CORRECTNESS]: { [PUSH]: "required" } },
      moment: PUSH,
    });

    expect(validateGates(illegal).length).toBeGreaterThan(0);
    expect(silent.length).toBeGreaterThan(0);
    // Full lists, not lengths. A guard that dropped one finding and gained
    // another would pass a count comparison.
    expect(withIllegal.map(finding => finding.gate)).toEqual(
      silent.map(finding => finding.gate)
    );
    expect(withLegal.length).toBeLessThan(silent.length);
  });

  it("is not silenced by a declaration at a moment the gate forbids", () => {
    // The same defect on a `consults-then-falls-back` surface: mutation testing
    // runs at push and `test-meaningfulness` may not be declared there, so a
    // forced declaration would have hidden a written-in command that still ran.
    const illegal = { [MUTATION]: { push: "required" } };
    expect(validateGates(illegal).length).toBeGreaterThan(0);
    const findings = unconfiguredAt({
      gates: illegal,
      moment: PUSH,
      surface: PRE_PUSH_SURFACE,
    });
    expect(findings.map(finding => finding.gate)).toContain(MUTATION);
  });

  it("is never silenced on a surface that reads no declaration, even by a legal one", () => {
    // A `never-consults` script has no config branch, so NO declaration takes
    // it over — not even one the validator accepts. Suppressing there would
    // report a takeover that cannot happen.
    //
    // The subject moved when the on-edit scripts started consulting: they were
    // the example, and an example that stopped being true would have left this
    // control green and empty. `pre-push.verify` is the remaining one — it is
    // sourced by the pre-push hook and mentions no gate lookup at all — and
    // `coverage-adequacy` at push is a declaration the validator accepts, so
    // the moment-legality half of the guard passes and this clause is the only
    // thing left holding the finding.
    const declared = { "coverage-adequacy": { push: "required" } };
    const findings = unconfiguredAt({
      gates: declared,
      moment: PUSH,
      gate: "coverage-adequacy",
    });

    expect(validateGates(declared)).toEqual([]);
    expect(isDeclarableAt("coverage-adequacy", PUSH)).toBe(true);
    expect(
      findings.map(finding => finding.artifact),
      "the never-consults entry must survive a declaration that is legal here"
    ).toContain("phaser/copy-overwrite/.husky/pre-push.verify");
  });

  it("still lets a legal declaration silence its own finding", () => {
    // The guard must not become "nothing ever suppresses", which would make the
    // report unreadable and train an operator to ignore it.
    const findings = unconfiguredAt({
      gates: { [TYPE_CORRECTNESS]: { push: "required" } },
      moment: PUSH,
      surface: PRE_PUSH_SURFACE,
    });
    expect(findings.map(finding => finding.gate)).not.toContain(
      TYPE_CORRECTNESS
    );
  });

  it("reports a named gate at a cadence its entry does not record", () => {
    // The browser workflow defaults to `continuous:development` while the entry
    // records `pull-request`, and filtering the inventory by moment there found
    // no entry, produced no finding, and printed nothing — a report step that
    // reported nothing, which is this control's own failure mode.
    const findings = unconfiguredAt({
      gates: {},
      moment: "continuous:development",
      gate: E2E_BROWSER,
      surface: "playwright-workflow",
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.gate).toBe(E2E_BROWSER);
    expect(findings[0]?.declarable).toBe(true);
  });
});

describe("seeding a gates block", () => {
  it("declares the properties whose built-in it can reproduce", () => {
    const result = seedGates({ scripts: TEMPLATE_SCRIPTS, runner: "bun run" });
    const declared = result.seeded.map(
      entry => `${entry.gate}@${entry.moment}`
    );
    expect(declared).toContain(`${TYPE_CORRECTNESS}@${PUSH}`);
    expect(declared).toContain(`traceability@${PUSH}`);
    expect(declared).toContain(`code-style@${PULL_REQUEST}`);
    expect(result.gates["runner"]).toBe("bun run");
  });

  it("names the task that reproduces the built-in, not the registry default", () => {
    // The trap this exists to avoid: the pre-push unit step proves the suite
    // AND the coverage thresholds in one run, so seeding `test-correctness`'s
    // registry default (`test:unit`) would silently stop enforcing coverage at
    // push while the configuration read deliberate.
    const result = seedGates({ scripts: TEMPLATE_SCRIPTS });
    expect(result.gates["test-correctness"]?.[PUSH]).toEqual({
      level: "required",
      run: "test:cov:unit",
    });
    expect(result.gates["test-correctness"]?.[PULL_REQUEST]).toEqual({
      level: "required",
      run: "test:cov",
    });
  });

  it("leaves the registry default implicit when it already matches", () => {
    const result = seedGates({ scripts: TEMPLATE_SCRIPTS });
    expect(result.gates[TYPE_CORRECTNESS]?.[PUSH]).toBe("required");
  });

  it("declares nothing whose prover the project does not have", () => {
    expect(seedGates({ scripts: {} }).seeded).toEqual([]);
  });

  it("declares nothing at a moment the registry forbids", () => {
    const result = seedGates({
      scripts: {
        ...TEMPLATE_SCRIPTS,
        "test:mutation": "node scripts/lisa-mutation.mjs",
      },
    });
    const at = (entry: { gate: string; moment: string }): boolean =>
      entry.gate === MUTATION && entry.moment === PUSH;
    expect(result.seeded.filter(at)).toEqual([]);
    expect(result.skipped.find(at)?.reason).toContain("not a legal moment");
  });

  it("declares nothing whose built-in no single task reproduces", () => {
    // `sg_scan` runs a discovery step, the scan AND the rule tests, all of
    // which hang off the fallback path. One task would narrow what is proved
    // while reading like a takeover — and the Playwright aggregate is worse,
    // because one of the steps it would replace is the verdict that stops a
    // green merge over failing shards.
    const result = seedGates({
      scripts: {
        ...TEMPLATE_SCRIPTS,
        "sg:scan": "ast-grep scan",
        "test:e2e": "playwright test",
      },
    });
    const declared = result.seeded.map(
      entry => `${entry.gate}@${entry.moment}`
    );
    expect(declared).not.toContain(`structural-rules@${PULL_REQUEST}`);
    expect(declared).not.toContain(`${E2E_BROWSER}@${PULL_REQUEST}`);
  });

  it("declares nothing for a surface that would not consult it", () => {
    const result = seedGates({ scripts: TEMPLATE_SCRIPTS });
    expect(result.seeded.filter(entry => entry.moment === POST_TOOL)).toEqual(
      []
    );
    // The reason changed with the façade: these scripts DO consult now, and
    // what stops them being seeded is that no package task reproduces a
    // per-file tool invocation. Asserting the old reason would pin a sentence
    // that is no longer true.
    expect(
      result.skipped.find(entry => entry.moment === POST_TOOL)?.reason
    ).toContain("no task reproduces the built-in");
  });

  it("never overwrites a declaration the project already made", () => {
    const result = seedGates({
      gates: { [TYPE_CORRECTNESS]: { push: "optional" } },
      scripts: TEMPLATE_SCRIPTS,
    });
    expect(result.gates[TYPE_CORRECTNESS]?.[PUSH]).toBe("optional");
    expect(
      result.skipped.find(
        entry => entry.gate === TYPE_CORRECTNESS && entry.moment === PUSH
      )?.reason
    ).toContain("already declared");
  });

  it("is idempotent: seeding a seeded project changes nothing", () => {
    const first = seedGates({ scripts: TEMPLATE_SCRIPTS, runner: "bun run" });
    const second = seedGates({
      gates: first.gates,
      scripts: TEMPLATE_SCRIPTS,
      runner: "bun run",
    });
    expect(second.seeded).toEqual([]);
    expect(second.gates).toEqual(first.gates);
  });

  it("closes the gap it declares closed, and leaves the rest reported", () => {
    const before = atPush({});
    const seeded = seedGates({ scripts: TEMPLATE_SCRIPTS });
    const after = atPush(seeded.gates);
    expect(after.length).toBeLessThan(before.length);
    for (const finding of after) {
      // Gate AND moment. Matching the gate alone let a skip recorded at some
      // other moment vouch for a push finding that had no stated reason at
      // all — the assertion passed for the wrong entry.
      expect(
        seeded.skipped.some(
          entry => entry.gate === finding.gate && entry.moment === PUSH
        ),
        `${finding.gate} is still unconfigured at ${PUSH} with no stated reason`
      ).toBe(true);
    }
  });
});
