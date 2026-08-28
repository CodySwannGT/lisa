/**
 * Disposable filesystem fixtures for the trusted rollup-classifier ladder.
 * @module tests/helpers/rollup-classifier-ladder-fixtures
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Fixed suffix that a trusted plugin root may contribute. */
export const CLASSIFIER_SUFFIX = "scripts/rollup-blocker-classification.mjs";

/** Exact child graph that must cross the resolver without rewriting. */
export const EXACT_CHILD_GRAPH = `${JSON.stringify({
  container: { ref: "#3270", type: "Epic" },
  children: [
    {
      ref: "#3383",
      state: "status:blocked",
      body: "child-secret-payload",
    },
  ],
})}\n`;

/** Hidden tail that a bounded malformed-file diagnostic must redact. */
export const MALFORMED_HIDDEN_TAIL = "hidden-malformed-classifier-tail";

/** One recorded classifier invocation. */
export interface ClassifierInvocation {
  /** Fixture identity of the classifier that ran. */
  readonly id: string;
  /** Exact graph path received from the resolver. */
  readonly input: string;
  /** Exact bytes the classifier read from that path. */
  readonly payload: string;
}

/** Disposable tree used by one resolver-ladder assertion. */
export interface ClassifierTree {
  /** First trusted absolute plugin root. */
  readonly first: string;
  /** Second trusted absolute plugin root. */
  readonly second: string;
  /** First caller directory used for cwd-independence controls. */
  readonly cwdA: string;
  /** Second caller directory used for cwd-independence controls. */
  readonly cwdB: string;
  /** Exact already-materialized child graph. */
  readonly graph: string;
  /** Classifier invocation ledger. */
  readonly invocationLog: string;
  /** Root of the complete disposable tree. */
  readonly root: string;
  /** PATH directory containing fake lifecycle/comment transports. */
  readonly stubBin: string;
  /** Absolute root that is never part of the trusted ladder. */
  readonly untrusted: string;
  /** Transport invocation ledger. */
  readonly writeLog: string;
}

/** Classifier behavior planted at one candidate path. */
export type ClassifierMode =
  | "corrupt"
  | "directory"
  | "nonzero"
  | "oversized-corrupt"
  | "success"
  | "unreadable";

/**
 * Create one empty, hermetic resolver tree.
 * @returns Disposable trusted roots, recorders, and caller directories.
 */
