/**
 * Lane attribution: routing an orphan back to the session that made it.
 *
 * Every session in this fleet pushes under one git identity, so `author.login`
 * is a constant and a branch or pull request nobody claims cannot be handed to
 * whoever should finish it. These cases hold the mechanism to the three things
 * that made the constant useless (CodySwannGT/lisa#3771):
 *
 * - it must DISCRIMINATE. Every case that could be satisfied by returning a
 *   constant is paired with a second lane, because one lane's commits are
 *   exactly what a broken implementation still gets right.
 * - it must SURVIVE branch deletion, which is when routing matters most.
 * - it must publish NOTHING that is itself an identifier, because the
 *   repository is public.
 * @module tests/unit/scripts/work-item-cli-lane
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  deriveLaneId,
  judgeLane,
  LANE_ID_VARIABLES,
  parseLaneId,
  renderLaneTrailer,
  resolveCallerLaneId,
} from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";
import { OWNER_ID_VARIABLES } from "../../../src/cli/worktree-ownership.js";
import {
  cleanupFixtures,
  cleanupTemplates,
  cli,
  Fixture,
  git,
  offlineFixture,
} from "../../support/work-item-cli.js";

/** Two distinct sessions. Everything here is asserted against both. */
const SESSION_A = "11111111-2222-3333-4444-555555555555";
const SESSION_B = "99999999-8888-7777-6666-555555555555";
const PREPARE = "prepare-commit-msg";
const WORK = "feat: work\n";
const ORPHAN_BRANCH = "feature/orphan";
const LANE = "lane";

/**
 * The environment overrides that put the CLI in one lane.
 *
 * Every variable in the resolution list is set, so a case's lane is the one it
 * names rather than whatever the surrounding agent runtime happened to export
 * into the test process.
 * @param ownerId - Owner id the runtime is pretending to supply.
 * @returns Overrides for one `cli` invocation.
 */
function inLane(ownerId: string): Record<string, string> {
  return Object.fromEntries(
    LANE_ID_VARIABLES.map((variable: string) => [variable, ownerId])
  );
}

/** Overrides that leave the CLI with no lane at all. */
const NO_LANE = inLane("");

afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

/**
 * Prepare a commit message in one lane and return what was written.
 * @param fixture - Repository to work in.
 * @param ownerId - Owner id of the lane making the commit.
 * @param body - Message before preparation.
 * @returns The prepared message.
 */
function prepared(fixture: Fixture, ownerId: string, body: string): string {
  const file = path.join(fixture.root, "MSG");
  writeFileSync(file, body);
  cli(fixture, [PREPARE, file], inLane(ownerId));
  return readFileSync(file, "utf8");
}

/**
 * Commit an empty change carrying a prepared message.
 * @param fixture - Repository to commit in.
 * @param ownerId - Owner id of the lane making the commit.
 * @param body - Message before preparation.
 * @returns The new commit's object id.
 */
function commitInLane(fixture: Fixture, ownerId: string, body: string): string {
  const message = prepared(fixture, ownerId, body);
  git(
    fixture.root,
    ["commit", "-q", "--allow-empty", "-m", message],
    fixture.env
  );
  return git(fixture.root, ["rev-parse", "HEAD"], fixture.env);
}

describe("lane derivation", () => {
  it("gives two sessions two different lanes, and each one a stable lane", () => {
    const first = deriveLaneId(SESSION_A);
    expect(first).toBe(deriveLaneId(SESSION_A));
    expect(first).not.toBe(deriveLaneId(SESSION_B));
  });

  it("has no lane for a runtime that supplied no id", () => {
    expect(deriveLaneId("")).toBeUndefined();
    expect(deriveLaneId("   ")).toBeUndefined();
    expect(deriveLaneId(undefined)).toBeUndefined();
    expect(resolveCallerLaneId({})).toBeUndefined();
  });

  it("prefers the explicit override, then the variable Claude Code exports", () => {
    expect(resolveCallerLaneId({ CLAUDE_CODE_SESSION_ID: SESSION_B })).toBe(
      deriveLaneId(SESSION_B)
    );
    expect(
      resolveCallerLaneId({
        CLAUDE_CODE_SESSION_ID: SESSION_B,
        LISA_OWNER_ID: SESSION_A,
      })
    ).toBe(deriveLaneId(SESSION_A));
  });

  it("resolves through the same variables the worktree receipt uses", () => {
    expect([...LANE_ID_VARIABLES]).toEqual([...OWNER_ID_VARIABLES]);
  });
});

