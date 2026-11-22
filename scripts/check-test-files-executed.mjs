#!/usr/bin/env node
/**
 * Proves every NAMED test file ran and passed, from a vitest JSON report.
 *
 * The file-level sibling of `scripts/check-test-case-executed.mjs`, written for
 * the nightly slow-test lane (CodySwannGT/lisa#4896). That lane runs files the
 * rest of the suite excludes, and an excluded, moved or renamed file is not a
 * failure to Vitest: it is simply absent, and an absent file reports green. So
 * a green run proves nothing until each file is shown to be in the report,
 * with a passing status and at least one passing case.
 *
 * Vitest's JSON report names each file by its ABSOLUTE path in
 * `testResults[].name`; this script compares repository-relative paths against
 * `--root` (default: the working directory).
 *
 * ## Usage
 *
 *   node scripts/check-test-files-executed.mjs --report <report.json> \
 *     [--root <dir>] (--list <module.mjs>#<export> | --file <path> ...)
 *
 * `--list` reads the file list from a module's named export, so the nightly
 * lane can check the same list `vitest.config.local.ts` excludes without
 * restating it.
 *
 * Exit 0 only when every file ran and passed; otherwise exit 1 naming each
 * file and why.
 * @module scripts/check-test-files-executed
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/**
 * Parse the arguments.
 * @param {readonly string[]} argv - Arguments after the script path
 * @returns {{ report: string, root: string, files: string[], list?: string }} Invocation
 */
export function parseArguments(argv) {
  const files = [];
  let report;
  let root = process.cwd();
  let list;
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!["--report", "--root", "--file", "--list"].includes(String(flag)))
      throw new Error(`Unknown argument: ${String(flag)}`);
    if (value === undefined || value.startsWith("--"))
      throw new Error(`${flag} requires a value`);
    if (flag === "--report") report = value;
    else if (flag === "--root") root = value;
    else if (flag === "--list") list = value;
    else files.push(value);
  }
  if (report === undefined) throw new Error("--report is required");
  if (files.length === 0 && list === undefined)
    throw new Error("Name the files with --file or --list");
  return { report, root, files, ...(list === undefined ? {} : { list }) };
}

/**
 * Each named file that did not run and pass, with the reason.
 * @param {unknown} report - A parsed vitest JSON report
 * @param {readonly string[]} files - Repository-relative paths that must have run
 * @param {string} root - Directory the paths are relative to
 * @returns {string[]} Failures, empty when every file ran and passed
 */
export function unexecutedFiles(report, files, root) {
  const results = Array.isArray(report?.testResults) ? report.testResults : [];
  const byFile = new Map(
    results.map(result => [
      path.relative(root, String(result?.name)).split(path.sep).join("/"),
      result,
    ])
  );
  return files.flatMap(file => {
    const result = byFile.get(file);
    if (result === undefined)
      return [
        `${file} is ABSENT from the report — it was excluded, moved, or renamed, so nothing ran it.`,
      ];
    if (result.status !== "passed")
      return [`${file} did not pass: the runner reported "${result.status}".`];
    const cases = Array.isArray(result.assertionResults)
      ? result.assertionResults
      : [];
    if (!cases.some(entry => entry?.status === "passed"))
      return [
        `${file} passed with no passing case — every case was skipped, so it proves nothing.`,
      ];
    return [];
  });
}

/**
 * Resolve `--list <module>#<export>` to the file list it names.
 * @param {string} spec - Module path, `#`, export name
 * @param {string} root - Directory a relative module path resolves against
 * @returns {Promise<string[]>} Repository-relative paths
 */
async function listFrom(spec, root) {
  const [modulePath = "", exportName = ""] = spec.split("#");
  const loaded = await import(
    pathToFileURL(path.resolve(root, modulePath)).href
  );
  const value = loaded[exportName];
  if (!Array.isArray(value) || value.length === 0)
    throw new Error(`${spec} is not a non-empty list of files`);
  return value.map(String);
}

/**
 * CLI entry.
 * @param {readonly string[]} argv - Arguments after the script path
 * @returns {Promise<string[]>} Failures, empty when every file ran and passed
 */
export async function checkTestFilesExecuted(argv) {
  const options = parseArguments(argv);
  const files = [
    ...options.files,
    ...(options.list === undefined
      ? []
      : await listFrom(options.list, options.root)),
  ];
  const report = JSON.parse(readFileSync(options.report, "utf8"));
  const failures = unexecutedFiles(report, files, options.root);
  for (const file of files)
    if (!failures.some(failure => failure.startsWith(`${file} `)))
      process.stdout.write(`RAN  ${file}\n`);
  return failures;
}

if (invokedAsScript(import.meta.url)) {
  try {
    const failures = await checkTestFilesExecuted(process.argv.slice(2));
    for (const failure of failures)
      process.stdout.write(
        `::error title=Nightly test file did not run and pass::${failure}\n`
      );
    process.exit(failures.length === 0 ? 0 : 1);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exit(1);
  }
}
