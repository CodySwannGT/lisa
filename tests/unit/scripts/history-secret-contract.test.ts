/**
 * @file history-secret-contract.test.ts
 * @description Malformed inputs and missing tooling must never become scanner success.
 * @module tests/history-secrets
 */
import { mkdtempSync, cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolvePackageCaller,
  verifyAppliedRoutes,
} from "../../fixtures/git-history-secrets/package.mjs";
import { resolveReleasePin } from "../../../src/core/lisa-release-pin.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";
useIoLatencyBudget();
const root = resolve(import.meta.dirname, "../../..");
const CONFIG = ".lisa.config.json";
import {
  parsePush,
  eventPairs,
} from "../../../all/copy-overwrite/scripts/lib/history-secret-git.mjs";
import { resolveMoment } from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
const oid = "a".repeat(40);
const zero = "0".repeat(40);
describe("required introduced history contract", () => {
  it("accepts all actual records and legitimate Unicode/plus refs", () => {
    expect(
      parsePush(
        `refs/heads/café+one ${oid} refs/heads/café+one ${zero}\nrefs/heads/two ${oid} refs/heads/two ${oid}\n`,
        40
      )
    ).toHaveLength(2);
    expect(parsePush("", 40)).toEqual([]);
    expect(parsePush(`(delete) ${zero} refs/heads/one ${oid}\n`, 40)).toEqual([
      { before: oid, after: zero },
    ]);
  });
  it("rejects every malformed record without echoing its content", () => {
    for (const input of [
      "private payload\n",
      `refs/heads/one ${oid} refs/heads/one short\n`,
      `refs/heads/one ${oid} refs/heads/one ${zero}\n\n`,
      `refs/heads/../one ${oid} refs/heads/one ${zero}\n`,
    ])
      expect(() => parsePush(input, 40)).toThrow(/Malformed/u);
  });
  it("uses actual event IDs and deletion semantics", () => {
    expect(
      eventPairs(
        { pull_request: { base: { sha: zero }, head: { sha: oid } } },
        "pull_request",
        40
      )
    ).toEqual([{ before: zero, after: oid }]);
    expect(
      eventPairs({ before: oid, after: zero, deleted: true }, "push", 40)
    ).toEqual([{ before: oid, after: zero }]);
    expect(() => eventPairs({}, "workflow_dispatch", 40)).toThrow(/actual/u);
    expect(() =>
      eventPairs(
        { pull_request: { base: { sha: zero }, head: { sha: oid } } },
        "pull_request_target",
        40
      )
    ).toThrow(/Unsupported CI event/u);
  });
  it("refuses absent, malformed and inconsistent supplied deletion IDs", () => {
    for (const after of [undefined, "private payload", oid])
      expect(() =>
        eventPairs({ before: oid, after, deleted: true }, "push", 40)
      ).toThrow(/event/u);
    expect(() =>
      eventPairs({ before: "bad", after: zero, deleted: true }, "push", 40)
    ).toThrow(/Malformed/u);
    expect(eventPairs({ before: oid, after: oid }, "push", 40)).toEqual([
      { before: oid, after: oid },
    ]);
  });
  it("resolves only the new manifest-free owned facade and preserves unrelated choices", () => {
    const gates = {
      "introduced-history-credential-leakage": {
        push: "required",
        "pull-request": "required",
      },
      "credential-leakage": { "pull-request": "off" },
    };
    for (const moment of ["push", "pull-request"])
      expect(
        resolveMoment({ gates, moment, scripts: null }).find(
          (entry: { id: string }) =>
            entry.id === "introduced-history-credential-leakage"
        )
      ).toMatchObject({ level: "required", mode: "builtin", command: null });
    expect(
      resolveMoment({
        gates,
        moment: "pull-request",
        scripts: null,
        includeOff: true,
      }).find((entry: { id: string }) => entry.id === "credential-leakage")
    ).toMatchObject({ level: "off" });
  });
});

