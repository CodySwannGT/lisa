#!/usr/bin/env node
/**
 * @file harness.mjs
 * @description Actual default-rule scanner witnesses on private disposable Git graphs.
 * @module history-secrets-fixtures
 */
import { createHash, randomInt } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { provePreimageBatch } from "./native-push.mjs";
import { spawnSync } from "node:child_process";
import { publicFailure } from "../../../all/copy-overwrite/scripts/lib/npm-update-invariants.mjs";
import { runProcess } from "../../../all/copy-overwrite/scripts/lib/npm-update-native-process.mjs";

/**
 * Keep generated values and captured vendor output inside one private fixture lease.
 * @param args - Supported journey options
 * @returns Owned scratch and bounded fixture operations
 */
export function createHarness(args) {
  const option = name => args[args.indexOf(name) + 1];
  const scanner = args.includes("--scanner")
    ? resolve(option("--scanner"))
    : "gitleaks";
  const archive = args.includes("--package")
    ? resolve(option("--package"))
    : null;
  const upstream = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const proof = args.includes("--proof-dir")
    ? resolve(option("--proof-dir"))
    : null;
  if (proof) {
    if (proof === upstream || proof.startsWith(`${upstream}/`))
      throw new Error(
        "Private fixture proof must remain outside the source root."
      );
    mkdirSync(proof, { mode: 0o700 });
  }
  const scratch = mkdtempSync(join(tmpdir(), "lisa-history-journey-"));

  const values = [];
  const outputs = [];
  const observations = [];
  const { command, commandAsync } = nativeCommands(outputs, proof);
  const requireFact = (condition, explanation) => {
    if (!condition) throw new Error(explanation);
  };
  const git = (cwd, ...argv) => {
    const result = command(
      "git",
      ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...argv],
      cwd
    );
    requireFact(
      result.status === 0,
      "Synthetic Git graph construction failed."
    );
    return result.stdout.trim();
  };
  const write = (cwd, file, content) => {
    mkdirSync(dirname(join(cwd, file)), { recursive: true, mode: 0o700 });
    writeFileSync(join(cwd, file), content, { mode: 0o600 });
  };
  const commit = (cwd, file, content, message = "fixture change") => {
    write(cwd, file, content);
    git(cwd, "add", "--", file);
    git(cwd, "commit", "-qm", message);
    return git(cwd, "rev-parse", "HEAD");
  };
  const secret = () => {
    // Balance all 16 symbols to stay above the pinned vendor's entropy floor.
    // Its stopwords include dead/feed and a digest containing adjacent letters.
    // Shuffle digits and letters separately, then separate every letter with a
    // digit. This prevents those words; four copies also cannot spell 000000
    // or aaaaaa. The 64-character nonce still measures exactly four bits.
    const shuffle = symbols => {
      symbols.forEach((_, offset) => {
        const index = symbols.length - 1 - offset;
        if (index === 0) return;
        const selected = randomInt(index + 1);
        [symbols[index], symbols[selected]] = [
          symbols[selected],
          symbols[index],
        ];
      });
      return symbols;
    };
    const digits = shuffle("0123456789".repeat(4).split(""));
    const letters = shuffle("abcdef".repeat(4).split(""));
    const value =
      letters.map((letter, index) => letter + digits[index]).join("") +
      digits.slice(letters.length).join("");
    values.push(value);
    if (proof) {
      const file = join(proof, "synthetic-values.json");
      writeFileSync(file, JSON.stringify(values), { mode: 0o600 });
    }
    return `api_key = "${value}"\n`;
  };
  const initialize = name => {
    const cwd = join(scratch, name);
    mkdirSync(cwd, { mode: 0o700 });
    git(cwd, "init", "-q", "--initial-branch=main");
    git(cwd, "config", "user.name", "Fixture");
    git(cwd, "config", "user.email", "fixture@example.invalid");
    return { cwd, base: commit(cwd, "clean.txt", "clean\n") };
  };
  const emitted = join(scratch, "emitted");
  const SCANNER_ENTRY = "scripts/lisa-history-secrets.mjs";
  const scan = (cwd, name, pairs, expected, remoteArgs = []) => {
    const input = pairs
      .map(
        ({ before, after }) =>
          `refs/heads/fixture ${after} refs/heads/fixture ${before}\n`
      )
      .join("");
    const argv = ["pre-push", ...remoteArgs, "--scanner", scanner];
    const result = command(
      process.execPath,
      [join(emitted, SCANNER_ENTRY), ...argv],
      cwd,
      input
    );
    requireFact(
      result.status === expected,
      `${name}: unexpected scanner exit; raw outputs are withheld.`
    );
    if (expected === 42)
      requireFact(
        result.stdout.includes("generic-api-key") &&
          result.stdout.includes('"version":"8.30.1"'),
        `${name}: actual scanner attribution missing.`
      );
    if (expected === 1)
      requireFact(
        /[Rr]epair|[Ff]etch|[Ss]upply|[Pp]rovision|[Uu]se|[Rr]un/.test(
          result.stderr
        ),
        `${name}: actionable fail-closed explanation missing.`
      );
    observations.push({ name, exit: result.status });
    return { result, input };
  };
  chmodSync(scratch, 0o700);
  return {
    SCANNER_ENTRY,
    args,
    option,
    scanner,
    archive,
    proof,
    upstream,
    scratch,
    values,
    outputs,
    observations,
    command,
    commandAsync,
    requireFact,
    git,
    write,
    commit,
    secret,
    initialize,
    emitted,
    scan,
  };
}

