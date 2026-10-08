#!/usr/bin/env node
/**
 * @file harness.mjs
 * @description Actual default-rule scanner witnesses on private disposable Git graphs.
 * @module history-secrets-fixtures
 */
import { createHash, randomInt } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { provePreimageBatch } from "./native-push.mjs";

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
  const command = (binary, argv, cwd, input) => {
    const result = spawnSync(binary, argv, {
      cwd,
      input,
      encoding: "utf8",
      timeout: 300000,
      maxBuffer: 32 * 1024 * 1024,
    });
    outputs.push((result.stdout ?? "") + (result.stderr ?? ""));
    if (proof)
      writeFileSync(
        join(proof, `${outputs.length}.json`),
        JSON.stringify({
          binary,
          argv,
          cwd,
          input,
          status: result.status,
          signal: result.signal,
          error: result.error?.code,
          stdout: result.stdout,
          stderr: result.stderr,
        }),
        { mode: 0o600 }
      );
    if (result.error || result.signal)
      throw new Error(
        "Fixture subprocess did not complete; no scanner proof is claimed."
      );
    return result;
  };
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
    // Random hex bytes can fall below Gitleaks' 3.5-bit entropy floor.
    // Shuffle a balanced alphabet: every fixture remains a random
    // nonce while its measured symbol entropy is always four bits.
    const value = (() => {
      const symbols = "0123456789abcdef".repeat(4).split("");
      symbols.forEach((_, offset) => {
        const index = symbols.length - 1 - offset;
        if (index === 0) return;
        const selected = randomInt(index + 1);
        [symbols[index], symbols[selected]] = [
          symbols[selected],
          symbols[index],
        ];
      });
      return symbols.join("");
    })();
    values.push(value);
    if (proof)
      writeFileSync(
        join(proof, "synthetic-values.json"),
        JSON.stringify(values),
        {
          mode: 0o600,
        }
      );
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
  const scan = (cwd, name, pairs, expected) => {
    const input = pairs
      .map(
        ({ before, after }) =>
          `refs/heads/fixture ${after} refs/heads/fixture ${before}\n`
      )
      .join("");
    const result = command(
      process.execPath,
      [join(emitted, SCANNER_ENTRY), "pre-push", "--scanner", scanner],
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
export const immutableFixtures = [
  ["immutable-selected-ancestor", "selected_artifact_hashes", null, 0],
  ["immutable-mixed-revisions", "source_hashes", "mixed", 0],
  ["immutable-binary-preimage", "source_hashes_after", "binary", 0],
  ["immutable-unicode-offset", "root", "unicode", 0],
  ["immutable-complete-fence", "files", null, 0],
  ["immutable-later-archive", "proof_sha256", null, 0],
  ["immutable-typed-parent", "source_hashes", "typed", 0],
  ["immutable-missing-sibling", "source_hashes", "missing-sibling", 42],
  ["immutable-wrong-blob", "source_hashes", "wrong-blob", 42],
  ["immutable-wrong-span", "source_hashes", "wrong-span", 42],
  ["immutable-duplicate-coordinate", "source_hashes", "duplicate", 42],
  ["immutable-unknown-field", "source_hashes", "unknown", 42],
  ["immutable-null-parent", "source_hashes", "null-parent", 42],
  ["immutable-wrong-role", "source_hashes", "wrong-role", 42],
  ["immutable-conflicting-versions", "source_hashes", "versions", 42],
  ["immutable-archive-mismatch", "proof_sha256", "archive-mismatch", 42],
  [
    "immutable-archive-outside-selection",
    "proof_sha256",
    "archive-outside",
    42,
  ],
  ["immutable-archive-credential", "proof_sha256", "archive-credential", 42],
  ["immutable-sidecar-credential", "source_hashes", "sidecar-credential", 42],
  ["immutable-evidence-credential", "source_hashes", "evidence-credential", 42],
  ["immutable-escaped-coordinate", "source_hashes", "escaped-coordinate", 42],
  ["immutable-duplicate-sidecar-key", "source_hashes", "duplicate-key", 42],
  ["immutable-overlapping-span", "source_hashes", "overlap", 42],
  ["immutable-unsafe-integer", "source_hashes", "unsafe-integer", 42],
  ["immutable-absolute-source", "source_hashes", "absolute-source", 42],
  ["immutable-parent-source", "source_hashes", "parent-source", 42],
  ["immutable-credential-role", "source_hashes", "credential-role", 42],
  ["immutable-multiple-fences", "files", "multiple-fences", 42],
  ["immutable-sidecar-symlink", "source_hashes", "sidecar-symlink", 42],
  ["immutable-source-symlink", "source_hashes", "source-symlink", 42],
  ["immutable-archive-symlink", "proof_sha256", "archive-symlink", 42],
  ["immutable-ancestor-blob-object", "source_hashes", "blob-revision", 42],
  ["immutable-ancestor-tag-object", "source_hashes", "tag-revision", 42],
  ["immutable-ancestor-off-chain", "source_hashes", "off-chain", 42],
  ["immutable-conflicting-parent", "source_hashes", "parent-conflict", 42],
  ["immutable-unflagged-sibling", "source_hashes", "unflagged-sibling", 42],
  ["immutable-manifest-token-budget", "source_hashes", "token-budget", 42],
  ["immutable-manifest-depth-budget", "source_hashes", "depth-budget", 42],
  ["immutable-manifest-byte-budget", "source_hashes", "byte-budget", 42],
  ["immutable-map-entry-budget", "source_hashes", "entry-budget", 42],
  ["immutable-source-tree", "source_hashes", "source-tree", 42],
  ["immutable-source-submodule", "source_hashes", "source-submodule", 42],
  ["immutable-archive-worktree-only", "proof_sha256", "archive-worktree", 42],
  ["immutable-origin-not-selected", "source_hashes", "origin-not-selected", 42],
  ["immutable-coexist-strict-source", "source_hashes", "coexist-source", 0],
  ["immutable-coexist-catalogue-proof", "source_hashes", "coexist-proof", 0],
  [
    "immutable-coexist-incomplete-map",
    "source_hashes",
    "coexist-incomplete",
    42,
  ],
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
export const commitFixture = (
  harness,
  cwd,
  message = "immutable evidence fixture"
) => {
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
  const commit = () =>
    commitFixture(harness, cwd, "unrelated legacy evidence fixture");
  harness.values.push(digest);
  harness.write(cwd, path, bytes);
  harness.write(cwd, "evidence/legacy.json", JSON.stringify(content, null, 2));
  return (() => {
    const revision = commit();
    provePreimage(harness, cwd, revision, path, digest);
    return { commit: revision, preimageVerified: true };
  })();
};
