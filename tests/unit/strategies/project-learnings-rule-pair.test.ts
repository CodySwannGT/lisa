import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const REFERENCE = "plugins/src/base/rules/reference/project-learnings.md";
const INDEX = "plugins/src/base/rules/eager/00-rule-index.md";
const CONFIG_RESOLUTION_REFERENCE =
  "plugins/src/base/rules/reference/config-resolution.md";
const AGY_BRIDGE = "src/core/instruction-files-migration.ts";

/**
 * #3992 retired this rule's eager head. Its three obligations — resolve the
 * ledger from config, consume only the bounded projection, never append to host
 * rules — were stated in three places at once: here, in `config-resolution`,
 * and in the managed `AGENTS.md` bridge Lisa writes into every host. The bridge
 * is the one that carries them into a session, and it alone resolves the
 * concrete path for the project, so it is the surface worth pinning.
 *
 * The reference body survives because it is NOT duplicated: it documents the
 * ledger's entry schema, which nothing else states.
 */
describe("project-learnings rule", () => {
  it("keeps the entry schema in the reference body", () => {
    const reference = readFileSync(REFERENCE, "utf8");

    expect(reference).toContain("# Project Learnings");
    expect(reference).toContain("@codyswann/lisa/learnings");
    expect(reference).toMatch(/^-\s*`id`\s*$/m);
    expect(reference).toMatch(/^-\s*`confidence`\s*$/m);
    expect(reference).not.toMatch(/maxEntries|maxTokens|maxRuleCharacters/);
  });

  it("stays reachable from the eager rule index now that it has no head", () => {
    const index = readFileSync(INDEX, "utf8");

    expect(index).toContain("`project-learnings`");
    expect(index).toContain("reference/project-learnings.md");
  });

  it("keeps the ledger obligations on a surface that reaches a session", () => {
    const bridge = readFileSync(AGY_BRIDGE, "utf8");

    // The managed AGENTS.md block, written into every adopting project.
    expect(bridge).toContain("machine-managed project-learnings ledger");
    expect(bridge).toContain("bounded projection");
    expect(bridge).toContain("never");
    expect(bridge).toContain("`learnings.file` override");
  });

  it("keeps the ledger location rule where config resolution states it", () => {
    const configResolution = readFileSync(CONFIG_RESOLUTION_REFERENCE, "utf8");

    expect(configResolution).toContain("PROJECT_LEARNINGS.md");
    expect(configResolution).toContain("@codyswann/lisa/learnings");
    // The whole point of the relocation: the ledger stays out of eager context.
    expect(configResolution).toMatch(
      /auto-loaded rules tree|never an auto-loaded/
    );
  });
});
