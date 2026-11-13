/**
 * Prose contract for the automatic upstream Lisa filing loop (#1583).
 *
 * lisa-persist-learning's `handoff-upstream` disposition must file the
 * upstream ticket with root-cause marker dedupe (keyed on the Lisa surface,
 * never the host project), an evidence-rich body, a per-run cap, and only a
 * brief local linking note — never a durable local rule. These are agent
 * instructions, so the assertions cover the canonical source and every
 * checked-in runtime projection.
 * @module tests/unit/strategies/upstream-attribution-filing-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SKILL_ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa/.codex-plugin/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
] as const;

const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

describe.each(SKILL_ROOTS)("upstream filing contract (%s)", skillRoot => {
  const skill = read(`${skillRoot}/lisa-persist-learning/SKILL.md`);
  const handoff = skill.slice(
    skill.indexOf("### `handoff-upstream`"),
    skill.indexOf("### `persist`")
  );

  it("files automatically on the lisa verdict with the attribution marker", () => {
    expect(handoff).toContain(
      "[lisa-upstream-attribution] key=<root-cause-key>"
    );
    expect(handoff).toContain("lisa-github-write-issue");
    expect(handoff).toContain("`self-hardening` label");
  });

  it("keys dedupe on the Lisa surface, never the host project or title", () => {
    expect(handoff).toMatch(/MARKER, never the title/);
    for (const failureClass of [
      "access-control-failure",
      "agent-parity-regression",
      "configuration-regression",
      "data-integrity-failure",
      "dependency-regression",
      "generated-artifact-regression",
      "installation-regression",
      "observability-gap",
      "pagination-truncation",
      "performance-regression",
      "public-data-exposure",
      "release-regression",
      "runtime-regression",
      "stale-artifact-overwrite",
      "test-coverage-gap",
      "validation-gap",
      "workflow-contract-violation",
    ]) {
      expect(handoff).toContain(`\`${failureClass}\``);
    }
  });

  it("dedupes across all issue states and handles the closed-ticket branch", () => {
    expect(handoff).toMatch(/--state all/);
    expect(handoff).not.toMatch(/--state open/);
  });

  it("requires the attribution skill's lisa verdict and a redacted chain", () => {
    expect(handoff).toMatch(
      /Require a confirmed `lisa` verdict from `lisa-attribute-failure` — always/
    );
  });

  it("binds evidence redaction for the public upstream repo", () => {
    expect(handoff).toMatch(/must be REDACTED/);
  });

  it("delegates public body composition to the executable allowlist builder", () => {
    expect(handoff).toContain("buildUpstreamAttributionIssueBody");
    expect(handoff).toContain("@codyswann/lisa/learnings");
  });

  it("makes projection primary and invokes the public file-upstream command", () => {
    expect(handoff).toContain("file-upstream");
    expect(handoff).toContain('"redactedPlaceholders"');
  });

  it("projects repeat-occurrence comments through the same builder", () => {
    expect(handoff).toContain('"documentKind": "occurrence"');
    expect(handoff).toContain('"occurrenceFingerprint"');
  });

  it("files nothing on ambiguous and keeps the local trace a note, not a rule", () => {
    expect(handoff).toMatch(
      /`ambiguous`, `project`, or a verdict that cannot name a concrete Lisa surface — files \*\*NOTHING\*\*/
    );
    expect(handoff).toContain("hardening.upstreamRepo");
  });
});
