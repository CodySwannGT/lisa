/** Concrete review findings through the actual supported terminal entry points. */
import { readFileSync, writeFileSync } from "node:fs";
import { afterAll, afterEach, describe, expect, it } from "vitest";
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
} from "../../support/work-item-proof-fixture.js";

useIoLatencyBudget();
afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

describe.each(["direct", "applying sweep"])(
  "reviewed proof freshness: %s",
  mode => {
    it.each([
      "caller-selected source snapshot",
      "authorization block requirements",
      "postcondition block requirements",
      "contradictory global evidence head",
      "missing global evidence head",
      "unknown prose inside managed usage",
      "duplicate canonical authorization",
      "duplicate canonical postcondition",
    ])("refuses %s before terminal writes", finding => {
      const fixture = proofFixture();
      if (finding === "caller-selected source snapshot") {
        const newer = commit(
          fixture,
          `fix: newer unverified implementation\n\nWork-Item: ${PROOF_REF}`
        );
        fixture.record.source.production_snapshot_sha = newer;
        setApi(fixture, ["api", "repos/acme/code/branches/main"], {
          json: { commit: { sha: newer } },
        });
        setCompare(fixture, fixture.merge, newer);
        setCompare(fixture, newer, newer);
      } else if (finding.startsWith("duplicate canonical")) {
        const name = finding.endsWith("authorization")
          ? "authorization"
          : "postcondition";
        const value =
          name === "authorization"
            ? {
                schema_version: 1,
                record_id: fixture.record.record_id,
                revision: 1,
                repository: "acme/code",
                asset_id: 4,
                sha256: "b".repeat(64),
              }
            : {
                schema_version: 1,
                provider: "github",
                ref: PROOF_REF,
                native_id: "I_fixture42",
                record_sha256: "b".repeat(64),
                completed_at: new Date().toISOString(),
                state: "CLOSED",
              };
        const key = name === "authorization" ? "repository" : "state";
        const payload = JSON.stringify(value).replace(
          `"${key}":`,
          `"${key}":"Additional delivery requirement: verify the second service", "${key}":`
        );
        const file = fixture.env.FAKE_GH_STATE_FILE!;
        const state = JSON.parse(readFileSync(file, "utf8"));
        state.body += `<!-- lisa:completion-${name}:start -->\n${payload}\n<!-- lisa:completion-${name}:end -->\n`;
        writeFileSync(file, JSON.stringify(state));
      } else if (finding === "unknown prose inside managed usage") {
        const file = fixture.env.FAKE_GH_STATE_FILE!;
        const state = JSON.parse(readFileSync(file, "utf8"));
        state.body = state.body.replace(
          "<!-- lisa:usage-rollup ",
          "Additional delivery requirement: verify the second service before completion.\n<!-- lisa:usage-rollup "
        );
        writeFileSync(file, JSON.stringify(state));
      } else if (finding.includes("global evidence head")) {
        if (finding.startsWith("missing"))
          Reflect.deleteProperty(
            fixture.record.evidence[0]!,
            "artifact_head_sha"
          );
        else fixture.record.evidence[0]!.artifact_head_sha = "a".repeat(40);
      } else {
        const name = finding.startsWith("authorization")
          ? "authorization"
          : "postcondition";
        const file = fixture.env.FAKE_GH_STATE_FILE!;
        const state = JSON.parse(readFileSync(file, "utf8"));
        state.body += `<!-- lisa:completion-${name}:start -->\n## New Delivery Requirement\nA new required behavior has not been verified.\n<!-- lisa:completion-${name}:end -->\n`;
        writeFileSync(file, JSON.stringify(state));
      }
      attachRecord(fixture);
      const args =
        mode === "direct"
          ? ["complete", "--ref", PROOF_REF]
          : ["sweep", "--apply", "--since", fixture.before, "--branch", "main"];
      const result = proofCli(fixture, args);
      const writes = readFileSync(fixture.env.FAKE_GH_WRITES_FILE!, "utf8");
      console.log(
        JSON.stringify({
          name: `${mode}: ${finding}`,
          command: ["node", "scripts/lisa-work-item.mjs", ...args],
          exit_code: result.status,
          stdout: result.stdout,
          stderr: result.stderr,
          providerWrites: writes,
          controlledProvider: true,
        })
      );
      expect(readFileSync(fixture.env.FAKE_GH_UNHANDLED_FILE!, "utf8")).toBe(
        ""
      );
      expect(writes).toBe("");
      expect(result.stdout).not.toContain("work-item completed:");
      expect(result.stdout).toMatch(/\[(?:pending-proof|invalid-proof)\]/);
    });
  }
);