/**
 * Complete authored immutable case tuples, independent of runner expectations.
 */
const SOURCE_ROLE = "source_hashes";
const PROOF_ROLE = "proof_sha256";
export const immutableFixtures = [
  ["immutable-selected-ancestor", "selected_artifact_hashes", null, 0],
  ["immutable-mixed-revisions", SOURCE_ROLE, "mixed", 0],
  ["immutable-binary-preimage", "source_hashes_after", "binary", 0],
  ["immutable-unicode-offset", "root", "unicode", 0],
  ["immutable-complete-fence", "files", null, 0],
  ["immutable-later-archive", PROOF_ROLE, null, 0],
  ["immutable-typed-parent", SOURCE_ROLE, "typed", 0],
  ["immutable-missing-sibling", SOURCE_ROLE, "missing-sibling", 42],
  ["immutable-wrong-blob", SOURCE_ROLE, "wrong-blob", 42],
  ["immutable-wrong-span", SOURCE_ROLE, "wrong-span", 42],
  ["immutable-duplicate-coordinate", SOURCE_ROLE, "duplicate", 42],
  ["immutable-unknown-field", SOURCE_ROLE, "unknown", 42],
  ["immutable-null-parent", SOURCE_ROLE, "null-parent", 42],
  ["immutable-wrong-role", SOURCE_ROLE, "wrong-role", 42],
  ["immutable-conflicting-versions", SOURCE_ROLE, "versions", 42],
  ["immutable-archive-mismatch", PROOF_ROLE, "archive-mismatch", 42],
  ["immutable-archive-outside-selection", PROOF_ROLE, "archive-outside", 42],
  ["immutable-archive-credential", PROOF_ROLE, "archive-credential", 42],
  ["immutable-sidecar-credential", SOURCE_ROLE, "sidecar-credential", 42],
  ["immutable-evidence-credential", SOURCE_ROLE, "evidence-credential", 42],
  ["immutable-escaped-coordinate", SOURCE_ROLE, "escaped-coordinate", 42],
  ["immutable-duplicate-sidecar-key", SOURCE_ROLE, "duplicate-key", 42],
  ["immutable-overlapping-span", SOURCE_ROLE, "overlap", 42],
  ["immutable-unsafe-integer", SOURCE_ROLE, "unsafe-integer", 42],
  ["immutable-absolute-source", SOURCE_ROLE, "absolute-source", 42],
  ["immutable-parent-source", SOURCE_ROLE, "parent-source", 42],
  ["immutable-credential-role", SOURCE_ROLE, "credential-role", 42],
  ["immutable-multiple-fences", "files", "multiple-fences", 42],
  ["immutable-sidecar-symlink", SOURCE_ROLE, "sidecar-symlink", 42],
  ["immutable-source-symlink", SOURCE_ROLE, "source-symlink", 42],
  ["immutable-archive-symlink", PROOF_ROLE, "archive-symlink", 42],
  ["immutable-ancestor-blob-object", SOURCE_ROLE, "blob-revision", 42],
  ["immutable-ancestor-tag-object", SOURCE_ROLE, "tag-revision", 42],
  ["immutable-ancestor-off-chain", SOURCE_ROLE, "off-chain", 42],
  ["immutable-conflicting-parent", SOURCE_ROLE, "parent-conflict", 42],
  ["immutable-unflagged-sibling", SOURCE_ROLE, "unflagged-sibling", 42],
  ["immutable-manifest-token-budget", SOURCE_ROLE, "token-budget", 42],
  ["immutable-manifest-depth-budget", SOURCE_ROLE, "depth-budget", 42],
  ["immutable-manifest-byte-budget", SOURCE_ROLE, "byte-budget", 42],
  ["immutable-map-entry-budget", SOURCE_ROLE, "entry-budget", 42],
  ["immutable-source-tree", SOURCE_ROLE, "source-tree", 42],
  ["immutable-source-submodule", SOURCE_ROLE, "source-submodule", 42],
  ["immutable-archive-worktree-only", PROOF_ROLE, "archive-worktree", 42],
  ["immutable-origin-not-selected", SOURCE_ROLE, "origin-not-selected", 42],
  ["immutable-coexist-strict-source", SOURCE_ROLE, "coexist-source", 0],
  ["immutable-coexist-catalogue-proof", SOURCE_ROLE, "coexist-proof", 0],
  ["immutable-coexist-incomplete-map", SOURCE_ROLE, "coexist-incomplete", 42],
];

/**
 * Hash exact fixture bytes.
 * @param bytes - Exact native preimage bytes
 * @returns SHA256 digest
 */
export const fixtureHash = bytes =>
  createHash("sha256").update(bytes).digest("hex");

