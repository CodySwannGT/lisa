/** Actual CLI authority, revision, and source-frontier controls. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { publishCompletionProof } from "../../../all/copy-overwrite/scripts/lib/completion-proof-publisher.mjs";
import {
  parseLisaUsageSection,
  upsertLisaUsageSection,
} from "../../../src/utils/usage-accounting.js";

import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import {
  cleanupFixtures,
  cleanupTemplates,
  commit,
} from "../../support/work-item-cli.js";
import {
  proofFixture,
  attachRecord,
  proofCli,
  PROOF_REF,
  setApi,
  setCompare,
  digest,
} from "../../support/work-item-proof-fixture.js";
import {
  addRevision,
  configureBot,
  producerAttempt,
  editProofState,
  type ProofFixture,
} from "../../support/work-item-proof-history.js";

const ACCEPTED = "accepted-for-completion";
const COMPLETED = "work-item completed:";

useIoLatencyBudget();
afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

/** Assert native state and all provider operation coverage independently. */
function observe(fixture: ProofFixture) {
  expect(readFileSync(fixture.env.FAKE_GH_UNHANDLED_FILE!, "utf8")).toBe("");
  return {
    writes: readFileSync(fixture.env.FAKE_GH_WRITES_FILE!, "utf8"),
    state: JSON.parse(readFileSync(fixture.env.FAKE_GH_STATE_FILE!, "utf8")),
  };
}

