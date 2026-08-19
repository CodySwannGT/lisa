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
  skipJobCallers,
} from "../../../src/cli/doctor-skip-jobs-migration.js";

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
      expect(check.detail).toContain(".lisa.config.json");
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
    it("reports playwright_e2e as partial and names what keeps running", async () => {
      await writeCaller(caller("playwright_e2e"));
      const [found] = await skipJobCallers(project);
      expect(found?.tokens[0]?.status).toBe("partial");
      expect(found?.tokens[0]?.ungated).toEqual([
        "playwright_e2e_setup",
        "playwright_e2e",
      ]);
    });

    it("reports zap_baseline as having no gate and emits no declaration", async () => {
      await writeCaller(caller("zap_baseline"));
      const [found] = await skipJobCallers(project);
      expect(found?.tokens[0]?.status).toBe("unmappable");
      expect(found?.tokens[0]?.gate).toBeNull();
      expect(found?.tokens[0]?.declaration).toBeNull();
      const check = await checkSkipJobsMigration(project);
      expect(check.detail).toContain("no gate equivalent yet");
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
      expect(files.toSorted((a, b) => a.localeCompare(b))).toEqual([
        ".github/workflows/ci.yml",
        ".github/workflows/nightly.yml",
      ]);
    });
  });
});
