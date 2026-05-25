/**
 * Regression tests for the optional GitHub ProjectV2 coordination config.
 *
 * Issues #698 and #699 extend the canonical GitHub ProjectV2 docs with an
 * optional `github.projects.v2` block plus the validation semantics later
 * setup/doctor and writer utilities must follow. V1 permits only
 * namespace-matched ownership: the Project owner slug must match the tracked
 * repository namespace (`github.org`). Validation reads owner/access and
 * downgrades failures to warnings only when `required` remains false.
 *
 * Both source and generated plugin roots are asserted so a missed
 * `bun run build:plugins` fails the suite.
 * @module tests/unit/strategies/github-project-config-resolution
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const RULE_ROOTS = ["plugins/src/base/rules", "plugins/lisa/rules"] as const;
const SKILL_ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;

describe.each(RULE_ROOTS)(
  "config-resolution GitHub ProjectV2 docs (%s)",
  rulesRoot => {
    const content = readFileSync(
      path.resolve(rulesRoot, "config-resolution.md"),
      "utf8"
    );

    it("documents the optional github.projects.v2 schema", () => {
      expect(content).toContain('"projects": {');
      expect(content).toContain('"v2": {');
      expect(content).toContain('"owner": {');
      expect(content).toContain('"kind": "organization"');
      expect(content).toContain('"slug": "<org-or-user>"');
      expect(content).toContain('"number": 7');
      expect(content).toContain('"required": false');
    });

    it("documents same-namespace ownership and best-effort default semantics", () => {
      expect(content).toMatch(
        /MUST match the tracked repository namespace \(`github\.org`\)/i
      );
      expect(content).toMatch(/cross-namespace coordination is rejected/i);
      expect(content).toMatch(
        /Default `false` keeps Project membership best-effort/i
      );
    });

    it("documents validation behavior for best-effort vs required mode", () => {
      expect(content).toMatch(
        /setup\/doctor and writer preflight validation MUST read/i
      );
      expect(content).toMatch(/owner \+ access/i);
      expect(content).toMatch(/required = false.*warnings/i);
      expect(content).toMatch(/required = true.*blocking errors/i);
    });
  }
);

describe.each(SKILL_ROOTS)(
  "setup-github Project config docs (%s)",
  skillRoot => {
    const content = readFileSync(
      path.resolve(skillRoot, "setup-github", "SKILL.md"),
      "utf8"
    );

    it("shows the GitHub ProjectV2 config shape under the github block", () => {
      expect(content).toContain('"projects": {');
      expect(content).toContain('"v2": {');
      expect(content).toContain('"owner": { "kind": "organization"');
      expect(content).toContain('"number": 7');
      expect(content).toContain('"required": false');
    });

    it("documents the v1 namespace rule and optional strict mode", () => {
      expect(content).toMatch(
        /MUST match the tracked repository namespace \(`github\.org`\)/i
      );
      expect(content).toMatch(/cross-namespace Project ownership is rejected/i);
      expect(content).toMatch(/best-effort unless .* opts into strict mode/i);
    });

    it("documents warning-vs-error validation behavior for project access", () => {
      expect(content).toMatch(/setup\/doctor.*runtime validation.*must read/i);
      expect(content).toMatch(/owner \+ access/i);
      expect(content).toMatch(/required: false.*warning-level/i);
      expect(content).toMatch(/required: true.*blocking errors/i);
    });
  }
);
