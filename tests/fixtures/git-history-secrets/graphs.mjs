/**
 * @file graphs.mjs
 * @description Build actual immutable evidence, ancestor and selected archive graphs.
 * @module history-secrets-fixtures
 */
import { rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import {
  addLegacyEvidence,
  commitFixture,
  fixtureHash,
  immutableFixtures,
  provePreimage,
} from "./harness.mjs";
import { corruptImmutableManifest } from "./errors.mjs";
import { immutableNarrativeCases, scanImmutableCase } from "./report-mode.mjs";
import { budgetFixtures, runBudgetCase } from "./portable-evidence.mjs";

const UNFLAGGED_SIBLING = "unflagged-sibling";
const REV_PARSE = "rev-parse";
const PROOF_ROLE = "proof_sha256";
const ORDINARY_TARGET = "config/ordinary-target.rb";

/**
 * Build one owned graph and run the unchanged real scanner attribution.
 * @param harness - Private bounded fixture operations
 * @param fixture - Exact authored case tuple
 */
const prepareImmutableCase = (harness, fixture) => {
  const [name, role, mode, expected] = fixture;
  const { initialize, values, write, git } = harness;
  const { cwd } = initialize(name);
  const source = mode === "unicode" ? "config/é-access.rb" : "config/access.rb";
  const evidence = "evidence/manifest.md";
  const sidecar = ".lisa/history-secret-evidence.json";
  const archive = "evidence/archive/neutral-artifact.json";
  const bytes =
    mode === "binary"
      ? Buffer.from([0, 255, 10, 32, 120, 10])
      : mode === "archive-credential"
        ? Buffer.from(harness.secret())
        : Buffer.from("ordinary é immutable preimage\n");
  const literal = fixtureHash(bytes);
  const sourceKey =
    mode === "absolute-source"
      ? `/${source}`
      : mode === "parent-source"
        ? `../${source}`
        : mode === "credential-role"
          ? "api_key"
          : source;
  const fields = {
    [role === PROOF_ROLE ? "/opaque/access-proof.json" : sourceKey]: literal,
  };
  const root =
    role === "root" ? fields : { note: "ordinary é metadata", [role]: fields };
  const state = {
    before: undefined,
    foreign: undefined,
    archiveCommit: undefined,
    head: undefined,
    origin: undefined,
    identity: undefined,
    content: "",
    entries: [],
    manifest: "",
    legacy: null,
  };
  const content = () =>
    role === "files"
      ? `Evidence follows.\n\n\`\`\`json\n${JSON.stringify(root, null, 2)}\n\`\`\`\n`
      : JSON.stringify(root, null, 2);
  const entries = () =>
    Object.entries(fields).map(([file, value]) => {
      const start = Buffer.from(state.content).indexOf(Buffer.from(value));
      return {
        origin: {
          commit: state.origin,
          blob: state.identity,
          path: evidence,
          format:
            role === "root"
              ? "json-root-map"
              : role === "files"
                ? "markdown-json-files"
                : role === PROOF_ROLE
                  ? "json-proof-map"
                  : "json-source-map",
          map_pointer: role === "root" ? "" : `/${role}`,
          value_span: [start, start + 64],
        },
        preimage:
          role === PROOF_ROLE
            ? { kind: "archive", commit: state.archiveCommit, path: archive }
            : file === source
              ? { kind: "source", commit: state.before }
              : { kind: "source" },
      };
    });
  const target = () =>
    mode === "archive-credential"
      ? { commit: state.archiveCommit, line: 1 }
      : {
          commit: state.origin,
          line: state.content
            .slice(
              0,
              state.content.indexOf(
                mode === "evidence-credential" ? '"api_key"' : literal
              )
            )
            .split("\n").length,
        };
  values.push(literal);
  write(cwd, mode === "source-tree" ? `${source}/content.txt` : source, bytes);
  if (mode === "source-symlink") {
    write(cwd, ORDINARY_TARGET, bytes);
    rmSync(join(cwd, source));
    symlinkSync("ordinary-target.rb", join(cwd, source));
  }
  if (mode === "archive-outside") write(cwd, archive, bytes);
  state.before = commitFixture(harness, cwd);
  if (mode === "source-submodule") {
    git(cwd, "rm", "-q", source);
    git(
      cwd,
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${state.before},${source}`
    );
    git(cwd, "commit", "-qm", "nonblob source fixture");
    state.before = git(cwd, REV_PARSE, "HEAD");
  }

  if (mode === "off-chain") {
    git(cwd, "checkout", "-qb", "foreign");
    write(cwd, "unrelated.txt", "off-chain graph\n");
    state.foreign = commitFixture(harness, cwd);
    git(cwd, "checkout", "-q", "main");
  }
  write(
    cwd,
    mode === "source-tree" ? `${source}/content.txt` : source,
    mode === "coexist-incomplete" ? bytes : "a later source revision\n"
  );
  if (
    [
      "mixed",
      "missing-sibling",
      UNFLAGGED_SIBLING,
      "coexist-incomplete",
    ].includes(mode)
  ) {
    const sibling = Buffer.from("current sibling content\n");
    const siblingPath =
      mode === UNFLAGGED_SIBLING
        ? "config/plain.rb"
        : "config/access-sibling.rb";
    if (mode !== UNFLAGGED_SIBLING) write(cwd, siblingPath, sibling);
    fields[siblingPath] = fixtureHash(sibling);
    values.push(fixtureHash(sibling));
  }
  if (mode === "typed") root.commit_parent = state.before;
  if (mode === "null-parent") root.commit_parent = null;
  if (mode === "parent-conflict")
    root.commit_parent = "f".repeat(state.before.length);
  if (mode === "evidence-credential")
    root.api_key = harness.secret().match(/"([^"]+)"/u)[1];
  if (mode === "entry-budget")
    for (const entry of Array.from({ length: 257 }, (_, index) => index))
      fields[`config/plain-${entry}.rb`] = literal;
  if (role === "files")
    root.logs = {
      "/opaque/report.log": fixtureHash(Buffer.from("ordinary log\n")),
    };
  state.content = content();
  if (mode === "multiple-fences")
    state.content += `\n\`\`\`json\n${JSON.stringify(root)}\n\`\`\`\n`;
  write(cwd, evidence, state.content);
  state.origin = commitFixture(harness, cwd);
  state.identity = git(cwd, REV_PARSE, `${state.origin}:${evidence}`);

  if (role === PROOF_ROLE) {
    if (mode === "archive-outside") state.archiveCommit = state.before;
    else if (mode === "archive-worktree") state.archiveCommit = state.origin;
    else {
      write(
        cwd,
        archive,
        mode === "archive-mismatch" ? "different archive\n" : bytes
      );
      if (mode === "archive-symlink") {
        write(cwd, "evidence/archive/target.json", bytes);
        rmSync(join(cwd, archive));
        symlinkSync("target.json", join(cwd, archive));
      }
      state.archiveCommit = commitFixture(harness, cwd);
    }
  }
  state.legacy = addLegacyEvidence(harness, cwd, mode);
  state.entries = entries();
  state.manifest = corruptImmutableManifest(harness, {
    mode,
    entries: state.entries,
    identity: state.identity,
    before: state.before,
    cwd,
    source,
    foreign: state.foreign,
  });
  write(cwd, sidecar, state.manifest);
  if (mode === "sidecar-symlink") {
    write(cwd, ".lisa/coordinate-target.json", state.manifest);
    rmSync(join(cwd, sidecar));
    symlinkSync("coordinate-target.json", join(cwd, sidecar));
  }
  state.head = commitFixture(harness, cwd);
  if (mode === "archive-worktree") write(cwd, archive, bytes);
  if (mode === "versions") {
    write(cwd, sidecar, JSON.stringify({ version: 1, entries: [] }));
    state.head = commitFixture(harness, cwd);
  }
  if (expected === 0)
    for (const [index, [file, value]] of Object.entries(fields).entries()) {
      const preimage = state.entries[index].preimage;
      provePreimage(
        harness,
        cwd,
        preimage.commit ?? state.origin,
        preimage.kind === "archive" ? preimage.path : file,
        value
      );
    }
  scanImmutableCase(harness, {
    cwd,
    name,
    expected,
    before: state.before,
    head: state.head,
    target: target(),
    legacyCommit: state.legacy?.commit,
    legacyPreimageVerified: state.legacy?.preimageVerified ?? false,
    preimagesVerified: expected === 0 ? state.entries.length : 0,
  });
};
/**
 * Execute the fixed complete matrix on the original private harness.
 * @param harness - Private bounded fixture operations
 */
export const immutableCases = harness => {
  const { group, selected } = selectImmutableCases(harness);
  for (const fixture of selected) prepareImmutableCase(harness, fixture);
  immutableNarrativeCases(harness, group);
  for (const fixture of budgetFixtures.filter(row => row[0] === group))
    runBudgetCase(harness, fixture);
};

/**
 * Validate and select the fixed immutable groups without permissive flags.
 * @param harness - Original fixture options and assertions
 * @returns Selected group and exact authored tuples
 */
const selectImmutableCases = harness => {
  const { requireFact } = harness;
  const group = harness.option("--immutable-group");
  const groups = [
    "first",
    "second",
    "third",
    "fourth",
    "fifth",
    "sixth",
    "seventh",
    "eighth",
    "ninth",
    "tenth",
    "eleventh",
  ];
  const index = groups.indexOf(group);
  for (const flag of ["--immutable-only", "--immutable-group"]) {
    const matches = harness.args.filter(arg => arg.startsWith(flag));
    requireFact(
      matches.length === 1 && matches[0] === flag,
      "Duplicate or malformed immutable selector."
    );
  }
  requireFact(
    !harness.args.some(
      arg => arg.startsWith("--portable-") || arg.startsWith("--evidence-")
    ),
    "Incompatible immutable selector."
  );
  requireFact(
    [
      ...groups,
      "narrative",
      "narrative-boundaries",
      "coexistence",
      ...budgetFixtures.map(row => row[0]),
    ].includes(group),
    "Unknown immutable control group."
  );

  return {
    group,
    selected:
      group === "coexistence"
        ? immutableFixtures.slice(44)
        : index < 0
          ? []
          : immutableFixtures.slice(index * 4, index * 4 + 4),
  };
};
