/**
 * @file rails-prepush-hook.test.ts
 * @description Shipped Rails hook attribution, refusal status and safe bootstrap controls.
 * @module tests/history-secrets
 */
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
useIoLatencyBudget();
const root = resolve(import.meta.dirname, "../..");
const refusal =
  "Rails pre-push refused (exit 7). Retry the same git push command and inspect rails-prepush output for scanner and work-item details.";
describe("shipped Rails pre-push command", () => {
  it.each(["healthy", "returned", "throw", "missing", "scanner"])(
    "executes the actual %s boundary control",
    selected => {
      const result = boundedSpawnSync({
        label: `shipped Rails hook ${selected}`,
        command: process.execPath,
        args: [
          join(
            root,
            "tests/fixtures/git-history-secrets/rails-prepush-hook.mjs"
          ),
          "--case",
          selected,
        ],
        cwd: root,
        baseMs: 30000,
      });
      expect(result.status, result.stderr).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.redaction).toBe(true);
      expect(report.commandCount).toBe(1);
      expect(report.name).toBe("rails-prepush");
      expect(report.shell.status).toBe(
        selected === "healthy" ? 0 : selected === "returned" ? 7 : 1
      );
      if (selected !== "missing")
        expect(report.stdinAndRemotePreserved).toBe(true);
      if (selected === "healthy")
        expect(report.shell.stderr).not.toContain("refused");
      if (selected === "returned")
        expect(report.shell.stderr).toContain(refusal);
      if (selected === "throw" || selected === "missing") {
        expect(report.shell.stderr).toContain(
          "raw bootstrap errors are withheld"
        );
        expect(report.shell.stderr).not.toContain("Error:");
      }
      if (selected === "scanner") {
        expect(report.shell.stderr).toMatch(/[Ss]canner|[Gg]itleaks/u);
        expect(report.shell.stderr).toContain(
          "Rails pre-push refused (exit 1)."
        );
      }
    }
  );
});
