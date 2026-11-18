/**
 * What stops a canary from being opened, and what a canary run can never
 * send (CodySwannGT/lisa#4997).
 *
 * A canary is opened only on github.com, only when a read has shown the
 * account may write, and only for an entry whose proof can be run. And
 * whatever the code that opens one asks for, the door its requests go
 * through has no way to accept a pull request into its base branch or to
 * touch a branch outside the reserved prefix.
 * @module tests/unit/controls/pull-request-canary-guards
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { canaryDoor } from "../../../src/controls/canary-door.js";
import { recordRequests } from "../../../src/controls/protect-requests.js";
import { provedGates, type ProvedPart } from "../../helpers/control-proofs.js";
import type { GatesBlock } from "../../helpers/control-register.js";
import type { RecordedRequest } from "./support/fake-github.js";
import {
  MERGE_REQUEST,
  canaryPlatform,
  expectNothingLeft,
  settleWithCanaries,
} from "./support/canary-run.js";
import { removeCopies } from "./support/proof-run.js";
import { REPO } from "./support/protect-fixture.js";
import {
  PULL_ONLY_ENTRY,
  PULL_ONLY_GATE,
  PULL_ONLY_GATES,
  WORKING,
  entryOf,
  pointOf,
} from "./support/pull-request-run.js";
import { removeFixtures } from "./support/report-check-run.js";

const CONTROLS = path.resolve(__dirname, "..", "..", "..", "src", "controls");

/** The modules that settle the pull-request moment. */
const MODULES = readdirSync(CONTROLS).filter(file =>
  /^(?:canary-|pull-request-(?!executor))/u.test(file)
);

/**
 * A gates block with one gate enforced only on pull requests.
 * @param part - The gate's one part
 * @returns The gates block
 */
function pullOnly(part: ProvedPart): GatesBlock {
  return provedGates([part], PULL_ONLY_GATE, ["pull-request"]);
}

/**
 * The requests in a log that would create or change something.
 * @param log - The recorded requests
 * @returns Every request that is not a read
 */
function writes(log: readonly RecordedRequest[]): readonly RecordedRequest[] {
  return log.filter(request => request.method !== "GET");
}

afterEach(() => {
  removeCopies();
  removeFixtures();
});

describe("canaries without write access", () => {
  it.each([
    [false, "does not have write access"],
    [null, "did not say what the signed-in account may do"],
  ])(
    "creates nothing and is unknown when the platform says push is %s",
    async (push, said) => {
      const platform = canaryPlatform({ push });

      const settled = await settleWithCanaries(PULL_ONLY_GATES, platform);

      expect(writes(platform.log)).toEqual([]);
      expectNothingLeft(platform);
      const entry = entryOf(settled, PULL_ONLY_ENTRY);
      expect(entry).toMatchObject({
        outcome: "unknown",
        reason: "canary-permission-missing",
        rung: "observed",
        halves: [],
      });
      expect(entry.detail).toContain(
        `Opening one needs write access to ${REPO} (the push permission)`
      );
      expect(entry.detail).toContain(said);
      // What the settings showed is still on the record.
      expect(pointOf(settled, PULL_ONLY_ENTRY).observed).toBe("required");
      expect(settled.pullRequest).toMatchObject({
        permission: { can_write: push },
        sweep: null,
        canaries: [],
      });
    }
  );
});

describe("canaries on a platform other than GitHub", () => {
  it("asks nothing, creates nothing and stays at the observed rung", async () => {
    const platform = canaryPlatform();

    const settled = await settleWithCanaries(PULL_ONLY_GATES, platform, {
      remote: "https://gitlab.com/example-owner/example-repo.git",
    });

    expect(platform.log).toEqual([]);
    expect(entryOf(settled, PULL_ONLY_ENTRY)).toMatchObject({
      outcome: "unknown",
      reason: "platform-not-reached",
      rung: "observed",
    });
    expect(entryOf(settled, PULL_ONLY_ENTRY).detail).toContain(
      "hosted on GitLab"
    );
    expect(settled.pullRequest).toMatchObject({
      mode: "canaries",
      permission: null,
      canaries: [],
    });
  });
});

