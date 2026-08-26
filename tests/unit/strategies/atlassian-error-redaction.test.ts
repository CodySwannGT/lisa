/**
 * Atlassian diagnostics identify the failed identity check without copying
 * configured or provider-returned email addresses into logs.
 * @module tests/unit/strategies/atlassian-error-redaction
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

describe.each(ROOTS)("%s Atlassian diagnostics", root => {
  const skill = readFileSync(
    path.resolve(root, "skills/lisa-atlassian-access/SKILL.md"),
    "utf8"
  );

  it("redacts account identifiers from error output", () => {
    expect(skill).toContain("account=<configured>");
    expect(skill).toMatch(/active account does not match the configured/i);
    expect(skill).toMatch(/TOKEN identity does not match the configured/i);
    expect(skill).not.toContain("account=$email");
    expect(skill).not.toMatch(/belongs to '\$me_email'/);
    expect(skill).not.toMatch(/requires '\$email'/);
  });
});