export const createClassifierTree = (): ClassifierTree => {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-classifier-ladder-"));
  const tree = {
    first: path.join(root, "first trusted root"),
    second: path.join(root, "second trusted root"),
    cwdA: path.join(root, "caller-a"),
    cwdB: path.join(root, "nested", "caller-b"),
    graph: path.join(root, "exact-child-graph.json"),
    invocationLog: path.join(root, "classifier-invocations.jsonl"),
    root,
    stubBin: path.join(root, "stub-bin"),
    untrusted: path.join(root, "untrusted absolute root"),
    writeLog: path.join(root, "write-invocations.log"),
  } as const;

  for (const directory of [tree.cwdA, tree.cwdB, tree.stubBin]) {
    mkdirSync(directory, { recursive: true });
  }
  writeFileSync(tree.graph, EXACT_CHILD_GRAPH, { mode: 0o600 });
  writeFileSync(tree.invocationLog, "", { mode: 0o600 });
  writeFileSync(tree.writeLog, "", { mode: 0o600 });
  for (const command of ["acli", "curl", "gh"]) {
    writeFileSync(
      path.join(tree.stubBin, command),
      '#!/bin/sh\nprintf "%s\\n" "$0 $*" >> "$WRITE_LOG"\nexit 97\n',
      { mode: 0o755 }
    );
  }
  writeFileSync(
    path.join(tree.stubBin, "node"),
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} "$@"\n`,
    { mode: 0o755 }
  );
  return tree;
};

/**
 * Return the fixed classifier path below one candidate root.
 * @param root - Absolute candidate plugin root.
 * @returns Fixed rollup-classifier path below the candidate root.
 */
export const classifierAt = (root: string): string =>
  path.join(root, CLASSIFIER_SUFFIX);

/**
 * Plant one classifier-shaped filesystem object.
 * @param tree - Disposable resolver tree carrying the invocation ledger.
 * @param root - Candidate plugin root to populate.
 * @param id - Observable identity recorded when this classifier runs.
 * @param mode - Filesystem or process behavior to plant.
 * @returns Absolute fixed classifier path that was populated.
 */
export const plantClassifier = (
  tree: ClassifierTree,
  root: string,
  id: string,
  mode: ClassifierMode = "success"
): string => {
  const candidate = classifierAt(root);
  const script = [
    'import { appendFileSync, readFileSync } from "node:fs";',
    "const arg = process.argv.slice(2).find(value =>",
    '  value.startsWith("--input=")',
    ");",
    "if (!arg) process.exit(31);",
    'const input = arg.slice("--input=".length);',
    'const payload = readFileSync(input, "utf8");',
    `appendFileSync(${JSON.stringify(tree.invocationLog)},`,
    `  JSON.stringify({ id: ${JSON.stringify(id)}, input, payload }) + "\\n");`,
    mode === "nonzero"
      ? 'process.stdout.write("child-secret-payload\\n");'
      : `process.stdout.write(${JSON.stringify(`classified-by:${id}\n`)});`,
    mode === "nonzero"
      ? 'process.stderr.write("secret-env-value child-secret-payload\\n");'
      : "",
    mode === "nonzero" ? "process.exit(23);" : "",
  ]
    .filter(Boolean)
    .join("\n");
  mkdirSync(path.dirname(candidate), { recursive: true });
  if (mode === "directory") {
    mkdirSync(candidate);
    return candidate;
  }
  if (mode === "corrupt" || mode === "oversized-corrupt") {
    const hiddenTail =
      mode === "oversized-corrupt"
        ? `${"x".repeat(6_000)}${MALFORMED_HIDDEN_TAIL}\n`
        : "";
    writeFileSync(candidate, `const child-secret-payload = ;\n${hiddenTail}`, {
      mode: 0o600,
    });
    return candidate;
  }

  writeFileSync(candidate, `${script}\n`, { mode: 0o600 });
  if (mode === "unreadable") chmodSync(candidate, 0o000);
  return candidate;
};

/**
 * Plant a classifier symlink that escapes its declared trusted root.
 * @param tree - Disposable resolver tree.
 * @param trustedRoot - Declared trusted root containing the symlink.
 * @returns Absolute fixed classifier path containing the symlink.
 */
export const plantEscapingSymlink = (
  tree: ClassifierTree,
  trustedRoot: string
): string => {
  const outside = plantClassifier(tree, tree.untrusted, "symlink-target");
  const candidate = classifierAt(trustedRoot);
  mkdirSync(path.dirname(candidate), { recursive: true });
  symlinkSync(outside, candidate);
  return candidate;
};

/**
 * Plant an escaping scripts-directory symlink with a regular classifier leaf.
 * @param tree - Disposable resolver tree.
 * @param trustedRoot - Declared root whose scripts ancestor will escape.
 * @returns Absolute fixed classifier path reached through the ancestor link.
 */
export const plantEscapingScriptsSymlink = (
  tree: ClassifierTree,
  trustedRoot: string
): string => {
  plantClassifier(tree, tree.untrusted, "ancestor-symlink-target");
  mkdirSync(trustedRoot, { recursive: true });
  symlinkSync(
    path.join(tree.untrusted, "scripts"),
    path.join(trustedRoot, "scripts"),
    "dir"
  );
  return classifierAt(trustedRoot);
};

/**
 * Read every recorded classifier invocation.
 * @param tree - Disposable resolver tree carrying the invocation ledger.
 * @returns Parsed invocation records in execution order.
 */
export const readInvocations = (
  tree: ClassifierTree
): readonly ClassifierInvocation[] => {
  const body = readFileSync(tree.invocationLog, "utf8").trim();
  return body === ""
    ? []
    : body.split("\n").map(line => JSON.parse(line) as ClassifierInvocation);
};

/**
 * Read every attempted lifecycle or comment transport call.
 * @param tree - Disposable resolver tree carrying the write ledger.
 * @returns Recorded transport calls in invocation order.
 */
export const readWrites = (tree: ClassifierTree): readonly string[] => {
  const body = readFileSync(tree.writeLog, "utf8").trim();
  return body === "" ? [] : body.split("\n");
};

/**
 * Remove one disposable resolver tree.
 * @param tree - Disposable resolver tree to remove recursively.
 */
export const removeClassifierTree = (tree: ClassifierTree): void => {
  rmSync(tree.root, { force: true, recursive: true });
};
