/**
 * The built CLI imports a signed pair and checks the receipt before relying on it.
 * @module
 */
import { generateKeyPairSync } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  bindChecks,
  hostHookFiles,
} from "../../src/controls/checks-binding.js";
import { EVIDENCE_PATH } from "../../src/controls/evidence.js";
import type { HostProofInput } from "../../src/controls/host-proof-input.js";
import { HOST_PROOF_RECEIPTS_PATH } from "../../src/controls/host-proof-receipt.js";
import { signHostProof } from "../../src/controls/host-proof-signature.js";
import { HOST_PROOF_TRUST_FILE } from "../../src/controls/host-proof-trust.js";
import { CONTROL_REGISTER_PATH } from "../../src/controls/register-types.js";
import { isJsonObject } from "../../src/sync/json-path.js";
import {
  controlAuditGitEnv,
  runControlAuditGit,
} from "../helpers/control-audit-fixtures.js";
import {
  buildDeclaredFixture,
  F_NONE_GATES,
} from "../helpers/control-register.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import { withExecutor } from "../unit/controls/support/executor-fixtures.js";

useIoLatencyBudget();

const CLI = path.resolve("dist/index.js");
const ORIGIN = "https://gitlab.example.test/team/demo.git";
const PIPELINE = ".gitlab-ci.yml";
const ENTRY = "code-style@.";
const TRUST = "trust.json";
const KEY = "attestor.pem";
const INPUT = "proof.json";

