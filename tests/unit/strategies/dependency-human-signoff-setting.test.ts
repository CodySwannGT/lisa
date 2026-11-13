/**
 * Every surface that asks for dependency sign-off names the switch that
 * controls it, and the default has the agent ratify (CodySwannGT/lisa#4687).
 *
 * `dependencies.humanSignOff: "none"` — the default under the default
 * `humanGate.mode: "access-only"` — is only real if NO surface an agent reads
 * still directs it to stop for a person: a worker holding a ticket for approval
 * because one file kept the old sentence is exactly the failure the setting
 * exists to remove. Equally, the class-4 ratification requirement stays word
 * for word for projects that choose `"default"` or `humanGate.mode: "strict"`,
 * because those projects asked for a person to sign off.
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

describe("the human-ratification requirements stay for projects that opt in (AC1)", () => {
  const rule = flat(RULE);

  it('says only an explicit "default" or strict mode keeps every requirement exactly as written', () => {
    expect(rule).toContain(
      'A person ratifies, exactly as written below, only when the project sets `dependencies.humanSignOff` to `"default"` or `humanGate.mode` to `"strict"`'
    );
  });
});

describe('"none" drops every ratification requirement (AC2)', () => {
  const rule = flat(RULE);

  it("states the override in the head of the rule, where it is read first", () => {
    const head = rule.slice(0, rule.indexOf("## The five review inputs"));
    expect(head).toContain(
      `${KEY} resolves to \`"none"\` unless the project sets it, so no requirement below waits on a person`
    );
  });

  it("names each ratification line it drops, and keeps classification and evidence", () => {
    expect(rule).toContain('### When `dependencies.humanSignOff` is `"none"`');
  });

  it('reports an invalid value and fails safe to "default"', () => {
    expect(flat(CONFIG_RULE)).toContain(
      'is reported as invalid (in `lisa apply` output and the session\'s `lisa-resolved-config` block) and treated as `"default"`, the stricter option.'
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
});

describe("the key is documented in the config reference", () => {
  it("has a top-level-fields row with its default and closed vocabulary", () => {
    expect(flat(CONFIG_RULE)).toContain(
      `| ${KEY} | no | \`"none"\` (\`"default"\` when \`humanGate.mode\` is \`"strict"\`) |`
    );
  });
});
