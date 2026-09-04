/**
 * Tests for the doctor check that reports a caller's `skip_jobs` migration.
 *
 * The load-bearing assertion is the one that says doctor left `ci.yml` alone.
 * `lisa apply` runs on postinstall, and a repair that edits a caller workflow
 * and gets it wrong is silent — measured in this repository on 2026-08-18,
 * where an auto-migration passed six fixture tests and would have broken nine
 * of a real consumer's twelve suites, because the same author wrote the
 * fixtures and the code. So this check establishes what is true and names the
 * edit; the edit is made by something that can read the surrounding code.
 * @module tests/unit/cli/doctor-skip-jobs-migration
 */

import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  checkSkipJobsMigration,
  describeToken,
  skipJobCallers,
} from "../../../src/cli/doctor-skip-jobs-migration.js";

/**
 * The clause doctor prints about ONE token, isolated from the summary.
 *
 * Asserting on the whole detail cannot tell the two apart: the summary once
 * said "then delete the token" for every token at once, so a test looking for
 * "delete" anywhere in the output passed while the inert token's own line
 * still said nothing of the sort. These tests are about what the operator is
 * told to do about a specific token, so they read that token's clause.
 * @param detail - The doctor check's detail string
 * @param token - The token to isolate
 * @returns That token's clause, or "" when it is absent
 */
function clauseFor(detail: string, token: string): string {
  const start = detail.indexOf(`${token} → `);
  if (start === -1) return "";
  const rest = detail.slice(start);
  const end = rest.indexOf("; ");
  return end === -1 ? rest : rest.slice(0, end);
}

/** The file the declarable remediation sends the operator to. */
const CONFIG_FILE = ".lisa.config.json";

let project: string;

/**
 * Write a caller workflow into the temporary project.
 * @param body - Workflow file contents
 * @param name - File name under `.github/workflows`
 * @returns Absolute path to the written file
 */
async function writeCaller(body: string, name = "ci.yml"): Promise<string> {
  const dir = path.join(project, ".github", "workflows");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  await writeFile(file, body, "utf8");
  return file;
}

/**
 * A caller passing the given tokens, in the shape consumers actually ship.
 * @param tokens - The raw `skip_jobs` value
 * @param moment - The `moment` input, omitted when the caller declares none
 * @returns The workflow file contents
 */
const caller = (tokens: string, moment?: string): string =>
  [
    "name: CI",
    "on: [pull_request]",
    "jobs:",
    "  quality:",
    "    uses: CodySwannGT/lisa/.github/workflows/quality.yml@main",
    "    with:",
    ...(moment === undefined ? [] : [`      moment: '${moment}'`]),
    `      skip_jobs: '${tokens}'`,
    "      node_version: '22'",
    "",
  ].join("\n");

beforeEach(async () => {
  project = await mkdtemp(path.join(tmpdir(), "lisa-skip-jobs-"));
});