describe("lane hygiene", () => {
  // The remedy this rejects is the obvious one: recording the session URL.
  // That is a filed identifier-hygiene defect on a public repository, so the
  // token is held to publishing none of what it was derived from.
  const LOADED =
    "https://claude.ai/code/session_01NBdGbLKhahGpNHVBfqCtFK acme-corp /Users/someone/workspace/private-app";

  it("publishes nothing the owner id contained", () => {
    const lane = deriveLaneId(LOADED) as string;
    for (const fragment of [
      "claude.ai",
      "session_01NBdGbLKhahGpNHVBfqCtFK",
      "acme-corp",
      "private-app",
      "/Users/",
    ])
      expect(lane).not.toContain(fragment);
  });

  it("is a fixed-length, lowercase-hex token and nothing else", () => {
    const lane = deriveLaneId(LOADED) as string;
    expect(lane).toMatch(/^lane-[0-9a-f]{12}$/);
    expect(renderLaneTrailer(lane)).toBe(`Lane-Id: ${lane}`);
  });

  it("refuses a token that only looks like one", () => {
    expect(parseLaneId("Lane-Id: lane-nothexadeci\n")).toBeUndefined();
    expect(parseLaneId("Lane-Id: lane-abc\n")).toBeUndefined();
    expect(
      parseLaneId("Lane-Id: https://claude.ai/code/session_x\n")
    ).toBeUndefined();
  });
});

describe("routing verdicts", () => {
  it("routes an attributed marker to its own lane and away from another", () => {
    const mine = deriveLaneId(SESSION_A);
    expect(judgeLane(mine, mine)).toBe("mine");
    expect(judgeLane(mine, deriveLaneId(SESSION_B))).toBe("theirs");
  });

  it("never claims work for a caller that cannot identify itself", () => {
    expect(judgeLane(deriveLaneId(SESSION_A), undefined)).toBe("theirs");
    expect(judgeLane(undefined, deriveLaneId(SESSION_A))).toBe("unattributed");
  });
});

