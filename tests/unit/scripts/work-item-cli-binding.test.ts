/**
 * Binding lifecycle of the work-item guard, driven in-process.
 *
 * See `tests/support/work-item-cli.ts` for why these run in-process alongside —
 * never instead of — the subprocess suites.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  cleanupFixtures,
  cleanupTemplates,
  bindTo,
  cli,
  offlineFixture,
  git,
  OTHER_REF,
  PR_URL,
  REF,
  stateFile,
} from "../../support/work-item-cli.js";

const BRANCH = "feature/tracked";
const ATTACH_BRANCH = "attach-branch";
const MALFORMED = "Malformed work-item binding";

afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

describe("in-process CLI: binding lifecycle", () => {
  it("links a work item and records branch, provider and ref", () => {
    const fixture = offlineFixture();
    const result = cli(fixture, ["link", REF]);
    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain(`work-item bound: ${REF}`);
    expect(JSON.parse(readFileSync(stateFile(fixture), "utf8"))).toEqual({
      branch: BRANCH,
      provider: "github",
      ref: REF,
      version: 1,
    });
  });

  it("prints the binding back through `current`", () => {
    const fixture = offlineFixture();
    bindTo(fixture, REF);
    expect(JSON.parse(cli(fixture, ["current"]).stdout).ref).toBe(REF);
  });

  it("refuses `current` when nothing is bound", () => {
    const fixture = offlineFixture();
    const result = cli(fixture, ["current"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("No work item is bound to this worktree");
  });

  it("removes the binding on `clear`, and is content to clear twice", () => {
    const fixture = offlineFixture();
    bindTo(fixture, REF);
    expect(cli(fixture, ["clear"]).stdout).toContain(
      "work-item binding cleared"
    );
    expect(existsSync(stateFile(fixture))).toBe(false);
    expect(cli(fixture, ["clear"]).exitCode).toBeUndefined();
  });

  it("accepts `bind` as the alias the older checked-in hooks still call", () => {
    const fixture = offlineFixture();
    expect(cli(fixture, ["bind", REF]).stdout).toContain(
      `work-item bound: ${REF}`
    );
  });

  it("names both spellings and every subcommand in the usage refusal", () => {
    const fixture = offlineFixture();
    const result = cli(fixture, ["nonsense"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Usage: lisa-work-item.mjs link|current");
    expect(result.stderr).toContain("validate-pr");
    expect(result.stderr).toContain("`bind` is accepted as an alias");
  });

  it("refuses a reference outside the configured repository", () => {
    const fixture = offlineFixture();
    const result = cli(fixture, ["link", "acme/other#42"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "is outside configured tracker repository acme/widgets"
    );
  });

  it("refuses a reference that is not owner/repo#number at all", () => {
    const fixture = offlineFixture();
    const result = cli(fixture, ["link", "#42"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("expected owner/repo#123");
  });

  it("refuses acting on a binding that belongs to another branch", () => {
    const fixture = offlineFixture();
    bindTo(fixture, REF);
    git(fixture.root, ["switch", "-q", "-c", "feature/other"], fixture.env);
    const result = cli(fixture, ["backlink", "--pr-url", PR_URL]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      `belongs to branch '${BRANCH}', not 'feature/other'`
    );
  });

  it("refuses a binding whose shape it does not recognise", () => {
    const fixture = offlineFixture();
    bindTo(fixture, REF);
    writeFileSync(stateFile(fixture), '{"version":2}\n');
    const result = cli(fixture, ["current"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(MALFORMED);
  });

  it("refuses a binding whose ref is not a string", () => {
    const fixture = offlineFixture();
    bindTo(fixture, REF);
    writeFileSync(
      stateFile(fixture),
      `${JSON.stringify({ branch: BRANCH, provider: "github", ref: 42, version: 1 })}\n`
    );
    expect(cli(fixture, ["current"]).stderr).toContain(MALFORMED);
  });

  it("refuses an unparseable binding file with the file named", () => {
    const fixture = offlineFixture();
    bindTo(fixture, REF);
    writeFileSync(stateFile(fixture), "{not json\n");
    const result = cli(fixture, ["current"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Invalid JSON:");
  });

  it("refuses a trailer that disagrees with this worktree's binding", () => {
    const fixture = offlineFixture();
    bindTo(fixture, REF);
    const file = path.join(fixture.root, "MSG");
    writeFileSync(file, `feat: tracked\n\nWork-Item: ${OTHER_REF}\n`);
    const result = cli(fixture, ["validate-commit", file]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      `does not match this worktree's binding ${REF}`
    );
  });
});

describe("in-process CLI: attaching a branch", () => {
  it("attaches a detached-HEAD binding once a branch exists", () => {
    const fixture = offlineFixture();
    git(fixture.root, ["checkout", "-q", "--detach"], fixture.env);
    cli(fixture, ["link", REF]);
    expect(JSON.parse(readFileSync(stateFile(fixture), "utf8")).branch).toBe(
      null
    );
    git(fixture.root, ["switch", "-q", "-c", "feature/later"], fixture.env);
    expect(cli(fixture, [ATTACH_BRANCH]).stdout).toContain(
      "work-item binding attached to feature/later"
    );
    expect(JSON.parse(readFileSync(stateFile(fixture), "utf8")).branch).toBe(
      "feature/later"
    );
  });

  it("tells a pending binding what command attaches it", () => {
    const fixture = offlineFixture();
    git(fixture.root, ["checkout", "-q", "--detach"], fixture.env);
    cli(fixture, ["link", REF]);
    git(fixture.root, ["switch", "-q", BRANCH], fixture.env);
    const file = path.join(fixture.root, "MSG");
    writeFileSync(file, `feat: tracked\n\nWork-Item: ${REF}\n`);
    const result = cli(fixture, ["validate-commit", file]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "pending branch attachment; run lisa-work-item.mjs attach-branch"
    );
  });

  it("refuses to attach from a detached HEAD with no rebase in progress", () => {
    const fixture = offlineFixture();
    bindTo(fixture, REF);
    git(fixture.root, ["checkout", "-q", "--detach"], fixture.env);
    const result = cli(fixture, [ATTACH_BRANCH]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Create or check out a feature branch before binding a work item"
    );
  });

  it("refuses to attach a binding whose provider is not the configured one", () => {
    const fixture = offlineFixture();
    bindTo(fixture, REF, BRANCH, "jira");
    const result = cli(fixture, [ATTACH_BRANCH]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "binding provider jira does not match configured tracker github"
    );
  });
});
