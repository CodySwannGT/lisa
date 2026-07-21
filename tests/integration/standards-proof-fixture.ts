import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

export const GIT = "/usr/bin/git";
export const PROOF_PATH = ".lisa/standards/latest.json";
export const TYPESCRIPT_CHECKS = [
  "typescript.lint",
  "typescript.lint-slow",
  "typescript.typecheck",
  "typescript.build",
  "typescript.test",
  "typescript.test-unit",
  "typescript.test-coverage",
  "typescript.test-integration",
  "typescript.format",
  "typescript.dead-code",
  "typescript.ast-grep",
  "shared.threshold-ratchet",
] as const;
export const RAILS_CHECKS_WITH_MUTATION = [
  "rails.rubocop",
  "rails.rspec",
  "rails.reek",
  "rails.flog",
  "rails.flay",
  "rails.brakeman",
  "rails.bundler-audit",
  "rails.ast-grep",
  "rails.mutation",
  "shared.threshold-ratchet",
] as const;

/** Exact bytes and metadata used to prove failed-capture preservation. */
export interface ProofSnapshot {
  /** Complete proof bytes. */
  readonly bytes: string;
  /** SHA-256 of complete proof bytes. */
  readonly digest: string;
  /** File size in bytes. */
  readonly size: number;
  /** Filesystem modification time. */
  readonly mtimeMs: number;
}

/**
 * Run fixed-system Git in one fixture repository.
 * @param root - Fixture repository root
 * @param args - Fixed Git argument vector
 * @returns Trimmed command output
 */
export function git(root: string, args: readonly string[]): string {
  return execFileSync(GIT, args, { cwd: root, encoding: "utf8" }).trim();
}

/**
 * Commit all fixture changes with a stable local identity.
 * @param root - Fixture repository root
 * @param message - Commit message
 */
export function commitAll(root: string, message: string): void {
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", message]);
}

/**
 * Create the shared repository identity and first commit.
 * @param root - Fixture repository root
 */
async function initializeRepository(root: string): Promise<void> {
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Test"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["remote", "add", "origin", "https://github.com/acme/project.git"]);
  await writeFile(
    path.join(root, ".gitignore"),
    `${PROOF_PATH}\n.lisa.config.local.json\n`
  );
}

/**
 * Create a two-commit TypeScript repository with real package scripts.
 * @returns Fixture repository root
 */
export async function createTypescriptRepository(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "lisa-standards-ts-int-"));
  await initializeRepository(root);
  await mkdir(path.join(root, "scripts"));
  await writeFile(path.join(root, "tsconfig.json"), "{}\n");
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  await writeFile(path.join(root, "lint-target.txt"), "clean\n");
  await writeFile(path.join(root, "test-mode.txt"), "pass\n");
  await writeFile(path.join(root, "scripts/gate.mjs"), TYPESCRIPT_GATE);
  await writeFile(
    path.join(root, "scripts/check-threshold-ratchet.mjs"),
    TYPESCRIPT_THRESHOLD_GATE
  );
  const names = [
    "lint",
    "lint:slow",
    "typecheck",
    "build",
    "test",
    "test:unit",
    "test:cov",
    "test:integration",
    "format:check",
    "knip:check",
    "sg:scan",
  ];
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      scripts: Object.fromEntries(
        names.map(name => [name, `node scripts/gate.mjs ${name}`])
      ),
    })
  );
  commitAll(root, "fixture setup");
  await writeFile(path.join(root, "README.md"), "second commit\n");
  commitAll(root, "fixture head");
  return root;
}

/**
 * Create a two-commit Rails repository with mutation enabled.
 * @returns Fixture repository root
 */
export async function createRailsRepository(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "lisa-standards-rails-int-"));
  await initializeRepository(root);
  await mkdir(path.join(root, "bin"));
  await mkdir(path.join(root, "scripts"));
  await writeFile(path.join(root, "bin/rails"), "#!/bin/sh\nexit 0\n");
  await chmod(path.join(root, "bin/rails"), 0o755);
  await writeFile(
    path.join(root, "scripts/check-threshold-ratchet.mjs"),
    "process.exit(0);\n"
  );
  await writeFile(
    path.join(root, "scripts/lisa-mutation.sh"),
    "#!/bin/sh\nexit 0\n"
  );
  await chmod(path.join(root, "scripts/lisa-mutation.sh"), 0o755);
  await writeFile(
    path.join(root, ".lisa.config.json"),
    JSON.stringify({ quality: { mutation: { gate: { enabled: true } } } })
  );
  commitAll(root, "rails fixture setup");
  await writeFile(path.join(root, "README.md"), "second commit\n");
  commitAll(root, "rails fixture head");
  return root;
}

/**
 * Create safe local bundle/sg executables and return their directory/log.
 * @returns Tool directory and command log path
 */
export async function createRailsExecutables(): Promise<{
  readonly directory: string;
  readonly log: string;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), "lisa-rails-tools-"));
  const log = path.join(directory, "commands.log");
  const executable = `#!${process.execPath}\n${RAILS_EXECUTABLE}`;
  for (const name of ["bundle", "sg"]) {
    await writeFile(path.join(directory, name), executable);
    await chmod(path.join(directory, name), 0o755);
  }
  return { directory, log };
}

/**
 * Read exact proof bytes and replacement metadata.
 * @param root - Fixture repository root
 * @returns Exact proof snapshot
 */
export async function snapshotProof(root: string): Promise<ProofSnapshot> {
  const target = path.join(root, PROOF_PATH);
  const [bytes, metadata] = await Promise.all([
    readFile(target, "utf8"),
    stat(target),
  ]);
  return {
    bytes,
    digest: createHash("sha256").update(bytes).digest("hex"),
    size: metadata.size,
    mtimeMs: metadata.mtimeMs,
  };
}

/**
 * List any adjacent temporary/lock residue left by proof storage.
 * @param root - Fixture repository root
 * @returns Non-proof entries in the storage directory
 */
export async function proofResidue(root: string): Promise<readonly string[]> {
  const directory = path.join(root, ".lisa/standards");
  return (await readdir(directory)).filter(name => name !== "latest.json");
}

const TYPESCRIPT_GATE = `import { appendFileSync, readFileSync } from "node:fs";
const sentinel = process.env.LISA_STANDARDS_EXECUTION_SENTINEL;
if (sentinel) appendFileSync(sentinel, "executed\\n");
const gate = process.argv[2] ?? "";
const mode = readFileSync("test-mode.txt", "utf8").trim();
if (gate === "lint" && (mode === "nonzero" || readFileSync("lint-target.txt", "utf8").includes("VIOLATION"))) {
  process.stderr.write("lint violation detected\\n");
  process.exit(1);
}
if (gate.startsWith("test")) {
  if (mode === "zero") process.stdout.write("0 tests\\n");
  else if (mode === "skipped") process.stdout.write("Tests  1 skipped (1)\\n");
  else process.stdout.write("Tests  1 passed (1)\\n");
}
`;

const TYPESCRIPT_THRESHOLD_GATE = `import { appendFileSync } from "node:fs";
const sentinel = process.env.LISA_STANDARDS_EXECUTION_SENTINEL;
if (sentinel) appendFileSync(sentinel, "executed\\n");
`;

const RAILS_EXECUTABLE = `const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.LISA_STANDARDS_COMMAND_LOG, process.argv[1] + " " + args.join(" ") + "\\n");
if (args.includes("rspec")) process.stdout.write("1 example, 0 failures\\n");
`;
