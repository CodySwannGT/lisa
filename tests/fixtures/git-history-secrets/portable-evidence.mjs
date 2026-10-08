/** Real default-vendor witnesses for portable committed evidence. */
import { createHash } from "node:crypto";
import { rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitFixture, fixtureHash, provePreimage } from "./harness.mjs";
import { scanImmutableCase } from "./report-mode.mjs";
import { budgetGraph, retainBudgetInventory } from "./errors.mjs";

const source = "config/access.rb";
const proof = join(tmpdir(), "owned-proof-access.md");
const bytes = Buffer.from("ordinary portable proof\n");
const digest = createHash("sha256").update(bytes).digest("hex");
const missing = createHash("sha256")
  .update("missing ordinary proof\n")
  .digest("hex");
const catalogue = `.lisa/history-secret-preimages/sha256/${digest}`;
const map = role => JSON.stringify({ [role]: { [source]: digest } }, null, 2);
const taxonomy = "Disk/missing/corrupt";
const narrative = `The bounded checks cover AccessDenied boundaries, ${taxonomy} falsifications, and the \`node probe\` invocation.\n`;
const cases = [
  ["portable-source-hashes", map("source_hashes"), 0],
  ["portable-source-hashes-after", map("source_hashes_after"), 0],
  [
    "portable-bare-source-map",
    JSON.stringify({ [source]: digest }, null, 2),
    0,
  ],
  [
    "portable-fenced-source-map",
    `Evidence:\n\n\`\`\`json\n${JSON.stringify({ files: { [source]: digest } }, null, 2)}\n\`\`\`\n`,
    0,
  ],
  [
    "portable-proof-catalogue",
    JSON.stringify({ proof_sha256: { [proof]: digest } }, null, 2),
    0,
    "catalogue",
  ],
  [
    "portable-selected-artifact",
    JSON.stringify({ selected_artifact_hashes: { [source]: digest } }, null, 2),
    0,
  ],
  ["portable-narrative-sentence", narrative, 0],
  ["portable-source-introduced-history", map("source_hashes"), 0, "historical"],
  [
    "portable-catalogue-mismatch",
    JSON.stringify({ proof_sha256: { [proof]: digest } }, null, 2),
    42,
    "mismatch",
  ],
  [
    "portable-catalogue-absent",
    JSON.stringify({ proof_sha256: { [proof]: digest } }, null, 2),
    42,
  ],
  [
    "portable-catalogue-symlink",
    JSON.stringify({ proof_sha256: { [proof]: digest } }, null, 2),
    42,
    "symlink",
  ],
  [
    "portable-catalogue-foreign-head",
    JSON.stringify({ proof_sha256: { [proof]: digest } }, null, 2),
    42,
    "foreign",
  ],
  ["portable-source-path-mismatch", map("source_hashes"), 42, "wrong-source"],
  [
    "portable-proof-credential-role",
    JSON.stringify({ api_key: digest }),
    42,
    "catalogue",
  ],
  [
    "portable-duplicate-role",
    `{"proof_sha256":{"${proof}":"${digest}"},"proof_sha256":{"${proof}":"${digest}"}}`,
    42,
    "catalogue",
  ],
  [
    "portable-escaped-proof-value",
    JSON.stringify({ proof_sha256: { [proof]: digest } }, null, 2).replace(
      digest,
      `\\u00${digest.charCodeAt(0).toString(16)}${digest.slice(1)}`
    ),
    42,
    "catalogue",
  ],
  ["portable-narrative-code-fence", `\`\`\`js\n${narrative}\`\`\`\n`, 42],
  ["portable-adjacent-credential", map("source_hashes"), 42, "credential"],
  [
    "portable-proof-unverified-sibling",
    JSON.stringify(
      {
        proof_sha256: {
          [proof]: digest,
          [join(tmpdir(), "missing-access.md")]: missing,
        },
      },
      null,
      2
    ),
    42,
    "catalogue",
  ],
  [
    "portable-proof-credential-sibling",
    JSON.stringify(
      { proof_sha256: { [proof]: digest }, api_key: digest },
      null,
      2
    ),
    42,
    "catalogue",
  ],
];

const credentialKeys = ["api_key", "access_token", "password"];
const credentialCases = credentialKeys.flatMap(key => [
  [
    `portable-proof-key-${key}`,
    JSON.stringify({ proof_sha256: { [key]: digest } }, null, 2),
    42,
    "catalogue",
  ],
  [
    `portable-source-key-${key}`,
    JSON.stringify({ [key]: digest }, null, 2),
    42,
    `label:${key}`,
  ],
]);

/**
 * Select disjoint bounded witnesses without changing the default full journey.
 * @param {string[]} args - Actual fixture command arguments
 * @returns {typeof cases} Exact authored fixture tuples
 */
export function selectPortableCases(args) {
  const flag = "--portable-partition";
  const selectors = args.filter(arg => arg.startsWith(flag));
  const index = args.indexOf(flag);
  const partition = index < 0 ? null : args[index + 1];
  if (
    selectors.length > 1 ||
    selectors.some(arg => arg !== flag) ||
    ![null, "first", "second"].includes(partition) ||
    (partition !== null &&
      (!args.includes("--portable-only") ||
        args.includes("--portable-credential-keys")))
  )
    throw new Error("Unknown portable control selector.");
  const selected = args.includes("--portable-credential-keys")
    ? credentialCases
    : cases;
  if (partition === null) return [...selected];
  return partition === "first" ? selected.slice(0, 10) : selected.slice(10);
}

/**
 * Build the genuine seed/evidence graph.
 * @param harness - Private fixture authority
 * @param fixture - Exact authored case tuple
 * @returns Owned cwd and actual evidence head
 */