describe("published controls attest with an external trust file", () => {
  it("writes and verifies a receipt for the bound pair and distrusts it after the pipeline changes", async () => {
    const gate = F_NONE_GATES["code-style"];
    if (!isJsonObject(gate))
      throw new TypeError("Expected a declared fixture gate.");
    const gates = {
      ...F_NONE_GATES,
      "code-style": { ...gate, criteria: ["SI7", "SI2"] },
    };
    const fixture = buildDeclaredFixture("F-none", withExecutor(gates));
    const outside = mkdtempSync(path.join(tmpdir(), "lisa-host-proof-"));
    try {
      const root = fixture.repoPath;
      const pipeline = path.join(root, PIPELINE);
      writeFileSync(pipeline, "stages: [test]\n");
      runControlAuditGit(root, ["remote", "add", "origin", ORIGIN]);
      const adjudicator = generateKeyPairSync("ed25519");
      const attestor = generateKeyPairSync("ed25519");
      const external = (file: string): string => path.join(outside, file);
      writeFileSync(
        external(TRUST),
        JSON.stringify({
          schema_version: 1,
          repository: ORIGIN,
          environment: "review",
          adjudicator: {
            id: "reviewer-fixture",
            public_key: adjudicator.publicKey.export({
              type: "spki",
              format: "pem",
            }),
          },
          attestor: {
            id: "attestor-fixture",
            public_key: attestor.publicKey.export({
              type: "spki",
              format: "pem",
            }),
          },
        })
      );
      writeFileSync(
        external(KEY),
        attestor.privateKey.export({ type: "pkcs8", format: "pem" }),
        { mode: 0o600 }
      );
      const checks = await bindChecks({
        repository: root,
        also: [PIPELINE, ...(await hostHookFiles(root))],
      });
      const completed = new Date(Date.now() - 60_000).toISOString();
      const common = { started_at: completed, completed_at: completed };
      const source: HostProofInput = {
        schema_version: 1,
        subject: {
          repository: ORIGIN,
          environment: "review",
          work_item: "team/demo#1",
          entry_id: ENTRY,
          platform: "gitlab",
          executor_path: PIPELINE,
          checks_digest: checks.digest,
        },
        producer: "pipeline-fixture",
        adjudicator: "reviewer-fixture",
        clean: {
          ...common,
          run_id: "1",
          run_url: "https://gitlab.example.test/team/demo/-/pipelines/1",
          commit: "a".repeat(40),
          artifact_sha256: "a".repeat(64),
          exit_status: 0,
          output_excerpt: "Clean check passed",
        },
        violation: {
          ...common,
          run_id: "2",
          run_url: "https://gitlab.example.test/team/demo/-/pipelines/2",
          commit: "b".repeat(40),
          artifact_sha256: "b".repeat(64),
          exit_status: 1,
          output_excerpt: "Found 1 error",
        },
      };
      const writeProof = (value: HostProofInput): void => {
        writeFileSync(
          external(INPUT),
          JSON.stringify(
            signHostProof("host-proof-import", value, adjudicator.privateKey)
          )
        );
      };
      const run = (...args: readonly string[]) =>
        boundedSpawnSync({
          label: "host proof attest CLI",
          command: process.execPath,
          args: [CLI, "--no-update-check", "controls", ...args],
          cwd: root,
          env: {
            ...controlAuditGitEnv(),
            LISA_SKIP_UPDATE_CHECK: "1",
            [HOST_PROOF_TRUST_FILE]: external(TRUST),
          },
          baseMs: 30_000,
        });
      const status = (id = ENTRY): unknown => {
        const register = JSON.parse(
          readFileSync(path.join(root, CONTROL_REGISTER_PATH), "utf8")
        ) as {
          entries: Array<{ id: string; status?: string }>;
        };
        return register.entries.find(entry => entry.id === id)?.status;
      };
      const importProof = () =>
        run(
          "attest",
          "--import-host-proof",
          external(INPUT),
          "--host-proof-signing-key",
          external(KEY),
          "--json"
        );
      const expired = "2000-01-01T00:00:00.000Z";
      for (const [variant, diagnostic] of [
        [
          {
            ...source,
            subject: { ...source.subject, checks_digest: "c".repeat(64) },
          },
          "does not match the current definitions of the check",
        ],
        [
          {
            ...source,
            violation: {
              ...source.violation,
              output_excerpt: "The fixture stopped for another reason",
            },
          },
          "does not contain the declared failure text",
        ],
        [
          {
            ...source,
            clean: {
              ...source.clean,
              started_at: expired,
              completed_at: expired,
            },
          },
          "outside its evidence lifetime",
        ],
      ] as const) {
        writeProof(variant);
        const refused = importProof();
        expect(refused.status).toBe(2);
        expect(refused.stderr).toContain(diagnostic);
        expect(existsSync(path.join(root, EVIDENCE_PATH))).toBe(false);
        expect(existsSync(path.join(root, HOST_PROOF_RECEIPTS_PATH))).toBe(
          false
        );
      }
      writeProof(source);
      const imported = importProof();
      expect(imported.status, imported.stderr).toBe(0);
      expect(JSON.parse(imported.stdout)).toMatchObject({
        entry: ENTRY,
        receipt: HOST_PROOF_RECEIPTS_PATH,
        recorded: true,
      });
      expect(status()).toBeUndefined();
      expect(status("coverage-adequacy@.")).toBe("unproved");
      const evidence = JSON.parse(
        readFileSync(path.join(root, EVIDENCE_PATH), "utf8")
      );
      expect(evidence.records).toEqual(
        expect.arrayContaining(
          ["SI2", "SI7"].flatMap(criterion =>
            ["clean", "violation"].map(half =>
              expect.objectContaining({
                entry_id: ENTRY,
                criterion,
                half,
                result: "held",
              })
            )
          )
        )
      );
      const checked = run("attest", "--check");
      expect(checked.status, checked.stderr).toBe(0);
      const receiptFile = path.join(root, HOST_PROOF_RECEIPTS_PATH);
      const receipt = readFileSync(receiptFile);
      rmSync(receiptFile);
      for (const command of ["register", "attest"]) {
        const missing = run(command, "--check");
        expect(missing.status).toBe(1);
        expect(missing.stderr).toContain(
          "No signed host proof receipt is on record."
        );
      }
      const [stored] = JSON.parse(receipt.toString("utf8")) as Array<{
        body: object;
        purpose: string;
        signature: string;
      }>;
      writeFileSync(
        receiptFile,
        JSON.stringify([{ ...stored, signature: "AA" }])
      );
      const tampered = run("attest", "--check");
      expect(tampered.status).toBe(1);
      expect(tampered.stderr).toContain(
        "The receipt signature could not be verified"
      );
      writeFileSync(receiptFile, receipt);
      writeFileSync(pipeline, "stages: [test, publish]\n");
      const drifted = run("register");
      expect(drifted.status).toBe(0);
      expect(drifted.stdout).toContain(
        "The check definitions changed after the host proof was recorded."
      );
      expect(status()).toBe("unproved");
    } finally {
      fixture.cleanup();
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