describe("doctor skip_jobs migration", () => {
  describe("it reports and does not edit", () => {
    it("leaves the caller workflow byte-identical", async () => {
      const body = caller("lint,playwright_e2e");
      const file = await writeCaller(body);
      await checkSkipJobsMigration(project);
      expect(await readFile(file, "utf8")).toBe(body);
    });

    it("names the exact edit to make instead of making it", async () => {
      await writeCaller(caller("lint"));
      const check = await checkSkipJobsMigration(project);
      expect(check.detail).toContain('"code-style"');
      expect(check.detail).toContain('"pull-request": "off"');
      expect(check.detail).toContain(CONFIG_FILE);
    });
  });

  describe("it resolves every token to its gate", () => {
    it("resolves tokens whose gate the name does not predict", async () => {
      await writeCaller(
        caller("typecheck,npm_security_scan,sg_scan,work_item_traceability")
      );
      const [found] = await skipJobCallers(project);
      expect(
        Object.fromEntries(
          (found?.tokens ?? []).map(entry => [entry.token, entry.gate])
        )
      ).toEqual({
        typecheck: "type-correctness",
        npm_security_scan: "dependency-vulnerability",
        sg_scan: "structural-rules",
        work_item_traceability: "traceability",
      });
    });

    it("uses the moment the caller declared, not a hardcoded one", async () => {
      await writeCaller(caller("lint", "push"));
      const [found] = await skipJobCallers(project);
      expect(found?.moment).toBe("push");
      expect(found?.tokens[0]?.declaration).toContain('"push": "off"');
    });

    it("falls back to the workflow's own default moment", async () => {
      await writeCaller(caller("lint"));
      const [found] = await skipJobCallers(project);
      expect(found?.moment).toBe("pull-request");
    });

    it("refuses a moment the gate does not permit", async () => {
      // `traceability` is declared at push and pull-request only. A caller
      // running the pre-deploy set has no legal declaration to migrate to, and
      // emitting one anyway would be refused by `lisa-gates.mjs validate`
      // after the operator had already deleted the token.
      await writeCaller(caller("work_item_traceability", "pre-deploy:staging"));
      const [found] = await skipJobCallers(project);
      expect(found?.tokens[0]?.status).toBe("moment-illegal");
      expect(found?.tokens[0]?.declaration).toBeNull();
    });
  });

  describe("an unmappable token is named, never guessed", () => {
    it("reports playwright_e2e as suppressing nothing, now that its jobs left quality.yml", async () => {
      // Was `partial`: the token named three jobs, only the aggregator had a
      // façade, and reporting a clean swap would have left an operator
      // watching the shards keep running. All three then moved to
      // `playwright-e2e.yml`, which takes no `skip_jobs` — so passing the
      // token to `quality.yml` suppresses nothing at all, and the caller under
      // test here is a `quality.yml` caller.
      await writeCaller(caller("playwright_e2e"));
      const [found] = await skipJobCallers(project);
      expect(found?.tokens[0]?.status).toBe("inert");
      expect(found?.tokens[0]?.gate).toBeNull();
      expect(found?.tokens[0]?.declaration).toBeNull();
      expect(found?.tokens[0]?.ungated).toEqual([]);
      const check = await checkSkipJobsMigration(project);
      expect(check.detail).toContain("it suppresses nothing");
    });

    it("reports zap_baseline as RETIRED and tells the operator to delete it", async () => {
      // Was `unmappable`: a real pull-request job no gate governed, so no
      // declaration could replace the token. CodySwannGT/lisa#2938 deleted the
      // job — it only ran when `zap_target_url` was set, which no shipped
      // template sets, and `fail_action: false` meant it could not fail even
      // then. DAST moved to the deploy moments, where #2832 shipped a runner.
      //
      // `retired` rather than `unknown` is the load-bearing half: the default
      // branch tells the reader to check for a space after a comma, which is
      // wrong advice for a token they spelled correctly and that this workflow
      // really did honour until now.
      await writeCaller(caller("zap_baseline"));
      const [found] = await skipJobCallers(project);
      expect(found?.tokens[0]?.status).toBe("retired");
      expect(found?.tokens[0]?.gate).toBeNull();
      expect(found?.tokens[0]?.declaration).toBeNull();
      const check = await checkSkipJobsMigration(project);
      expect(check.detail).toContain("RETIRED");
      expect(check.detail).toContain("delete it from skip_jobs");
    });

    it("reports a whitespace-damaged token as skipping nothing", async () => {
      // `'lint, lint_slow'` yields the token `" lint_slow"`, which matches no
      // job, so the job RUNS. Reporting it as unknown is the only honest
      // answer; guessing `code-style-slow` would migrate a skip that was never
      // in effect.
      await writeCaller(caller("lint, lint_slow"));
      const [found] = await skipJobCallers(project);
      const damaged = (found?.tokens ?? []).find(
        entry => entry.token === " lint_slow"
      );
      expect(damaged?.status).toBe("unknown");
      expect(damaged?.gate).toBeNull();
    });
  });

  describe("it stays quiet where there is nothing to migrate", () => {
    it("passes a project with no workflows directory", async () => {
      const check = await checkSkipJobsMigration(project);
      expect(check.status).toBe("ok");
    });

    it("passes a caller that passes no skip_jobs", async () => {
      await writeCaller(
        [
          "name: CI",
          "on: [pull_request]",
          "jobs:",
          "  quality:",
          "    uses: CodySwannGT/lisa/.github/workflows/quality.yml@main",
          "    with:",
          "      node_version: '22'",
          "",
        ].join("\n")
      );
      const check = await checkSkipJobsMigration(project);
      expect(check.status).toBe("ok");
      expect(await skipJobCallers(project)).toEqual([]);
    });

    it("passes a caller whose skip_jobs is empty", async () => {
      await writeCaller(caller(""));
      const check = await checkSkipJobsMigration(project);
      expect(check.status).toBe("ok");
    });

    it("warns rather than fails, because skip_jobs still works", async () => {
      await writeCaller(caller("lint"));
      const check = await checkSkipJobsMigration(project);
      expect(check.status).toBe("warn");
    });
  });

  describe("it reads every caller, not just ci.yml", () => {
    it("reports tokens from a second workflow file", async () => {
      await writeCaller(caller("lint"), "ci.yml");
      await writeCaller(caller("dead_code"), "nightly.yml");
      const files = (await skipJobCallers(project)).map(entry => entry.file);
      expect(files.slice().sort((a, b) => a.localeCompare(b))).toEqual([
        ".github/workflows/ci.yml",
        ".github/workflows/nightly.yml",
      ]);
    });
  });

  describe("the remediation only recommends migrations that are possible", () => {
    // CodySwannGT/lisa#3101. `test:e2e` resolves to `gates: []` — the browser
    // suite moved to `playwright-e2e.yml` and the `quality.yml` job went with
    // it. Doctor reported it under the same "declare the gate" instruction as
    // every other token, so an operator who did as they were told wrote a
    // declaration for a gate id that does not exist, and ended up further from
    // a working configuration than the token had left them.
    it("tells the operator to delete an inert token instead of declaring a gate for it", async () => {
      await writeCaller(caller("test:e2e"));
      const check = await checkSkipJobsMigration(project);
      const clause = clauseFor(check.detail ?? "", "test:e2e");
      expect(clause).toContain("no gate governs it");
      expect(clause).toContain("delete it from skip_jobs");
      expect(clause).not.toContain("→ declare");
    });

    it("does not tell the operator to write a declaration when no token has one", async () => {
      // The summary was a blanket claim, and both halves of it were false for
      // this caller: nothing here reports green having run nothing, and there
      // is no gate id to put in .lisa.config.json.
      await writeCaller(caller("test:e2e,playwright_e2e,github_issue"));
      const check = await checkSkipJobsMigration(project);
      expect(check.detail).not.toContain(CONFIG_FILE);
      expect(check.detail).not.toContain("reports green having run nothing");
      expect(check.detail).toContain(
        "3 suppress nothing and no gate governs them"
      );
      expect(check.detail).toContain("delete those tokens from skip_jobs");
    });

    it("still tells the operator to declare the gate for a token that maps to one", async () => {
      // The control. `lint` resolves to `code-style`, the declaration exists,
      // and the migration advice must survive the fix unchanged.
      await writeCaller(caller("lint"));
      const check = await checkSkipJobsMigration(project);
      expect(clauseFor(check.detail ?? "", "lint")).toBe(
        'lint → declare "code-style": { "pull-request": "off" } and delete the token'
      );
      expect(check.detail).toContain(CONFIG_FILE);
      expect(check.detail).toContain("reports green having run nothing");
    });

    it("counts the two classes separately when one caller passes both", async () => {
      // The aggregate has to agree with the per-token lines. One token here
      // has a gate and one has none, so the summary says both things about the
      // right number of tokens rather than one thing about all of them.
      await writeCaller(caller("lint,test:e2e"));
      const check = await checkSkipJobsMigration(project);
      expect(check.detail).toContain("1 of those has a gate to migrate to");
      expect(check.detail).toContain(
        "1 suppresses nothing and no gate governs it"
      );
    });

    it("names the job that starts running if a gateless-but-honoured token is deleted", async () => {
      // No shipped token resolves this way today, which is exactly why it is
      // asserted here rather than through a fixture: `inert` is a property of
      // the current `quality.yml` and `gates: []` is a property of the token
      // table, so a token can gain a job without gaining a gate. At that point
      // deletion stops being safe and the operator has to be told why.
      expect(
        describeToken({
          token: "hypothetical",
          status: "unmappable",
          gate: null,
          jobs: ["hypothetical_job"],
          ungated: ["hypothetical_job"],
          declaration: null,
        })
      ).toContain("deleting it lets that job run");
    });
  });
});
