/** Supported Linear terminal writes use the same native accepted-proof reader. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import {
  cleanupFixtures,
  cleanupTemplates,
} from "../../support/work-item-cli.js";
import {
  linearProofFixture,
  attachLinearRecord,
  LINEAR_REF,
  LINEAR_PR,
} from "../../support/work-item-linear-proof-fixture.js";
import { proofCli, setApi } from "../../support/work-item-proof-fixture.js";

const COMPLETED = "work-item completed:";

useIoLatencyBudget();
afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

/** Native write recording and current state are independent success oracles. */
function observe(fixture: ReturnType<typeof linearProofFixture>) {
  expect(readFileSync(fixture.env.FAKE_GH_UNHANDLED_FILE!, "utf8")).toBe("");
  return {
    state: JSON.parse(
      readFileSync(fixture.env.FAKE_LINEAR_STATE_FILE!, "utf8")
    ),
    writes: readFileSync(fixture.env.FAKE_GH_WRITES_FILE!, "utf8"),
  };
}

/** Only explicit local provider data is contacted by the actual executable. */
function complete(fixture: ReturnType<typeof linearProofFixture>) {
  const result = proofCli(fixture, [
    "complete",
    "--ref",
    LINEAR_REF,
    "--pr-url",
    LINEAR_PR,
  ]);
  console.log(
    JSON.stringify({
      command: [
        "node",
        "scripts/lisa-work-item.mjs",
        "complete",
        "--ref",
        LINEAR_REF,
        "--pr-url",
        LINEAR_PR,
      ],
      exit_code: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      controlledProvider: true,
    })
  );
  expect(result.stderr).toBe("");
  return result;
}

describe("actual Linear accepted-proof completion", () => {
  it("allows exact accepted completion and repeats without a terminal update", () => {
    const fixture = linearProofFixture();
    attachLinearRecord(fixture);
    expect(complete(fixture).stdout).toContain(COMPLETED);
    const first = observe(fixture);
    expect(first.state.state.type).toBe("completed");
    expect(first.state.assignee).toEqual({
      id: "owner",
      name: "Fixture Owner",
    });
    expect(first.writes.trim().split("\n")).toHaveLength(1);
    expect(complete(fixture).stdout).toContain("already-completed");
    expect(observe(fixture).writes).toBe(first.writes);
  });

  it.each(["absent", "pending", "revoked"])(
    "preserves Linear ownership and state with %s proof",
    state => {
      const fixture = linearProofFixture();
      if (state !== "absent") {
        fixture.record.state = state;
        attachLinearRecord(fixture);
      }
      expect(complete(fixture).stdout).toContain(
        state === "revoked" ? "[invalid-proof]" : "[pending-proof]"
      );
      expect(observe(fixture).writes).toBe("");
      expect(observe(fixture).state.state.type).toBe("started");
      expect(observe(fixture).state.assignee).toEqual({
        id: "owner",
        name: "Fixture Owner",
      });
    }
  );

  it("uses complete comment pages during both initial and final authorization reads", () => {
    const fixture = linearProofFixture();
    const file = fixture.env.FAKE_LINEAR_STATE_FILE!;
    const state = JSON.parse(readFileSync(file, "utf8"));
    state.comments.nodes.push(
      ...Array.from({ length: 100 }, (_, index) => ({
        id: `prose-${index}`,
        body: "Ordinary context.",
        user: { id: "ordinary" },
      }))
    );
    writeFileSync(file, JSON.stringify(state));
    attachLinearRecord(fixture);
    expect(complete(fixture).stdout).toContain(COMPLETED);
    expect(observe(fixture).state.state.type).toBe("completed");
    expect(readFileSync(fixture.env.FAKE_LINEAR_LOG!, "utf8")).toContain(
      '"after":"page-2"'
    );
  });

  it("publishes through native Linear locator creation before a separate terminal call", () => {
    const fixture = linearProofFixture();
    const file = path.join(fixture.root, "linear-proof.json");
    writeFileSync(file, JSON.stringify(fixture.record));
    const result = proofCli(fixture, [
      "publish-completion-proof",
      "--ref",
      LINEAR_REF,
      "--record",
      file,
    ]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).category).toBe("published");
    expect(observe(fixture).state.state.type).toBe("started");
    expect(observe(fixture).writes).not.toContain("issueUpdate");
    expect(complete(fixture).stdout).toContain(COMPLETED);
  });

  it("does not fall back past malformed proof by another eligible native publisher", () => {
    const fixture = linearProofFixture();
    const old = attachLinearRecord(fixture);
    fixture.record.revision = 2;
    Object.assign(fixture.record, { supersedes: old.sha256, manifest: null });
    Object.assign(fixture.record.producer, {
      github_actor_id: 996,
      tracker_actor_id: "second-linear-publisher",
    });
    const pointer = attachLinearRecord(fixture, 2);
    const file = fixture.env.FAKE_GH_ASSET_INDEX!;
    const assets = JSON.parse(readFileSync(file, "utf8"));
    const actor = { id: 996, login: "second-publisher", type: "User" };
    assets.find((row: { id: number }) => row.id === pointer.asset_id).uploader =
      actor;
    writeFileSync(file, JSON.stringify(assets));
    setApi(
      fixture,
      ["api", "repos/acme/code/collaborators/second-publisher/permission"],
      { json: { permission: "write", user: actor } }
    );
    expect(complete(fixture).stdout).toContain("[invalid-proof]");
    expect(observe(fixture).writes).toBe("");
  });
});
