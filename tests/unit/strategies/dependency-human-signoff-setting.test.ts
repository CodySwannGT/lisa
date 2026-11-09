/**
 * Every surface that asks for dependency sign-off names the switch that turns
 * it off, and the default still asks.
 *
 * `dependencies.humanSignOff: "none"` is only real if NO surface an agent reads
 * still directs it to stop for a person: a worker holding a ticket for approval
 * because one file kept the old sentence is exactly the failure the setting
 * exists to remove. Equally, the default must keep the class-4 ratification
 * requirement word for word, because projects that set nothing must see no
 * change.
 * @module tests/unit/strategies/dependency-human-signoff-setting
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const RULE = "plugins/src/base/rules/reference/dependency-trust-classes.md";
const CONFIG_RULE = "plugins/src/base/rules/reference/config-resolution.md";
const SKILL = "plugins/src/base/skills/lisa-task-decomposition/SKILL.md";
const SCAFFOLD = "all/create-only/.lisa/DEPENDENCY_DECISIONS.md";
const GUIDE = "wiki/playbooks/dependency-ownership-operator-guide.md";
const RECORDS_RULE =
  "plugins/src/base/rules/reference/dependency-decision-records.md";

/** Heading of the section each escalation surface lists its triggers under. */
const ESCALATE_HEADING = "## When to escalate";

/** The escalation exception every "raise it to an owner" surface carries. */
const SELF_RESOLVE =
  'When `dependencies.humanSignOff` is `"none"`, the agent resolves the escalation itself — reclassify, replace, remove, or accept — and records the decision and its reason in the entry.';

/** The key every surface must name, as an agent would search for it. */
const KEY = "`dependencies.humanSignOff`";

/**
 * Read a file with line wrapping collapsed, so a phrase reflowed across lines
 * still matches.
 * @param file - Repo-relative path
 * @returns Flattened text
 */
const flat = (file: string): string =>
  readFileSync(file, "utf8").replace(/\s+/gu, " ");

describe("default behavior is unchanged (AC1)", () => {
  const rule = flat(RULE);

  it("still requires class-4 ratification to add and to major-upgrade", () => {
    expect(rule).toContain(
      "**Ratification:** **product/human ratification is required** before adding the dependency and before any major upgrade."
    );
    expect(rule).toContain(
      "**Runtime-critical service client** — to add, and for every major upgrade."
    );
  });

  it("says the default keeps every requirement exactly as written", () => {
    expect(rule).toContain(
      'The default (`"default"`, or the key omitted) keeps every requirement below exactly as written.'
    );
  });
});

describe('"none" drops every ratification requirement (AC2)', () => {
  const rule = flat(RULE);

  it("states the override in the head of the rule, where it is read first", () => {
    const head = rule.slice(0, rule.indexOf("## The five review inputs"));
    expect(head).toContain(
      `When \`.lisa.config.json\` sets ${KEY} to \`"none"\`, no ratification requirement or human-review trigger in this rule applies`
    );
  });

  it("names each ratification line it drops, and keeps classification and evidence", () => {
    expect(rule).toContain('### When `dependencies.humanSignOff` is `"none"`');
    expect(rule).toContain("**No ratification line in this rule applies**");
    expect(rule).toContain(
      "Do not stop work, hold a work item, or ask a person to approve any of them."
    );
    expect(rule).toContain("**Human-review triggers become agent decisions.**");
    expect(rule).toContain("**Everything else still applies.**");
    expect(rule).toContain(
      "Turning sign-off off removes the human, not the evidence."
    );
  });

  it("leaves credential, paid-account, and license approvals out of it", () => {
    expect(rule).toContain(
      "**Credential, paid-account, and license approvals are not covered.**"
    );
  });

  it("reports an invalid value and falls back to default", () => {
    expect(rule).toContain(
      'Any other value is reported as invalid and treated as `"default"`.'
    );
  });

  it.each([
    [SKILL, "lisa-task-decomposition skill"],
    [SCAFFOLD, "seeded decision record"],
    [GUIDE, "operator guide"],
    [RECORDS_RULE, "dependency-decision-records rule"],
  ])("is acknowledged wherever sign-off is asked for: %s (%s)", file => {
    expect(flat(file)).toContain(KEY);
  });

  it("lets the agent resolve escalations itself in the records rule", () => {
    const rule = flat(RECORDS_RULE);
    const head = rule.slice(0, rule.indexOf(ESCALATE_HEADING));
    const escalate = rule.slice(rule.indexOf(ESCALATE_HEADING));

    expect(head).toContain(SELF_RESOLVE);
    expect(escalate).toContain(SELF_RESOLVE);
  });

  it("lets the agent resolve escalations itself in the seeded record", () => {
    const scaffold = flat(SCAFFOLD);

    expect(scaffold.slice(scaffold.indexOf(ESCALATE_HEADING))).toContain(
      SELF_RESOLVE
    );
  });

  it("qualifies the decomposition skill's always-ratify sentence", () => {
    expect(flat(SKILL)).toContain(
      `unless \`.lisa.config.json\` sets ${KEY} to \`"none"\`, in which case no class requires ratification`
    );
  });

  it("tells the seeded record's reader the class and evidence still stand", () => {
    expect(flat(SCAFFOLD)).toContain(
      'sets `"dependencies": { "humanSignOff": "none" }` in `.lisa.config.json`; every sign-off above is then dropped, while the trust class and its evidence are still required.'
    );
  });
});

describe("the key is documented in the config reference", () => {
  it("has a top-level-fields row with its default and closed vocabulary", () => {
    expect(flat(CONFIG_RULE)).toContain(`| ${KEY} | no | \`"default"\` |`);
  });
});