/** All these are actual live canonical CLI invocations; tracker data is local. */
function complete(fixture: ProofFixture, extra: string[] = []) {
  const result = proofCli(fixture, ["complete", "--ref", PROOF_REF, ...extra]);
  console.log(
    JSON.stringify({
      command: [
        "node",
        "scripts/lisa-work-item.mjs",
        "complete",
        "--ref",
        PROOF_REF,
        ...extra,
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

describe("completion proof native authority and freshness", () => {
  it.each(["pending", "revoked"])(
    "does not fall back from a newer trusted %s revision",
    state => {
      const fixture = proofFixture();
      addRevision(fixture, 1, ACCEPTED);
      addRevision(fixture, 2, state);
      const result = complete(fixture);
      expect(result.stdout).toContain(
        state === "pending" ? "[pending-proof]" : "[invalid-proof]"
      );
      expect(observe(fixture).writes).toBe("");
      expect(observe(fixture).state.state).toBe("OPEN");
    }
  );

  it("ignores an untrusted newer marker instead of allowing it to revoke accepted proof", () => {
    const fixture = proofFixture();
    addRevision(fixture, 1, ACCEPTED);
    const outsider = { id: 995, login: "fixture-outsider", type: "User" };
    setApi(
      fixture,
      ["api", "repos/acme/code/collaborators/fixture-outsider/permission"],
      { json: { permission: "read", user: outsider } }
    );
    addRevision(fixture, 2, "revoked", outsider);
    expect(complete(fixture).stdout).toContain(COMPLETED);
    expect(observe(fixture).state.state).toBe("CLOSED");
  });

  it("rejects a related supplied PR rather than selecting different authorization", () => {
    const fixture = proofFixture();
    attachRecord(fixture);
    const result = complete(fixture, [
      "--pr-url",
      "https://github.com/acme/code/pull/8",
    ]);
    expect(result.stdout).toContain("not the accepted record's primary");
    expect(observe(fixture).writes).toBe("");
  });

  it.each(["original", "advanced"])(
    "permits unrelated newer main work with %s snapshot and post-close metadata",
    snapshot => {
      const fixture = proofFixture();
      const tip = commit(
        fixture,
        "docs: unrelated newer work\n\nWork-Item: acme/code#99"
      );
      setApi(fixture, ["api", "repos/acme/code/branches/main"], {
        json: { commit: { sha: tip } },
      });
      setCompare(fixture, fixture.merge, tip);
      setCompare(fixture, tip, tip);
      if (snapshot === "advanced")
        fixture.record.source.production_snapshot_sha = tip;
      attachRecord(fixture);
      expect(complete(fixture).stdout).toContain(COMPLETED);
      const first = observe(fixture);
      const postcondition = {
        schema_version: 1,
        provider: "github",
        ref: PROOF_REF,
        native_id: first.state.id,
        state: first.state.state,
        completed_at: new Date().toISOString(),
        record_sha256: digest(
          readFileSync(path.join(fixture.env.FAKE_GH_ASSET_DIRECTORY!, "4.bin"))
        ),
      };
      const authorization = JSON.parse(
        first.state.comments
          .find((row: { body: string }) =>
            row.body.startsWith("[lisa-completion-authorization]\n")
          )
          .body.split("\n")
          .slice(1)
          .join("\n")
      );
      const indent = snapshot === "advanced" ? 2 : undefined;
      editProofState(fixture, state => {
        const verify = parseLisaUsageSection(state.body).entries[0]!;
        state.body = upsertLisaUsageSection(state.body, {
          entries: [{ ...verify, model: "updated-fixture-model" }],
        });
        state.body += `<!-- lisa:completion-authorization:start -->\n${JSON.stringify(authorization, null, indent)}\n<!-- lisa:completion-authorization:end -->\n`;
        state.body += `<!-- lisa:completion-postcondition:start -->\n${JSON.stringify(postcondition, null, indent)}\n<!-- lisa:completion-postcondition:end -->\n`;
      });
      expect(complete(fixture).stdout).toContain("already-completed");
      expect(observe(fixture).writes).toBe(first.writes);
    }
  );
});

describe("explicit repository automation publisher", () => {
  it("retains an unreadable publisher cause privately without exposing provider output", () => {
    const context = {
      repository: "example/project",
      policy: {},
      readSubject: () => ({}),
      readComments: () => [],
      run: (_command: string, args: string[]) =>
        args[1] === "user"
          ? {
              status: 1,
              stdout: "",
              stderr: "synthetic private provider detail",
            }
          : { status: 0, stdout: JSON.stringify({ id: 1 }), stderr: "" },
    };
    let refusal: unknown;
    try {
      publishCompletionProof(context, {});
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(Error);
    if (!(refusal instanceof Error)) throw Error("Expected publisher refusal");
    expect(refusal.cause).toBeInstanceOf(Error);
    expect(refusal.message).toContain("no explicit repository automation");
    expect(refusal.message).not.toContain("synthetic private provider detail");
  });

  it("publishes during its attempt then waits for that same attempt without rewriting bytes", () => {
    const fixture = proofFixture();
    configureBot(fixture);
    producerAttempt(fixture, "in_progress", null);
    const file = path.join(fixture.root, "bot-proof.json");
    writeFileSync(file, JSON.stringify(fixture.record));
    const publication = proofCli(fixture, [
      "publish-completion-proof",
      "--ref",
      PROOF_REF,
      "--record",
      file,
    ]);
    expect(publication.stderr).toBe("");
    expect(publication.status).toBe(0);
    expect(JSON.parse(publication.stdout).category).toBe(
      "published/pending-producer"
    );
    const before = observe(fixture);
    expect(complete(fixture).stdout).toContain("[pending-proof]");
    expect(observe(fixture).writes).toBe(before.writes);
    const bytes = readFileSync(
      path.join(fixture.env.FAKE_GH_ASSET_DIRECTORY!, "101.bin")
    );
    producerAttempt(fixture, "completed", "success");
    expect(complete(fixture).stdout).toContain(COMPLETED);
    expect(
      readFileSync(path.join(fixture.env.FAKE_GH_ASSET_DIRECTORY!, "101.bin"))
    ).toEqual(bytes);
    expect(observe(fixture).state.state).toBe("CLOSED");
  });

  it.each(["failure", "cancelled", "timed_out"])(
    "does not upgrade pinned %s using a successful later attempt",
    conclusion => {
      const fixture = proofFixture();
      const bot = configureBot(fixture);
      producerAttempt(fixture, "completed", conclusion);
      setApi(fixture, ["api", "repos/acme/code/actions/runs/32/attempts/2"], {
        json: { conclusion: "success", run_attempt: 2 },
      });
      addRevision(fixture, 1, ACCEPTED, bot);
      const result = complete(fixture);
      expect(result.stdout).toContain(
        "pinned proof-publisher attempt did not succeed"
      );
      expect(observe(fixture).writes).toBe("");
    }
  );
});
