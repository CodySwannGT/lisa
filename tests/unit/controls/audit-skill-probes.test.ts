/**
 * What the `lisa-audit` skill has to tell the agent about probes, checked
 * against the code that judges them.
 *
 * The probing itself is carried out by an agent, and no suite may contact an
 * outside system, so none of it is run here. The skill's wording is not
 * pinned either. What is checked is that the agent is given every name the
 * code holds it to (the fields of a probe, the three results, the fixed ids),
 * that the rules a probe must never break are stated where the agent reads
 * them, that every access skill it is sent to exists, and that the example
 * record it is shown is one the check accepts (CodySwannGT/lisa#4981).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  AUDIT_PROBE_RESULTS,
  FIXED_PROBE_IDS,
  SERVER_SIDE_AUTHORITY,
  type AuditReport,
  validateAuditReport,
} from "../../../src/controls/audit-report.js";
import { UNREACHED_HEADING } from "../../../src/controls/audit-probes-markdown.js";
import { MERGE_PROTECTION_COMMAND } from "../../../src/controls/commands/merge-protection.js";
import type { MergeProtectionRead } from "../../../src/controls/merge-protection-read.js";
import {
  AUDIT_SKILL_SOURCE,
  auditSkillExampleReports,
  auditSkillShellBlocks,
} from "../../helpers/audit-skill.js";
import {
  completeAuditReport,
  type SampleFinding,
  type SampleReport,
} from "../../helpers/control-audit-report.js";
import { context } from "./audit-report-facts.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SKILLS = path.join("plugins", "src", "base", "skills");
const AUDIT = readFileSync(path.join(REPO_ROOT, AUDIT_SKILL_SOURCE), "utf8");
const PROBE_BLOCK = `lisa controls ${MERGE_PROTECTION_COMMAND}`;
const MIXED = [".", "api", "web"];
const PROBE_STEP = "### Step 4a:";
const RECORD_STEP = "### Step 5:";

/** The keys of the document the merge-protection command prints. */
const PRINTED: readonly (keyof MergeProtectionRead)[] = [
  "probe",
  "merge_protection",
  "branch",
  "platform",
  "requests",
];

/**
 * A part of the skill, from one heading up to the next.
 * @param from - The heading it starts at
 * @param to - The heading it ends before
 * @returns The text between them
 */
function between(from: string, to: string): string {
  return AUDIT.slice(AUDIT.indexOf(from), AUDIT.indexOf(to));
}

/**
 * The names of a list the skill never puts in code style.
 * @param names - Names the agent has to write exactly
 * @param text - The part of the skill to look in
 * @returns Those the skill does not show
 */
function unnamed(names: readonly string[], text: string = AUDIT): string[] {
  return names.filter(name => !text.includes(`\`${name}\``));
}

/** The example record the skill shows, as the agent would write it. */
const [EXAMPLE] = auditSkillExampleReports().filter(
  (report): report is SampleReport =>
    typeof report === "object" &&
    report !== null &&
    Array.isArray((report as SampleReport).probes)
);

/**
 * The example record made complete: its own findings, and a plain one for
 * every requirement it does not show.
 * @returns The record
 */
function completedExample(): SampleReport {
  const shown = (EXAMPLE?.findings ?? []) as readonly SampleFinding[];
  const complete = completeAuditReport(MIXED);
  return {
    ...EXAMPLE,
    schema_version: 1,
    scopes: MIXED,
    findings: complete.findings.map(
      plain =>
        shown.find(
          finding =>
            finding.criterion === plain.criterion &&
            finding.scope === plain.scope
        ) ?? plain
    ),
  };
}

