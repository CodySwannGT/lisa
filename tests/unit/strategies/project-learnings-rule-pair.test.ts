import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const EAGER = "plugins/src/base/rules/eager/project-learnings.md";
const REFERENCE = "plugins/src/base/rules/reference/project-learnings.md";

describe("project-learnings eager/reference rule pair", () => {
  it("ships the canonical eager and reference pair from plugin source", () => {
    const eager = readFileSync(EAGER, "utf8");
    const reference = readFileSync(REFERENCE, "utf8");

    expect(eager).toContain("# Project Learnings (load-bearing)");
    expect(eager).toContain("@codyswann/lisa/learnings");
    expect(eager).toContain("PROJECT_LEARNINGS.md");
    expect(eager).not.toMatch(/maxEntries|maxTokens|maxRuleCharacters/);

    expect(reference).toContain("# Project Learnings");
    expect(reference).toContain("@codyswann/lisa/learnings");
    expect(reference).toMatch(/^-\s*`id`\s*$/m);
    expect(reference).toMatch(/^-\s*`confidence`\s*$/m);
    expect(reference).not.toMatch(/maxEntries|maxTokens|maxRuleCharacters/);
  });
});
