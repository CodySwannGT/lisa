/**
 * The session-manager dispatch path routes a CI-bounced item to its PR.
 *
 * The session manager dispatches `/lisa:implement <REF>`, which resolves the
 * item through `lisa-track`. Before CodySwannGT/lisa#4677 neither skill looked
 * for the `[lisa-ci-failed]` marker, so a bounced item was rebuilt from
 * scratch. The route is prose in the skills, so the contract is asserted on the
 * prose — in the authored base and in every generated agent copy, because a
 * copy that lost the text would silently rebuild on that agent.
 * @module tests/unit/scripts/lisa-ci-rework-route-skills
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const HELPER = "scripts/lisa-ci-rework-route.mjs";
/**
 * The supersession rule every prose surface states the same way: claims never
 * count, and a later non-failure marker counts only from a trusted author
 * (CodySwannGT/lisa#4707).
 */
const SUPERSESSION =
  "claim comments and session-manager notes (`[lisa-tracker-claim]`, `[claude-build-intake]`, `[lisa-session-manager]`) never count as Lisa markers for this purpose, failure markers count only from `github-actions[bot]`, and any other later Lisa marker counts only from a trusted author — `github-actions[bot]`, the item's author, or a configured `sessionManager.trustedAuthorIds` entry; only entries committed in `.lisa.config.json` count, never `.lisa.config.local.json`, because the producer runs in CI on a fresh checkout, and the account Lisa posts as counts as trusted only when it is the item's author or is listed in `sessionManager.trustedAuthorIds`";
const BASE = "plugins/src/base";
const COPIES = [
  "plugins/lisa",
  "plugins/lisa/.codex-plugin",
  "plugins/lisa-cursor",
  "plugins/lisa-agy",
  "plugins/lisa-copilot",
  "plugins/lisa-devin",
] as const;

/**
 * Every shipped path of one skill, base first.
 * @param skill - Skill directory name.
 * @returns Paths to its SKILL.md files.
 */
function skillPaths(skill: string): string[] {
  return [BASE, ...COPIES].map(root => `${root}/skills/${skill}/SKILL.md`);
}

/**
 * The text between a heading and the next heading of the same level.
 * @param text - Document.
 * @param heading - Full heading line prefix, e.g. `## Phase 3`.
 * @returns The section.
 */
function section(text: string, heading: string): string {
  const start = text.indexOf(heading);
  expect(start).toBeGreaterThan(-1);
  const level = heading.slice(0, heading.indexOf(" ") + 1);
  const end = text.indexOf(`\n${level}`, start + 1);
  return end === -1 ? text.slice(start) : text.slice(start, end);
}

describe.each(skillPaths("lisa-track"))("%s", file => {
  const phase3 = section(readFileSync(file, "utf8"), "## Phase 3");

  it("decides the CI-rework route before the claim posts its comment", () => {
    const helper = phase3.indexOf(HELPER);
    expect(helper).toBeGreaterThan(-1);
    expect(helper).toBeLessThan(phase3.indexOf("lisa-tracker-claim"));
    expect(phase3).toMatch(/before[^.]*claim comment/iu);
  });

  it("ignores claim comments, so the session manager's earlier claim never hides the marker", () => {
    expect(phase3).toContain(SUPERSESSION);
    expect(phase3).toMatch(/session-manager path[^\n]*already claimed/u);
    expect(phase3).not.toContain("Known limitation");
  });

  it("runs the helper only on GitHub when the script exists, else continues normally", () => {
    expect(phase3).toMatch(/tracker is `github`/u);
    expect(phase3).toMatch(new RegExp(`\`${HELPER}\` exists`, "u"));
    expect(phase3).toMatch(/not shipped to host projects/u);
  });

  it("returns the route field and blocks at the loop bound without claiming", () => {
    expect(phase3).toContain("route: implement|ci-rework pr=<n>");
    expect(phase3).toContain("failing_checks:");
    expect(phase3).toMatch(/`route` is `blocked`[^\n]*do not claim/u);
    expect(phase3).toContain("human_needed");
  });

  it("honours a human hold before the blocked route changes any label", () => {
    const blocked =
      /^- When `route` is `blocked`[^\n]*/mu.exec(phase3)?.[0] ?? "";
    expect(blocked.indexOf("hold check")).toBeGreaterThan(-1);
    expect(blocked.indexOf("hold check")).toBeLessThan(
      blocked.indexOf("remove the configured")
    );
    expect(blocked).toContain("held-by-gate");
  });
});

describe.each(skillPaths("lisa-implement"))("%s", file => {
  const text = readFileSync(file, "utf8");
  const resolve = section(text, "## Resolve the input");

  it("keeps the route lisa-track returned", () => {
    expect(resolve).toMatch(/Keep[^\n]*`lisa-track`.s `route`/u);
  });

  it("drives the existing PR from its head branch instead of building again", () => {
    expect(resolve).toContain("route: ci-rework");
    expect(resolve).toContain("`lisa-drive-pr-to-merge pr=<n>`");
    expect(resolve).toMatch(/head branch[^\n]*worktree/u);
    expect(resolve).toMatch(/skip the full build/iu);
    expect(resolve).toMatch(/never a new branch or a second pull request/iu);
  });

  it("files no rejection learning and is not complete while the marker is uncleared", () => {
    expect(resolve).toMatch(/no rejection evidence/iu);
    expect(resolve).toMatch(/no rejection learning/iu);
    expect(resolve).toContain("[lisa-rejection-candidate]");
    expect(resolve).toMatch(/not complete while the marker is uncleared/u);
  });

  it("documents the session-manager path as Claude Code only", () => {
    expect(resolve).toMatch(/runtime-neutral/u);
    expect(resolve).toMatch(/session manager[^\n]*Claude Code only/u);
  });
});

describe.each(skillPaths("lisa-github-build-intake"))("%s", file => {
  it("points the 3b trust check at the shared helper", () => {
    const text = readFileSync(file, "utf8");
    const claim = section(text, "#### 3b. Claim");
    expect(claim).toContain(HELPER);
  });

  it("states the same trusted-author supersession rule as the helper", () => {
    const claim = section(readFileSync(file, "utf8"), "#### 3b. Claim");
    expect(claim).toContain(SUPERSESSION);
    expect(claim).not.toContain("do not count as Lisa markers");
  });
});

describe("the rejection-detection rule names both dispatch paths", () => {
  const rule = readFileSync(
    `${BASE}/rules/reference/rejection-detection.md`,
    "utf8"
  );
  const head = rule.slice(0, rule.indexOf("\n---\n"));
  const body = rule.slice(rule.indexOf("\n---\n"));

  it.each([
    ["head", head],
    ["body", body],
  ])("in the %s", (_part, text) => {
    expect(text).toContain("lisa-track");
    expect(text).toContain("lisa-implement");
    expect(text).toContain(HELPER);
    expect(text).toContain(SUPERSESSION);
  });
});