describe("in-process CLI: lane", () => {
  it("stamps the making lane onto a commit message", () => {
    const fixture = offlineFixture();
    const message = prepared(fixture, SESSION_A, WORK);
    expect(message.split("\n")[0]).toBe("feat: work");
    expect(parseLaneId(message)).toBe(deriveLaneId(SESSION_A));
  });

  it("stamps nothing when the runtime supplied no id", () => {
    const fixture = offlineFixture();
    const file = path.join(fixture.root, "MSG");
    writeFileSync(file, WORK);
    cli(fixture, [PREPARE, file], NO_LANE);
    expect(readFileSync(file, "utf8")).toBe(WORK);
  });

  it("keeps the originating lane when another lane rewrites the message", () => {
    const fixture = offlineFixture();
    const file = path.join(fixture.root, "MSG");
    writeFileSync(file, WORK);
    cli(fixture, [PREPARE, file], inLane(SESSION_A));
    cli(fixture, [PREPARE, file], inLane(SESSION_B));
    expect(parseLaneId(readFileSync(file, "utf8"))).toBe(
      deriveLaneId(SESSION_A)
    );
  });

  it("keeps the trailer block one paragraph, signature line and all", () => {
    const fixture = offlineFixture();
    // The shape an agent-authored message actually has: a trailer block whose
    // LAST line is not a trailer. `git interpret-trailers` opens a new
    // paragraph for that, which pushes `Co-Authored-By` out of the final
    // paragraph — the only place GitHub reads co-authors from. A routing aid
    // must not break attribution to fix attribution.
    const message = prepared(
      fixture,
      SESSION_A,
      "feat: work\n\nBody.\n\nWork-Item: acme/widgets#42\nCo-Authored-By: Claude\nGenerated with a coding agent\n"
    );
    const paragraphs = message.trimEnd().split("\n\n");
    const last = paragraphs[paragraphs.length - 1];
    expect(last).toContain("Work-Item: acme/widgets#42");
    expect(last).toContain("Co-Authored-By: Claude");
    expect(last).toContain(
      renderLaneTrailer(deriveLaneId(SESSION_A) as string)
    );
    expect(message.trimEnd().endsWith("Generated with a coding agent")).toBe(
      true
    );
  });

  it("opens a paragraph when the message ends in prose", () => {
    const fixture = offlineFixture();
    const message = prepared(fixture, SESSION_A, "feat: work\n\nJust prose.\n");
    expect(message).toContain("Just prose.\n\nLane-Id: ");
  });

  it("reports the caller's own lane", () => {
    const fixture = offlineFixture();
    expect(cli(fixture, [LANE], inLane(SESSION_A)).stdout).toBe(
      deriveLaneId(SESSION_A)
    );
    expect(cli(fixture, [LANE], NO_LANE).stdout).toBe("unattributed");
  });

  it("tells two lanes' commits apart from one lane's point of view", () => {
    const fixture = offlineFixture();
    const mine = commitInLane(fixture, SESSION_A, "feat: mine\n");
    const theirs = commitInLane(fixture, SESSION_B, "feat: theirs\n");
    const lane = deriveLaneId(SESSION_A);
    expect(
      cli(fixture, [LANE, "--commit", mine], inLane(SESSION_A)).stdout
    ).toBe(`LANE mine ${lane}`);
    expect(
      cli(fixture, [LANE, "--commit", theirs], inLane(SESSION_A)).stdout
    ).toBe(`LANE theirs ${deriveLaneId(SESSION_B)}`);
  });

  it("still routes an orphan after its branch is deleted", () => {
    const fixture = offlineFixture();
    // The state the issue describes: work made on a feature branch, merged,
    // and the branch deleted the way a landed pull request deletes its own.
    git(fixture.root, ["switch", "-q", "-c", ORPHAN_BRANCH], fixture.env);
    commitInLane(fixture, SESSION_B, "feat: orphaned work\n");
    git(fixture.root, ["switch", "-q", "main"], fixture.env);
    git(
      fixture.root,
      ["merge", "-q", "--no-ff", "-m", "Merge branch", ORPHAN_BRANCH],
      fixture.env
    );
    git(fixture.root, ["branch", "-q", "-D", ORPHAN_BRANCH], fixture.env);
    expect(
      cli(fixture, [LANE, "--commit", "HEAD^2"], inLane(SESSION_A)).stdout
    ).toBe(`LANE theirs ${deriveLaneId(SESSION_B)}`);
    expect(
      cli(fixture, [LANE, "--commit", "HEAD^2"], inLane(SESSION_B)).stdout
    ).toBe(`LANE mine ${deriveLaneId(SESSION_B)}`);
  });

  it("classifies a pull-request body or tracker comment with the same token", () => {
    const fixture = offlineFixture();
    const body = path.join(fixture.root, "BODY");
    writeFileSync(
      body,
      `Closes something.\n\n${renderLaneTrailer(deriveLaneId(SESSION_B) as string)}\n`
    );
    expect(
      cli(fixture, [LANE, "--text-file", body], inLane(SESSION_B)).stdout
    ).toBe(`LANE mine ${deriveLaneId(SESSION_B)}`);
    expect(
      cli(fixture, [LANE, "--text-file", body], inLane(SESSION_A)).stdout
    ).toBe(`LANE theirs ${deriveLaneId(SESSION_B)}`);
  });

  it("reports an unattributed commit as unattributed, not as somebody's", () => {
    const fixture = offlineFixture();
    const sha = commitInLane(fixture, "", "feat: no lane\n");
    expect(
      cli(fixture, [LANE, "--commit", sha], inLane(SESSION_A)).stdout
    ).toBe("LANE unattributed none");
  });

  it("refuses a flag left without a value", () => {
    const fixture = offlineFixture();
    const outcome = cli(fixture, [LANE, "--commit"], inLane(SESSION_A));
    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("--commit requires a value");
  });
});
