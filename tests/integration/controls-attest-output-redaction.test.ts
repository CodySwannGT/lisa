/** A disposable attestation filters credential-shaped text in both output formats. */
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildControlAuditFixture } from "../helpers/control-audit-fixtures.js";
import {
  checks,
  F_NONE_SOURCE,
  proofFiles,
  proofPatches,
  provedGates,
} from "../helpers/control-proofs.js";
import { fakeGithubToken } from "../helpers/fake-credentials.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import { operatorEnv } from "../support/carrier-install.js";

useIoLatencyBudget();

describe("attest terminal output", () => {
  it.each(["table", "json"])(
    "redacts a synthetic token from %s output",
    format => {
      const token = fakeGithubToken();
      const fragments = JSON.stringify([token.slice(0, 2), token.slice(2)]);
      const [node = "", option = "", check = ""] = checks(F_NONE_SOURCE);
      const command = [
        node,
        option,
        `console.log("Fixture login", ${fragments}.join("")); ${check}`,
      ];
      const fixture = buildControlAuditFixture("F-none", {
        extraFiles: {
          ".lisa.config.json": JSON.stringify({
            gates: provedGates([{ command }]),
          }),
          ...proofFiles(proofPatches("F-none", F_NONE_SOURCE)),
        },
      });
      try {
        const result = boundedSpawnSync({
          label: `attest redact in ${format}`,
          command: process.execPath,
          args: [
            path.resolve("dist/index.js"),
            "--no-update-check",
            "controls",
            "attest",
            ...(format === "json" ? ["--json"] : []),
          ],
          cwd: fixture.repoPath,
          env: operatorEnv(),
          baseMs: 30_000,
        });
        const output = result.stdout + result.stderr;
        expect(result.status).toBe(0);
        expect(output.includes(token)).toBe(false);
        expect(output).toContain("[REDACTED:GITHUB_TOKEN]");
      } finally {
        fixture.cleanup();
      }
    }
  );
});