describe("immutable package history caller witness", () => {
  it("uses the archive resolver and refuses malformed declared identities", () => {
    const installed = mkdtempSync(
      join(tmpdir(), "history-installed-identity-")
    );
    const sha = "a".repeat(40);
    const command = (executable: string, args: string[], cwd: string) =>
      boundedSpawnSync({
        label: "actual installed release identity",
        command: executable,
        args,
        cwd,
        baseMs: 30000,
      });
    const requireFact = (fact: boolean, message: string) => {
      if (!fact) throw new Error(message);
    };
    try {
      for (const file of [
        "core/lisa-release-pin.js",
        "core/reusable-workflow-pin.js",
        "cli/version.js",
      ]) {
        const destination = join(installed, "dist", file);
        mkdirSync(join(destination, ".."), { recursive: true });
        cpSync(join(root, "dist", file), destination);
      }
      const writeIdentity = (identity: Record<string, unknown>) =>
        writeFileSync(
          join(installed, "package.json"),
          JSON.stringify({ type: "module", version: "1.2.3", ...identity })
        );
      writeIdentity({ lisaReleaseCommit: sha, lisaReleaseTag: "v1.2.3" });
      expect(resolvePackageCaller(installed, command, requireFact)).toEqual({
        ref: sha,
        version: "1.2.3",
        qualification: "release-pin",
      });
      writeIdentity({});
      expect(resolvePackageCaller(installed, command, requireFact)).toEqual({
        ref: "main",
        version: "1.2.3",
        qualification: "unstamped-candidate",
      });
      for (const identity of [
        { lisaReleaseCommit: "bad", lisaReleaseTag: "v1.2.3" },
        { lisaReleaseCommit: sha, lisaReleaseTag: "v9.9.9" },
        { lisaReleaseTag: "v1.2.3" },
        { lisaReleaseCommit: 42, lisaReleaseTag: false },
        { lisaReleaseCommit: "", lisaReleaseTag: "" },
        { lisaReleaseCommit: " " },
        { lisaReleaseTag: " " },
        { lisaReleaseCommit: false },
        { lisaReleaseTag: 42 },
      ]) {
        writeIdentity(identity);
        expect(() =>
          resolvePackageCaller(installed, command, requireFact)
        ).toThrow(/cannot be resolved/u);
      }
    } finally {
      rmSync(installed, { recursive: true, force: true });
    }
  });
  it("accepts only the caller resolved from the installed release identity", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "history-release-caller-"));
    const sha = "a".repeat(40);
    const pin = await resolveReleasePin(cwd, {
      readVersion: () => "1.2.3",
      readStampedCommit: () => sha,
      readStampedTag: () => "v1.2.3",
      resolveTagCommit: async () => null,
    });
    const requireFact = (fact: boolean, message: string) => {
      if (!fact) throw new Error(message);
    };
    try {
      mkdirSync(join(cwd, ".github/workflows"), { recursive: true });
      writeFileSync(
        join(cwd, CONFIG),
        JSON.stringify({
          gates: {
            "introduced-history-credential-leakage": {
              push: "required",
              "pull-request": {
                level: "required",
                caller_chain: ["Quality Checks", "History Secrets"],
              },
            },
          },
        })
      );
      writeFileSync(
        join(cwd, "lefthook.yml"),
        `pre-push:
  commands:
    work-item:
      use_stdin: true
      run: 'await import("./scripts/lisa-rails-prepush.mjs"); await main(process.argv.slice(1))'
`
      );
      const writeCaller = (ref: string) =>
        writeFileSync(
          join(cwd, ".github/workflows/ci.yml"),
          `jobs:
  quality:
    name: Quality Checks
    uses: CodySwannGT/lisa/.github/workflows/quality-rails.yml@${ref}
    with:
      expected_workflow_contract_major: "1"
`
        );
      writeCaller(pin.sha);
      expect(
        verifyAppliedRoutes(cwd, requireFact, { ref: pin.sha })
      ).toMatchObject({
        uses: `CodySwannGT/lisa/.github/workflows/quality-rails.yml@${pin.sha}`,
      });
      for (const ref of ["main", "b".repeat(40)]) {
        writeCaller(ref);
        expect(() =>
          verifyAppliedRoutes(cwd, requireFact, { ref: pin.sha })
        ).toThrow(/disagree/u);
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
