/** Exercise a paired proof through a real package task. @module */
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildProofFixture,
  checks,
  FAILURE_TEXT,
  F_NONE_SOURCE,
  proofFiles,
  proofPatches,
} from "../helpers/control-proofs.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import { operatorEnv } from "../support/carrier-install.js";

useIoLatencyBudget();

const CLI = path.resolve("dist/index.js");
const GATE = "x-proof-lint";
const TASK = "proof-lint";
const SCRIPT = "fixture-lint.cjs";
const NAME = "lint";

describe("proofs for task-based gates", () => {
  it("checks the pair directly and exercises it through a real commit hook", () => {
    const patches = proofFiles(proofPatches("F-none", F_NONE_SOURCE), NAME);
    const [violation, clean] = Object.keys(patches);
    const [, , program = ""] = checks(F_NONE_SOURCE);
    const fixture = buildProofFixture(
      {
        runner: "npm run",
        [GATE]: {
          commit: {
            level: "required",
            run: TASK,
            failure_shape: [FAILURE_TEXT],
            proof: { violation, clean, failure_shape: [FAILURE_TEXT] },
          },
          criteria: ["SI7"],
        },
      },
      {
        ...patches,
        "package.json": JSON.stringify({
          private: true,
          scripts: { [TASK]: `node ${SCRIPT}` },
        }),
        [SCRIPT]: program,
      }
    );
    try {
      const run = (subcommand: string, ...flags: readonly string[]) =>
        boundedSpawnSync({
          label: `task proof ${subcommand}`,
          command: process.execPath,
          args: [CLI, "--no-update-check", "controls", subcommand, ...flags],
          cwd: fixture.repoPath,
          env: operatorEnv(),
          baseMs: 30_000,
        });

      const planned = run("proof-check");
      expect(planned.status, planned.stderr).toBe(0);
      expect(JSON.parse(planned.stdout).parts).toEqual([
        expect.objectContaining({ gate: GATE, result: "ready" }),
      ]);

      const attested = run("attest", "--json");
      const entries = JSON.parse(attested.stdout).entries;
      expect(entries).toEqual([
        expect.objectContaining({ gate: GATE, outcome: "passed" }),
      ]);
      expect(attested.status, attested.stderr).toBe(0);
    } finally {
      fixture.cleanup();
    }
  });
});
