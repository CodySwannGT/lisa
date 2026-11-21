/** The plan-created milestone describes a claimed item on each tracker. */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const CLAIMED = "`claimed`";
const LINEAR_SKILL = "skills/lisa-linear-sync/SKILL.md";
const EXAMPLE =
  /Example for `plan-created`:[\s\S]*?Suggested state: \*\*<state resolved from linear\.workflow\.claimed>\*\*\./u;
const SOURCES = [
  [`plugins/src/base/${LINEAR_SKILL}`, [2, 1], [CLAIMED, CLAIMED]],
  [
    "plugins/src/base/skills/lisa-github-sync/SKILL.md",
    [1],
    ["`status:in-progress`"],
  ],
  [
    "plugins/src/base/skills/lisa-jira-sync/SKILL.md",
    [1],
    ["configured `jira.workflow.claimed` status"],
  ],
  ["plugins/src/base/agents/linear-agent.md", [1], [CLAIMED]],
] as const;
const GENERATED = [
  "plugins/lisa",
  "plugins/lisa/.codex-plugin",
  "plugins/lisa-agy",
  "plugins/lisa-copilot",
  "plugins/lisa-cursor",
  "plugins/lisa-devin",
];

/**
 * Read the status rows for the milestone, ignoring the separate message examples.
 * @param file - Repository-relative path
 * @returns Columns from each plan-created row
 */
function planRows(file: string): string[][] {
  return readFileSync(path.join(ROOT, file), "utf8")
    .split("\n")
    .filter(line => line.startsWith("|"))
    .map(line =>
      line
        .split("|")
        .slice(1, -1)
        .map(cell => cell.trim())
    )
    .filter(
      ([milestone]) =>
        milestone === "Plan created" || milestone === "`plan-created`"
    );
}

describe("tracker sync at plan-created", () => {
  it.each(SOURCES)("%s suggests the claimed role", (file, columns, roles) => {
    const rows = planRows(file);

    expect(
      rows.map((row, index) => row[columns[index]!]),
      file
    ).toEqual(roles);
  });

  it("shows a configured claimed state in the plan-created comment example", () => {
    const source = readFileSync(
      path.join(ROOT, "plugins/src/base", LINEAR_SKILL),
      "utf8"
    );
    expect(source).toMatch(EXAMPLE);
  });

  it.each(GENERATED)("%s ships both Linear suggestions as claimed", surface => {
    const file = `${surface}/${LINEAR_SKILL}`;
    const rows = planRows(file);

    expect([rows[0]?.[2], rows[1]?.[1]], file).toEqual([CLAIMED, CLAIMED]);
    expect(readFileSync(path.join(ROOT, file), "utf8"), file).toMatch(EXAMPLE);
  });
});
