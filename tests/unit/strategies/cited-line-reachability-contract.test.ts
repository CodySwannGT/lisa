/**
 * A cited line is a hypothesis, not a location (CodySwannGT/lisa#4491).
 *
 * ## The defect
 *
 * Bug reports often name the file or line they believe causes the defect. In a
 * Container/View split the named `FooContainer` can exist with zero production
 * importers while the live route renders `FooView` directly. An agent that
 * fixes the quoted line and writes a unit test rendering `FooContainer` gets a
 * genuine red-to-green test — on dead code. The PR merges and the user's page
 * is unchanged.
 *
 * `lisa-root-cause-analysis` already demands "confirm by executing", and
 * `lisa-reproduce-bug` already demands the reproduction "exercise the real
 * path". Neither applied that to the FIX TARGET. The existing
 * `control-reachability` contract covers an existing test named as a control,
 * not a source location named as the cause.
 *
 * ## What these cases pin
 *
 * The RCA skill names the cited location as hypothesis zero with an explicit
 * kill condition, says a direct render/call does not establish reachability,
 * and records the proof in the evidence trail. The reproduce-bug skill lists
 * reaching the fix target as part of the real path. Every generated agent
 * surface (including Devin) must carry the same prose.
 * @module tests/unit/strategies/cited-line-reachability-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Source plus every generated agent surface that ships these skills. */
const SKILL_ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa/.codex-plugin/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
  "plugins/lisa-devin/skills",
] as const;

/**
 * Read one skill's prose from a generated or source root.
 * @param root - Skills directory of a plugin root
 * @param skill - Skill directory name
 * @returns The skill text
 */
function read(root: string, skill: string): string {
  return readFileSync(path.resolve(root, `${skill}/SKILL.md`), "utf8");
}

/**
 * Collapse whitespace so a rule is matched as a sentence, not as the line
 * breaks the prose happens to wrap at today.
 * @param source - Skill text
 * @returns The text with every whitespace run reduced to one space
 */
function flat(source: string): string {
  return source.replace(/\s+/gu, " ");
}

describe.each(SKILL_ROOTS)("%s root-cause-analysis", root => {
  const raw = read(root, "lisa-root-cause-analysis");
  const skill = flat(raw);

  it("names a cited location as a hypothesis with its own section", () => {
    expect(skill).toContain("## A cited line is a hypothesis, not a location");
  });

  it("places the section right after confirm-by-executing", () => {
    // Ordering is the claim: the section applies that principle to the fix
    // target, so it must follow it rather than float elsewhere.
    const confirm = skill.indexOf("## Confirm by executing, not by reasoning");
    const cited = skill.indexOf(
      "## A cited line is a hypothesis, not a location"
    );
    const surviving = skill.indexOf("## Surviving a disproof is not proof");
    expect(confirm).toBeGreaterThanOrEqual(0);
    expect(cited).toBeGreaterThan(confirm);
    expect(surviving).toBeGreaterThan(cited);
  });

  it("treats it as hypothesis zero with a reachability kill condition", () => {
    expect(skill).toContain("treat that as hypothesis zero");
    expect(skill).toContain("**no production entry point reaches it.**");
  });

  it("says a direct render or call does not establish reachability", () => {
    expect(skill).toMatch(
      /A test that renders or calls the cited symbol directly does not establish reachability\. It goes red-to-green on dead code too\./u
    );
  });

  it("tags the reachability throw so the existing cleanup grep finds it", () => {
    // A bare `throw` left in the cited block is invisible to the skill's
    // mechanical cleanup, which only searches for the `[DEBUG:` tag.
    expect(skill).toContain(
      'a temporary `throw new Error("[DEBUG:<issue>] reached")` (or a `[DEBUG:<issue>]` log line) in the cited block'
    );
    expect(skill).toContain('git grep -n "\\[DEBUG:"');
  });

  it("separates the Reachability line from the evidence-trail table", () => {
    // Without a blank line, markdown renders the line as a broken table row.
    // Matched on raw text: whitespace is the claim here.
    expect(raw).toMatch(
      /\| what this establishes \|\n\nReachability: <entry point>/u
    );
  });

  it("records reachability in the evidence-trail output", () => {
    expect(skill).toContain(
      "Reachability: <entry point> → … → <cited symbol> (static | throw | scoped coverage)"
    );
    const trail = skill.indexOf("### Evidence trail");
    const cause = skill.indexOf("### Cause — confirmed verdicts only");
    const line = skill.lastIndexOf("Reachability: <entry point>");
    // The last occurrence is the output-template line; it belongs to the
    // evidence trail, not to the cause section.
    expect(line).toBeGreaterThan(trail);
    expect(cause).toBeGreaterThan(line);
  });
});

describe.each(SKILL_ROOTS)("%s reproduce-bug", root => {
  const skill = flat(read(root, "lisa-reproduce-bug"));

  it("requires the entry point to reach the code the fix will change", () => {
    expect(skill).toContain(
      "- **That the entry point reaches the code the fix will change.** A reproduction that mounts or calls the cited component or function directly, not through the entry point, is replacement scaffolding."
    );
  });

  it("tags the reachability throw for cleanup", () => {
    expect(skill).toContain(
      "Show the path (importer trace, a temporary `[DEBUG:<issue>]`-tagged `throw`, or route-scoped coverage) before treating the cited code as the fix target."
    );
  });

  it("lists it among the real-path requirements", () => {
    const survives = skill.indexOf(
      "**Whether the failure survives with prerequisites in place"
    );
    const reaches = skill.indexOf(
      "**That the entry point reaches the code the fix will change.**"
    );
    const unreachable = skill.indexOf("If the real path is unreachable");
    expect(survives).toBeGreaterThanOrEqual(0);
    expect(reaches).toBeGreaterThan(survives);
    expect(unreachable).toBeGreaterThan(reaches);
  });
});