describe("an entry whose canaries cannot be opened", () => {
  it("is failed from the settings alone when the platform does not require its check", async () => {
    const platform = canaryPlatform({ required: ["some other check"] });

    const settled = await settleWithCanaries(PULL_ONLY_GATES, platform);

    expect(writes(platform.log)).toEqual([]);
    expect(entryOf(settled, PULL_ONLY_ENTRY)).toMatchObject({
      outcome: "failed",
      reason: "observed-not-required",
      rung: "observed",
    });
  });

  it("is unproved when a half of its proof is missing", async () => {
    const platform = canaryPlatform();

    const settled = await settleWithCanaries(
      pullOnly({ command: WORKING, without: ["clean"] }),
      platform
    );

    expect(writes(platform.log)).toEqual([]);
    expect(entryOf(settled, PULL_ONLY_ENTRY)).toMatchObject({
      outcome: "unproved",
      reason: "half-missing",
      rung: "observed",
    });
  });

  it("is unknown, quoting the declared effect, until the operator acknowledges it", async () => {
    const effect = "Raises an alert in the secret scanner";
    const gates = pullOnly({ command: WORKING, external_effects: [effect] });
    const refused = canaryPlatform();
    const allowed = canaryPlatform();

    const without = await settleWithCanaries(gates, refused);
    const acknowledged = await settleWithCanaries(gates, allowed, {
      inputs: { acknowledgeExternalEffects: true },
    });

    expect(writes(refused.log)).toEqual([]);
    expect(entryOf(without, PULL_ONLY_ENTRY)).toMatchObject({
      outcome: "unknown",
      reason: "external-effects",
      rung: "observed",
    });
    expect(entryOf(without, PULL_ONLY_ENTRY).detail).toContain(
      JSON.stringify(effect)
    );
    expect(entryOf(acknowledged, PULL_ONLY_ENTRY)).toMatchObject({
      outcome: "passed",
      rung: "exercised",
    });
  });
});

describe("the door canary requests go through", () => {
  it.each([
    [
      "accept a pull request",
      "PUT",
      "pulls/1/merge",
      { merge_method: "squash" },
    ],
    ["accept a branch", "POST", "merges", { base: "main", head: "x" }],
    ["delete another branch", "DELETE", "git/refs/heads/main", undefined],
    [
      "move a branch",
      "PATCH",
      "git/refs/heads/main",
      { sha: "0", force: true },
    ],
    [
      "create a branch outside the prefix",
      "POST",
      "git/refs",
      { ref: "refs/heads/feature", sha: "0" },
    ],
    [
      "open a pull request from another branch",
      "POST",
      "pulls",
      { head: "feature", base: "main" },
    ],
    ["reopen or retitle a pull request", "PATCH", "pulls/1", { state: "open" }],
    [
      "close and change a pull request at once",
      "PATCH",
      "pulls/1",
      { state: "closed", base: "main" },
    ],
    ["change a setting", "PATCH", "", { default_branch: "x" }],
  ])("refuses to %s, without sending it", (_, method, target, body) => {
    const platform = canaryPlatform();
    const log = recordRequests(platform.gh);
    const door = canaryDoor(log, REPO, true);

    const answer = door.send(method as "POST", target, body);

    expect(answer).toMatchObject({ ok: false });
    expect(platform.log).toEqual([]);
    expect(log.requests()).toEqual([
      expect.objectContaining({ method, sent: false }),
    ]);
  });

  it("passes on reads only until a read has shown the account may write", () => {
    const platform = canaryPlatform();
    const door = canaryDoor(recordRequests(platform.gh), REPO, false);

    const answer = door.send("POST", "git/refs", {
      ref: "refs/heads/lisa-attest/run0000a/20260201T000000Z-1-clean",
      sha: platform.head("main"),
    });

    expect(answer).toMatchObject({ ok: false });
    expect(platform.log).toEqual([]);
    expect(door.get("")).toMatchObject({ ok: true });
  });
});

describe("the modules that settle the pull-request moment", () => {
  it("contain no way to ask for a merge", () => {
    expect(MODULES.length).toBeGreaterThanOrEqual(10);
    const found = MODULES.flatMap(file =>
      readFileSync(path.join(CONTROLS, file), "utf8")
        .split("\n")
        .filter(text =>
          new RegExp(
            `${MERGE_REQUEST.source}|pr\\s+merge|auto-?merge|"PUT"`,
            "iu"
          ).test(text)
        )
        .map(text => `${file}: ${text.trim()}`)
    );

    expect(found).toEqual([]);
  });
});