/**
 * Commit all actual owned fixture paths and return the immutable head.
 * @param harness - Private fixture operations
 * @param cwd - Owned repository
 * @param message - Fixed fixture message
 * @returns Native immutable commit identity
 */
const COMMIT_MESSAGE = "immutable evidence fixture";
export const commitFixture = (harness, cwd, message = COMMIT_MESSAGE) => {
  harness.git(cwd, "add", ".");
  harness.git(cwd, "commit", "-qm", message);
  return harness.git(cwd, "rev-parse", "HEAD");
};

/**
 * Independently recompute an exact raw Git preimage through a bounded native child.
 * @param harness - Private bounded fixture operations
 * @param cwd - Owned repository
 * @param revision - Actual immutable commit or closed batch of native proof tuples
 * @param path - Canonical source or selected archive path
 * @param expected - Expected byte digest, never emitted
 * @returns Private raw identity inventory for a batch; single proof retains no data
 */
export const provePreimage = (harness, cwd, revision, path, expected) => {
  if (Array.isArray(revision))
    return provePreimageBatch(harness, cwd, revision);
  const { command, requireFact } = harness;
  const proof = command(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'import { execFileSync } from "node:child_process"; import { createHash } from "node:crypto"; const bytes = execFileSync("git", ["--no-replace-objects", "show", `${process.argv[1]}:${process.argv[2]}`]); if (createHash("sha256").update(bytes).digest("hex") !== process.argv[3]) process.exit(1); console.log("preimage-ok");',
      revision,
      path,
      expected,
    ],
    cwd
  );
  requireFact(
    proof.status === 0 && proof.stdout === "preimage-ok\n",
    "Actual Git byte preimage witness failed."
  );
};

/**
 * Commit and independently prove an unrelated previously accepted evidence role.
 * @param harness - Original bounded private fixture authority
 * @param cwd - Owned real Git repository
 * @param mode - Fixed authored coexistence mode
 * @returns Actual legacy finding commit or null outside the coexistence cases
 */
export const addLegacyEvidence = (harness, cwd, mode) => {
  if (mode?.startsWith("coexist-") !== true) return null;
  const bytes = Buffer.from("independent legacy preimage\n");
  const digest = fixtureHash(bytes);
  const source = "config/legacy.rb";
  const proof = mode === "coexist-proof";
  const path = proof
    ? `.lisa/history-secret-preimages/sha256/${digest}`
    : source;
  const content = proof
    ? { proof_sha256: { "/opaque/legacy-proof.json": digest } }
    : { source_sha256: { [source]: digest } };
  const message = "unrelated legacy evidence fixture";
  harness.values.push(digest);
  harness.write(cwd, path, bytes);
  harness.write(cwd, "evidence/legacy.json", JSON.stringify(content, null, 2));
  return (() => {
    const revision = commitFixture(harness, cwd, message);
    provePreimage(harness, cwd, revision, path, digest);
    return { commit: revision, preimageVerified: true };
  })();
};

/**
 * Preserve actual native command observations and private proof.
 * @param outputs - Existing private captured stream inventory.
 * @param proof - Existing private proof directory, or null.
 * @returns Original sync command and supervised async sibling.
 */
export function nativeCommands(outputs, proof) {
  const record = (result, context) => {
    const { status, signal, error, stdout, stderr } = result;
    outputs.push((stdout ?? "") + (stderr ?? ""));
    if (proof) {
      const file = join(proof, `${outputs.length}.json`);
      const verdict = { status, signal, error: error?.code };
      const data = { ...context, ...verdict, stdout, stderr };
      writeFileSync(file, JSON.stringify(data), { mode: 0o600 });
    }
    return result;
  };
  const failure = "Native fixture failed; no scanner proof is claimed.";
  const maximum = 32 * 1024 * 1024;
  const options = (cwd, input) => ({ cwd, input, timeout: 300000 });
  const command = (binary, argv, cwd, input) => {
    const context = { binary, argv, cwd, input };
    const defaults = { encoding: "utf8", maxBuffer: maximum };
    const settings = { ...options(cwd, input), ...defaults };
    const result = record(spawnSync(binary, argv, settings), context);
    if (result.error || result.signal) throw new Error(failure);
    return result;
  };
  const commandAsync = async (binary, argv, cwd, input) => {
    const context = { binary, argv, cwd, input };
    // Authentic status is observed; the original validator decides acceptance.
    const allowed = Array.from({ length: 256 }, (_, status) => status);
    try {
      const result = await runProcess(binary, argv, {
        ...options(cwd, input),
        maximum,
        allowed,
      });
      const stdout = result.stdout.toString(),
        stderr = result.stderr.toString();
      const verdict = { status: result.code, signal: null, stdout, stderr };
      return record(verdict, context);
    } catch (error) {
      context.nativeFailure = publicFailure(error);
      const stdout = error.stdout?.toString() ?? "",
        stderr = error.stderr?.toString() ?? "";
      record({ status: error.code ?? null, error, stdout, stderr }, context);
      throw new Error(failure);
    }
  };
  return { command, commandAsync };
}
