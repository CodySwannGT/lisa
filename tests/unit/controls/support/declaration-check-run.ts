/**
 * Running `lisa controls declaration-check` in-process against fixture
 * repositories that hold both a gates declaration and an audit report, for
 * the suites that check what it accepts and what it refuses
 * (CodySwannGT/lisa#4984).
 * @module tests/unit/controls/support/declaration-check-run
 */
import { runDeclarationCheck } from "../../../../src/controls/commands/declaration-check.js";
import {
  buildControlAuditFixture,
  type ControlAuditFixtureFiles,
} from "../../../helpers/control-audit-fixtures.js";
import { writeAuditReport } from "../../../helpers/control-audit-report.js";
import {
  configFile,
  type DeclaredFixtureName,
  type GatesBlock,
} from "../../../helpers/control-register.js";
import { NOW } from "../audit-report-facts.js";
import { keep, type Run } from "./report-check-run.js";

/** The parts the audit names in F-mixed. */
export const MIXED_PARTS = [".", "api", "web"] as const;

/**
 * Build a fixture holding a declaration and, when given, an audit report.
 * @param name - Which fixture
 * @param gates - The `gates` block to commit
 * @param report - The report to write; none when left out
 * @param extraFiles - Further files to commit
 * @returns The repository root
 */
export function configured(
  name: DeclaredFixtureName,
  gates: GatesBlock,
  report?: unknown,
  extraFiles: ControlAuditFixtureFiles = {}
): string {
  const { repoPath } = keep(
    buildControlAuditFixture(name, {
      extraFiles: { ...extraFiles, ".lisa.config.json": configFile(gates) },
    })
  );
  if (report !== undefined) writeAuditReport(repoPath, report);
  return repoPath;
}

/**
 * Run the command in-process and capture what it prints.
 * @param target - The path argument, as an operator would type it
 * @returns Exit code and printed lines
 */
export async function declarationCheck(target: string): Promise<Run> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runDeclarationCheck(target, {
    now: NOW,
    stdout: line => {
      stdout.push(line);
    },
    stderr: line => {
      stderr.push(line);
    },
  });
  return { code, stdout, stderr };
}
