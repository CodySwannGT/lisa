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
    expect(handoff).toMatch(/filed \*\*automatically\*\*/);
    expect(handoff).toContain("lisa-github-write-issue");
    expect(handoff).toContain("`self-hardening` label");
    expect(handoff).toMatch(/three-audience description/);
    expect(handoff).toMatch(/evidence chain/);
  });

  it("keys dedupe on the Lisa surface, never the host project or title", () => {
    expect(handoff).toMatch(/root-cause-key = <lisa-surface>#<failure-class>/);
    expect(handoff).toMatch(/never the host project or the local issue/i);
    expect(handoff).toMatch(/MUST collide on the same key/);
    expect(handoff).toMatch(/MARKER, never the title/);
    expect(handoff).toMatch(/never write a markerless body/i);
    expect(handoff).toMatch(/exact public Lisa-relative path/);
    expect(handoff).toMatch(/Canonical names, aliases.*are prohibited/);
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
    expect(handoff).toMatch(/Search \*\*all issue states\*\*/);
    expect(handoff).toMatch(/--state all/);
    expect(handoff).not.toMatch(/--state open/);
    expect(handoff).toMatch(/\*\*Existing ticket \(open or closed\)\*\*/);
    expect(handoff).toMatch(/do not reopen it yourself/);
    expect(handoff).toMatch(/upstream maintainer's call/);
  });

  it("requires the attribution skill's lisa verdict and a redacted chain", () => {
    expect(handoff).toMatch(
      /Require a confirmed `lisa` verdict from `lisa-attribute-failure` — always/
    );
    expect(handoff).toMatch(/never substitutes for the verdict/);
    expect(handoff).toMatch(/redacted evidence chain \(Lisa-owned text only/);
    expect(handoff).not.toMatch(/verbatim evidence chain/);
  });

  it("updates the existing ticket on repeat encounters instead of duplicating", () => {
    expect(handoff).toMatch(/repeat encounter/);
    expect(handoff).toContain("sll4-<12 lowercase hex>");
    expect(handoff).toMatch(/supplied fingerprint is only a validated seed/i);
    expect(handoff).toMatch(/Use the marker in the builder's stdout/);
    expect(handoff).toMatch(/never the supplied literal/);
    expect(handoff).toMatch(/Never open a second issue/);
  });

  it("enforces the configurable per-run cap with visible drops", () => {
    expect(handoff).toContain("hardening.maxUpstreamFilingsPerRun");
    expect(handoff).toMatch(/default `5`/);
    expect(handoff).toMatch(/note each dropped candidate visibly/);
    expect(handoff).toMatch(/never drop silently/);
  });

  it("binds evidence redaction for the public upstream repo", () => {
    expect(handoff).toMatch(/\*\*Evidence redaction \(binding\)\.\*\*/);
    expect(handoff).toMatch(/world-readable/);
    expect(handoff).toMatch(/Quote ONLY Lisa-owned surface text/);
    expect(handoff).toMatch(/must be REDACTED/);
    expect(handoff).toMatch(
      /Never paste host environment values, tokens\/credentials/
    );
    expect(handoff).toMatch(
      /host-project issue link only in the private local trace/
    );
    expect(handoff).toMatch(
      /never supplied to or emitted by the public builder/
    );
    expect(handoff).toMatch(/high-entropy values/);
    expect(handoff).toMatch(/strip on match/);
  });

  it("delegates public body composition to the executable allowlist builder", () => {
    expect(handoff).toContain("buildUpstreamAttributionIssueBody");
    expect(handoff).toContain("@codyswann/lisa/learnings");
    expect(handoff).toMatch(/non-allowlisted fields? must reject/i);
    expect(handoff).toMatch(/never by free-form prose assembly/i);
  });

  it("makes projection primary and invokes the public file-upstream command", () => {
    expect(handoff).toContain("file-upstream");
    expect(handoff).toMatch(/allowlist projection/i);
    expect(handoff).toMatch(/primary control/i);
    expect(handoff).toMatch(/backstop/i);
    expect(handoff).toMatch(
      /never assemble the public body as free-form prose/i
    );
    expect(handoff).toContain('"redactedPlaceholders"');
  });

  it("projects repeat-occurrence comments through the same builder", () => {
    expect(handoff).toMatch(/projected through the same builder/i);
    expect(handoff).toContain('"documentKind": "occurrence"');
    expect(handoff).toContain('"occurrenceFingerprint"');
    expect(handoff).toMatch(/free-form occurrence prose is prohibited/i);
  });

  it("never claims a filing before attribution and resolves inconclusive paths", () => {
    expect(handoff).toMatch(
      /Candidate routed for upstream attribution \(root cause suspected in Lisa\)/
    );
    expect(handoff).not.toMatch(/routed upstream\)/);
    expect(handoff).toContain(
      "[lisa-learning-upstream-handoff] key=<fingerprint>-inconclusive"
    );
    expect(handoff).toContain(
      "[lisa-learning-upstream-handoff] key=<fingerprint>-filing-failed"
    );
    expect(handoff).not.toContain("key=<fingerprint>-resolution");
    expect(handoff).toMatch(
      /Attribution was inconclusive — nothing was filed upstream and nothing was persisted locally\./
    );
    expect(handoff).toMatch(
      /Upstream filing did not complete — nothing was filed upstream/
    );
  });

  it("files nothing on ambiguous and keeps the local trace a note, not a rule", () => {
    expect(handoff).toMatch(
      /`ambiguous`, `project`, or a verdict that cannot name a concrete Lisa surface — files \*\*NOTHING\*\*/
    );
    expect(handoff).toMatch(/stays local and low-confidence/);
    expect(handoff).toMatch(/no durable local rule/);
    expect(handoff).toContain("[lisa-upstream-filed] key=<fingerprint>");
    expect(handoff).toContain("hardening.upstreamRepo");
    expect(handoff).toMatch(/Never block the primary build flow/);
  });
});
