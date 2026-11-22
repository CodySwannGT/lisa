#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Run the project's installed compiler without incidental declaration checks. */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import ts from "typescript";

const PURE_TYPECHECK = [
  "--declaration",
  "false",
  "--declarationMap",
  "false",
  "--emitDeclarationOnly",
  "false",
];

/**
 * Read effective compiler options from the same project tsc will use.
 * The compiler owns file discovery and reports any configuration errors.
 * @param {ReturnType<typeof ts.parseCommandLine>} commandLine Parsed tsc options.
 * @returns {import("typescript").CompilerOptions|undefined} Effective options.
 */
function compilerOptions({ options, fileNames }) {
  if (fileNames.length > 0) return options;
  const requested = options.project;
  let file = ts.findConfigFile(process.cwd(), ts.sys.fileExists);
  if (requested !== undefined) {
    file = ts.sys.directoryExists(requested)
      ? join(requested, "tsconfig.json")
      : requested;
  }
  if (file === undefined) return options;
  return ts.getParsedCommandLineOfConfigFile(file, options, {
    ...ts.sys,
    readDirectory: () => [],
    onUnRecoverableConfigFileDiagnostic: () => {},
  })?.options;
}

/**
 * Keep declaration checks when explicitly requested or required by the project.
 * @param {string[]} args Options forwarded to the compiler.
 * @returns {string[]} Additional defaults for a plain typecheck.
 */
function typecheckDefaults(args) {
  const parsed = ts.parseCommandLine(args);
  const { options } = parsed;
  if (
    parsed.errors.length > 0 ||
    options.noEmit === false ||
    options.declaration === true ||
    options.declarationMap === true ||
    options.emitDeclarationOnly === true
  )
    return [];
  const project = compilerOptions(parsed);
  return project &&
    !project.composite &&
    !project.isolatedDeclarations &&
    project.declarationDir === undefined
    ? PURE_TYPECHECK
    : [];
}

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const child = spawnSync(
  process.execPath,
  [
    require.resolve("typescript/bin/tsc"),
    "--noEmit",
    ...typecheckDefaults(args),
    ...args,
  ],
  { stdio: "inherit" }
);
if (child.error)
  console.error(`TypeScript could not start: ${child.error.message}`);
process.exitCode = child.status ?? 1;
