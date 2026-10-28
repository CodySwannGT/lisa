/** Real attempted writes fail distinctly from an ordinary pending obligation. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import {
  cleanupFixtures,
  cleanupTemplates,
} from "../../support/work-item-cli.js";
import {
  proofFixture,
  attachRecord,
  proofCli,
  PROOF_REF,
  setApi,
} from "../../support/work-item-proof-fixture.js";

const LABEL_EDIT = "label edit";

useIoLatencyBudget();
afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

describe("native completion write failures", () => {
  it("reports an unpublished pending producer refusal with a nonzero exit", () => {
    const fixture = proofFixture();
    const recordFile = path.join(fixture.root, "pending-delivery-record.json");
    writeFileSync(recordFile, JSON.stringify(fixture.record));
    setApi(fixture, ["api", "repos/acme/code/actions/runs/31"], {
      json: {
        id: 31,
        repository: { id: 881 },
        workflow_id: 22,
        path: ".github/workflows/deploy.yml",
        event: "push",
        head_branch: "main",
        head_sha: fixture.merge,
        run_attempt: 1,
        status: "in_progress",
        conclusion: null,
      },
    });
    const result = proofCli(fixture, [
      "publish-completion-proof",
      "--ref",
      PROOF_REF,
      "--record",
      recordFile,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("pending-proof");
    expect(result.stdout).toBe("");
    expect(readFileSync(fixture.env.FAKE_GH_WRITES_FILE!, "utf8")).toBe("");
    const state = JSON.parse(
      readFileSync(fixture.env.FAKE_GH_STATE_FILE!, "utf8")
    );
    expect(state.state).toBe("OPEN");
    expect(state.comments).toHaveLength(1);
    expect(
      JSON.parse(readFileSync(fixture.env.FAKE_GH_ASSET_INDEX!, "utf8")).some(
        (asset: { id: number }) => asset.id === 101
      )
    ).toBe(false);
    expect(readFileSync(fixture.env.FAKE_GH_UNHANDLED_FILE!, "utf8")).toBe("");
  });

  it.each([LABEL_EDIT, "native close"])(
    "reports %s failure without declaring completion",
    operation => {
      const fixture = proofFixture();
      attachRecord(fixture);
      const args =
        operation === LABEL_EDIT
          ? [
              "issue",
              "edit",
              "42",
              "--repo",
              "acme/code",
              "--add-label",
              "status:done",
              "--remove-label",
              "status:in-progress",
            ]
          : [
              "issue",
              "close",
              "42",
              "--repo",
              "acme/code",
              "--reason",
              "completed",
            ];
      setApi(fixture, args, {
        failure: "Controlled native provider write failure",
      });
      const result = proofCli(fixture, ["complete", "--ref", PROOF_REF]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("write-error");
      expect(result.stdout).not.toContain("work-item completed:");
      expect(readFileSync(fixture.env.FAKE_GH_UNHANDLED_FILE!, "utf8")).toBe(
        ""
      );
      expect(
        JSON.parse(readFileSync(fixture.env.FAKE_GH_STATE_FILE!, "utf8")).state
      ).toBe("OPEN");
      const attempted = readFileSync(fixture.env.FAKE_GH_WRITES_FILE!, "utf8")
        .trim()
        .split("\n")
        .map(line => JSON.parse(line));
      expect(attempted).toContainEqual(args);
      expect(attempted).toHaveLength(operation === LABEL_EDIT ? 1 : 2);
    }
  );
});
