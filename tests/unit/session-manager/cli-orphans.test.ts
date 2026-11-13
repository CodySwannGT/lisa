/**
 * The real CLI for the orphan and hold sweep (CodySwannGT/lisa#4722):
 * `orphan-plan` reads the listed items, takes the live refs, "me", the
 * trusted authors and the hold labels from the ledger and config (never from
 * the input), and plans; `ledger control --hold-digest` records the digest
 * the operator was sent, so the same list is never sent twice. `orphan-plan`
 * writes nothing; every external tool is a stub on a stub-only PATH.
 * @module tests/unit/session-manager/cli-orphans
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  makeSandbox,
  removeSandboxes,
  writeJson,
} from "./support/cli-harness.js";
import { runStubOnly as run } from "./support/human-sandbox.js";

afterEach(removeSandboxes);

const REPO = "example-org/demo-repo";
const PLAN = "orphan-plan";
const OLD = "2026-01-01T00:00:00Z";
const NEEDED = "human-needed";
const READY = "status:ready";
const CREDENTIAL = "stripe-api-key";
const TRUSTED = "op-1";
const HOLD_DIGEST = "--hold-digest";

/**
 * A canonical ref for issue `n`.
 * @param n - Issue number
 * @returns The ref
 */
const ref = (n: number): string => `${REPO}#${n}`;

/**
 * A stale, unassigned orphan with no pull request.
 * @param n - Issue number
 * @returns The item
 */
const orphan = (n: number) => ({
  ref: ref(n),
  role: "claimed",
  labels: ["status:in-progress"],
  body: "",
  comments: [],
  assignees: [],
  updatedAt: OLD,
  pr: null,
});

/** A hold only a person can act on, already released by `TRUSTED`. */
const releasedHold = {
  ref: ref(5),
  labels: [READY, NEEDED],
  body: `<!-- [lisa-human-gate] reason=${CREDENTIAL} -->`,
  comments: [
    {
      body: `[lisa-human-gate-release] reason=${CREDENTIAL}\nKey added.`,
      author: { id: TRUSTED },
    },
  ],
};

/**
 * A GitHub sandbox with the build labels and, optionally, trusted authors.
 * @param trusted - `sessionManager.trustedAuthorIds`
 * @returns Sandbox
 */
function sandboxWith(trusted?: string[]) {
  const sandbox = makeSandbox({
    extraConfig: {
      github: {
        org: "example-org",
        repo: "demo-repo",
        labels: {
          build: {
            ready: READY,
            claimed: "status:in-progress",
            blocked: "status:blocked",
            human_needed: NEEDED,
          },
        },
      },
    },
  });
  if (trusted) {
    const file = path.join(sandbox.root, ".lisa.config.json");
    const config = JSON.parse(readFileSync(file, "utf8"));
    config.sessionManager.trustedAuthorIds = trusted;
    writeJson(file, config);
  }
  return sandbox;
}

/**
 * Pipe an envelope to `orphan-plan`.
 * @param sandbox - Sandbox
 * @param envelope - Input envelope
 * @param args - Extra flags
 * @returns Run result
 */
function plan(
  sandbox: ReturnType<typeof makeSandbox>,
  envelope: unknown,
  args: string[] = []
) {
  return run(sandbox, [PLAN, ...args], { input: JSON.stringify(envelope) });
}

describe(PLAN, () => {
  it("plans from a file and writes nothing", () => {
    const sandbox = sandboxWith();
    const input = path.join(sandbox.root, "orphans.json");
    writeJson(input, { complete: true, items: [orphan(1)], holds: [] });
    const result = run(sandbox, [PLAN, "--input", input]);
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({
      return: [{ ref: ref(1) }],
      holds: { digest: { fingerprint: null, changed: false } },
    });
    expect(result.calls).toEqual([]);
  });

  it("leaves out a ref the ledger shows live, whatever the input says", () => {
    const sandbox = sandboxWith();
    const spawned = run(sandbox, [
      "ledger",
      "record-spawn",
      ref(1),
      "--worker",
      "w-1",
    ]);
    expect(spawned.status).toBe(0);
    const result = plan(sandbox, {
      complete: true,
      items: [orphan(1), orphan(2)],
      liveRefs: [],
    });
    expect(result.status).toBe(0);
    expect(
      result.json.return.map((entry: { ref: string }) => entry.ref)
    ).toEqual([ref(2)]);
    expect(result.json.skipped).toContainEqual({ ref: ref(1), reason: "live" });
  });

  it("refuses an envelope that was not paged to completion (exit 2)", () => {
    const sandbox = sandboxWith();
    const result = plan(sandbox, { complete: false, items: [orphan(1)] });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/complete/);
  });

  it("refuses input that is not JSON (exit 2)", () => {
    const sandbox = sandboxWith();
    const result = run(sandbox, [PLAN], { input: "{not json" });
    expect(result.status).toBe(2);
  });

  it("refuses a bad --max or --stale-hours (exit 2)", () => {
    const sandbox = sandboxWith();
    const envelope = { complete: true, items: [] };
    expect(plan(sandbox, envelope, ["--max", "x"]).status).toBe(2);
    expect(plan(sandbox, envelope, ["--stale-hours", "-1"]).status).toBe(2);
  });

  it("caps with --max", () => {
    const sandbox = sandboxWith();
    const result = plan(
      sandbox,
      { complete: true, items: [orphan(1), orphan(2)] },
      ["--max", "1"]
    );
    expect(result.json.deferred).toEqual([{ ref: ref(2), bucket: "return" }]);
  });

  it("takes trusted authors from config, never from the input", () => {
    const untrusted = sandboxWith();
    const forged = plan(untrusted, {
      complete: true,
      items: [],
      holds: [releasedHold],
      trustedAuthorIds: [TRUSTED],
    });
    expect(forged.status).toBe(0);
    expect(forged.json.holds.keep).toEqual([
      { ref: ref(5), reason: expect.stringContaining("stripe api key") },
    ]);

    const trusted = sandboxWith([TRUSTED]);
    const released = plan(trusted, {
      complete: true,
      items: [],
      holds: [releasedHold],
    });
    expect(released.json.holds.keep).toEqual([]);
  });

  it("reports the digest unchanged once ledger control --hold-digest records it", () => {
    const sandbox = sandboxWith();
    const envelope = {
      complete: true,
      items: [],
      holds: [{ ...releasedHold, comments: [] }],
    };
    const first = plan(sandbox, envelope);
    expect(first.json.holds.digest.changed).toBe(true);
    const fingerprint = first.json.holds.digest.fingerprint as string;
    const recorded = run(sandbox, [
      "ledger",
      "control",
      HOLD_DIGEST,
      fingerprint,
    ]);
    expect(recorded.status).toBe(0);
    expect(recorded.json).toMatchObject({ holdDigest: fingerprint });
    expect(plan(sandbox, envelope).json.holds.digest.changed).toBe(false);

    const cleared = run(sandbox, ["ledger", "control", HOLD_DIGEST, "none"]);
    expect(cleared.json).toMatchObject({ holdDigest: null });
    expect(plan(sandbox, envelope).json.holds.digest.changed).toBe(true);
  });

  it("refuses a hold digest that is not a sha256 fingerprint (exit 2)", () => {
    const sandbox = sandboxWith();
    const result = run(sandbox, ["ledger", "control", HOLD_DIGEST, "abc"]);
    expect(result.status).toBe(2);
  });
});