const setupCase = (harness, fixture) => {
  const [name, content, , setup] = fixture;
  const { cwd } = harness.initialize(name);
  const { write, git } = harness;
  if (setup === "historical") harness.commit(cwd, source, bytes);
  write(cwd, source, bytes);
  if (setup?.startsWith("label:")) write(cwd, setup.slice(6), bytes);
  write(cwd, "evidence.md", content);
  if (setup === "wrong-source") write(cwd, source, "different source\n");
  if (setup === "historical") write(cwd, source, "later source\n");
  if (setup === "credential") write(cwd, "credential.txt", harness.secret());
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", "portable evidence");
  return { cwd, evidenceHead: git(cwd, "rev-parse", "HEAD") };
};

/**
 * Publish an owned catalogue fixture without substituting an ambient head.
 * @param harness - Private fixture authority
 * @param cwd - Exact owned fixture directory
 * @param setup - Authored catalogue control
 * @returns Actual post-catalogue head
 */
const addCatalogue = (harness, cwd, setup) => {
  if (["catalogue", "mismatch", "symlink", "foreign"].includes(setup)) {
    harness.write(
      cwd,
      catalogue,
      setup === "mismatch" ? "wrong bytes\n" : bytes
    );
    if (setup === "symlink") {
      rmSync(join(cwd, catalogue));
      symlinkSync("../../../../config/access.rb", join(cwd, catalogue));
    }
    harness.git(cwd, "add", ".");
    harness.git(cwd, "commit", "-qm", "portable preimage");
  }
  return harness.git(cwd, "rev-parse", "HEAD");
};

/**
 * Execute one authentic graph and retain only redacted verdict metadata.
 * @param harness - Private fixture authority
 * @param fixture - Exact authored case tuple
 * @returns Native status and authentic scanned commit count
 */
const portableCase = (harness, fixture) => {
  const [name, , expected, setup] = fixture;
  const { command, emitted, scanner, git, requireFact } = harness;
  const { cwd, evidenceHead } = setupCase(harness, fixture);
  const catalogueHead = addCatalogue(harness, cwd, setup);
  const head = setup === "foreign" ? evidenceHead : catalogueHead;
  const result = command(
    process.execPath,
    [join(emitted, harness.SCANNER_ENTRY), "pre-push", "--scanner", scanner],
    cwd,
    `refs/heads/fixture ${head} refs/heads/fixture ${"0".repeat(head.length)}\n`
  );
  const report = JSON.parse(result.stdout);
  const commits = git(cwd, "rev-list", head).split("\n").length;
  requireFact(
    report.version === "8.30.1" &&
      report.commits === commits &&
      Array.isArray(report.findings) &&
      [0, 42].includes(result.status),
    `${name}: complete actual scanner coverage missing.`
  );
  requireFact(
    (result.status === 42) === report.findings.length > 0,
    `${name}: vendor finding/native status disagreement.`
  );
  return { name, exit: result.status, commits, expected };
};

/**
 * Route portable fixtures without changing original ordinary journey controls.
 * @param harness - Existing private owned fixture authority
 * @param original - Existing evidence fixture entry point
 * @returns Whether the portable-only path was exercised
 */
export function runEvidenceCases(harness, original) {
  const selected = selectPortableCases(harness.args);
  if (!harness.args.includes("--portable-only")) {
    original();
    return false;
  }
  const mismatches = [];
  harness.values.push(digest, missing);
  for (const fixture of selected) {
    const observation = portableCase(harness, fixture);
    harness.observations.push(observation);
    if (observation.exit !== observation.expected)
      mismatches.push(
        `${observation.name}:${observation.exit} expected${observation.expected}`
      );
  }
  harness.requireFact(
    mismatches.length === 0,
    `Portable evidence reaching verdicts: ${mismatches.join(", ")}; raw values withheld.`
  );
  return true;
}

/** Fixed genuine preimage graphs for the original aggregate/unique lookup bounds. */
export const budgetFixtures = [
  ["immutable-bytes-within", "bytes", 63, 0],
  ["immutable-bytes-exhausted", "bytes", 64, 42],
  ["immutable-blobs-within", "blobs", 126, 0],
  ["immutable-blobs-exhausted", "blobs", 127, 42],
];

/**
 * Require genuine scanner boundaries and preserve private, independently proved blob metrics.
 * @param harness - Original fixture authority and unchanged native command limits
 * @param fixture - Exact one-case selector tuple
 */
export const runBudgetCase = (harness, fixture) => {
  for (const companion of fixture[1] === "blobs" ? [false, true] : [false]) {
    const graph = budgetGraph(harness, fixture, companion, {
      hash: fixtureHash,
      commit: commitFixture,
    });
    const inventory = [graph.tuples.slice(0, 256), graph.tuples.slice(256)]
      .filter(batch => batch.length)
      .flatMap(batch => provePreimage(harness, graph.cwd, batch));
    const name = `${fixture[0]}${companion ? "-detector" : ""}`;
    const budget = retainBudgetInventory(
      harness,
      name,
      graph,
      inventory,
      companion,
      fixture
    );
    const verdict = scanImmutableCase(harness, {
      ...graph,
      name,
      budget,
      expected: companion ? 42 : fixture[3],
      target: { commit: graph.origin, line: graph.targets[0].line },
      targets: graph.targets,
      findingsCount: companion ? fixture[2] : undefined,
      preimagesVerified: companion ? 1 : graph.sources.length,
    });
    if (harness.proof)
      harness.write(
        harness.proof,
        `${name}-selected.json`,
        JSON.stringify(
          {
            ...verdict,
            before: graph.before,
            head: graph.head,
            origin: graph.origin,
            expectedCoordinates: graph.targets.map(({ file, line }) => ({
              file,
              line,
            })),
          },
          null,
          2
        )
      );
  }
};