describe("the lisa-audit skill on probes", () => {
  const groundRules = between(
    "## Ground rules",
    "## How to run the Lisa commands"
  );
  const probeStep = between(PROBE_STEP, RECORD_STEP);

  it("may load the access skills", () => {
    const [, tools = ""] = /^allowed-tools: (.+)$/mu.exec(AUDIT) ?? [];

    expect(JSON.parse(tools)).toEqual(
      expect.arrayContaining(["Bash", "Read", "Write", "Skill"])
    );
  });

  it("no longer says the audit asks no outside system, and says what a probe may never do", () => {
    expect(groundRules).not.toMatch(/reads\s+the\s+repository\s+only/u);
    expect(groundRules).not.toMatch(/does\s+not\s+ask\s+the\s+hosting/u);
    expect(groundRules).toMatch(/read-only\s+requests\s+only/u);
    expect(groundRules).toMatch(/never\s+a\s+write/u);
    expect(groundRules).toMatch(/never\s+prints\s+a\s+credential/u);
    expect(probeStep).toMatch(/Read-only\s+requests\s+only/u);
    expect(probeStep).toMatch(/Never\s+print\s+a\s+credential/u);
  });

  it("no longer says an unknown finding is one the audit did not look into", () => {
    const [row = ""] = /^\| `unknown` \|.*$/mu.exec(AUDIT) ?? [];

    expect(row).not.toMatch(/does not read outside systems/u);
    expect(row).toContain("step 4a");
    expect(row).toContain("`needed_by`");
  });

  it("has the probe step between discovering and writing the record", () => {
    const at = (heading: string): number => AUDIT.indexOf(heading);

    expect(at("### Step 4:")).toBeGreaterThan(-1);
    expect(at(PROBE_STEP)).toBeGreaterThan(at("### Step 4:"));
    expect(at(RECORD_STEP)).toBeGreaterThan(at(PROBE_STEP));
  });

  it("names every field of a probe, every result and every fixed id", () => {
    expect(
      unnamed(
        [
          "probes",
          "id",
          "system",
          "needed_by",
          "result",
          "request",
          "observed_error",
          "reason",
          "access_needed",
          ...AUDIT_PROBE_RESULTS,
          ...FIXED_PROBE_IDS,
        ],
        probeStep
      )
    ).toEqual([]);
    expect(probeStep).toContain(`\`${SERVER_SIDE_AUTHORITY.criterion}\``);
  });

  it("reads the hosting platform with one plain command, once, before the check", () => {
    const blocks = auditSkillShellBlocks().map(block => block.trim());

    expect(blocks.filter(block => block === PROBE_BLOCK)).toHaveLength(1);
    expect(blocks.indexOf(PROBE_BLOCK)).toBeGreaterThan(
      blocks.indexOf("lisa controls catalogue")
    );
    expect(blocks.indexOf(PROBE_BLOCK)).toBeLessThan(
      blocks.indexOf("lisa controls report-check")
    );
    expect(blocks.filter(block => /\bgh\b|\bcurl\b/u.test(block))).toEqual([]);
  });

  it("explains every field that command prints", () => {
    expect(unnamed(PRINTED, probeStep)).toEqual([]);
  });

  it("sends the agent only to access skills that exist", () => {
    const named = [
      ...new Set(
        [...AUDIT.matchAll(/`(lisa-[a-z]+-access)`/gu)].map(match =>
          String(match[1])
        )
      ),
    ];

    expect(named).toContain("lisa-secrets-access");
    expect(named.length).toBeGreaterThan(3);
    expect(
      named.filter(
        name => !existsSync(path.join(REPO_ROOT, SKILLS, name, "SKILL.md"))
      )
    ).toEqual([]);
  });

  it("gives the operator's sentences in the words the report uses", () => {
    expect(probeStep).toContain("`Lisa could not reach <system>: <error>.`");
    expect(probeStep).toContain(
      "`To check this requirement an agent needs <access>.`"
    );
    expect(between("### Step 6:", "### Step 7:")).toContain(
      UNREACHED_HEADING.replace("## ", "")
    );
  });

  it("keeps what a probe found out of the answers people gave", () => {
    expect(probeStep).toMatch(/Never\s+add\s+it\s+to\s+`answers`/u);
    expect(probeStep).toMatch(/candidate\s+on\s+the\s+`tracker`\s+question/u);
  });

  it("shows an example record with a probe that the check accepts", () => {
    const checked = validateAuditReport(completedExample(), context());
    const probes = (checked.report as AuditReport | null)?.probes ?? [];

    expect(checked.violations).toEqual([]);
    expect(probes.map(probe => probe.result)).toEqual(["unreachable"]);
    expect(probes[0]?.needed_by).toEqual([SERVER_SIDE_AUTHORITY]);
    expect(
      (EXAMPLE?.findings ?? [])
        .filter(
          finding => finding.criterion === SERVER_SIDE_AUTHORITY.criterion
        )
        .map(finding => finding.state)
    ).toEqual(["unknown"]);
  });
});
