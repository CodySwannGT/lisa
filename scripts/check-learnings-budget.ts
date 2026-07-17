/** CI gate for the canonical project learnings document and its hard budgets. */
import { constants, existsSync } from "node:fs";
import { open } from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type * as LearningsModule from "@codyswann/lisa/learnings";

type LearningsCheckerModule = Pick<
  typeof LearningsModule,
  | "LEARNINGS_CONTRACT"
  | "estimateLearningTokens"
  | "parseLearningsFile"
  | "renderLearningsFile"
  | "validateLearningEntry"
>;

const DEFAULT_LEARNINGS_FILE = path.resolve(
  import.meta.dir,
  "..",
  "all",
  "create-only",
  ".claude",
  "rules",
  "PROJECT_LEARNINGS.md"
);

/** Run the package-facing checker with zero or one explicit file path. */
async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length > 1) {
    fail("Usage: bun run check:learnings-budget -- [PROJECT_LEARNINGS.md]");
  }

  const file =
    arguments_.length === 0
      ? DEFAULT_LEARNINGS_FILE
      : path.resolve(process.cwd(), arguments_[0] as string);

  try {
    const {
      LEARNINGS_CONTRACT,
      estimateLearningTokens,
      parseLearningsFile,
      renderLearningsFile,
      validateLearningEntry,
    } = await loadLearningsModule();
    const content = await readBoundedRegularFile(
      file,
      LEARNINGS_CONTRACT.maxTokens
    );
    const measuredTokens = estimateLearningTokens(content);
    if (measuredTokens > LEARNINGS_CONTRACT.maxTokens) {
      throw new Error(
        `maxTokens exceeded: measured ${measuredTokens}, allowed ${LEARNINGS_CONTRACT.maxTokens}`
      );
    }

    const entries = parseLearningsFile(content);
    for (const entry of entries) {
      validateLearningEntry(entry);
    }
    if (renderLearningsFile(entries) !== content) {
      throw new Error("non-canonical project learnings format");
    }

    console.log(
      `${formatDiagnosticPath(file)}: learnings budget passed (${entries.length}/${LEARNINGS_CONTRACT.maxEntries} entries, ${measuredTokens}/${LEARNINGS_CONTRACT.maxTokens} maxTokens)`
    );
  } catch (error) {
    fail(`${formatDiagnosticPath(file)}: ${formatErrorDetail(error)}`);
  }
}

/**
 * Render a caught failure without allowing filesystem paths or control bytes
 * embedded in an Error message to forge additional terminal/CI output.
 * @param error - Unknown thrown failure
 * @returns Stable, single-line diagnostic detail
 */
function formatErrorDetail(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const code = readOwnString(error, "code");
    if (code !== undefined && /^[A-Z][A-Z0-9_]*$/u.test(code)) {
      const syscall = readOwnString(error, "syscall");
      return syscall === undefined
        ? `filesystem error ${code}`
        : `filesystem error ${code} during ${escapeDiagnosticText(syscall)}`;
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return escapeDiagnosticText(message);
}

/** Read one inert own string property without invoking an accessor. */
function readOwnString(candidate: object, key: string): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
  return descriptor !== undefined &&
    "value" in descriptor &&
    typeof descriptor.value === "string"
    ? descriptor.value
    : undefined;
}

/** Escape terminal controls while retaining ordinary diagnostic wording. */
function escapeDiagnosticText(value: string): string {
  const jsonBody = JSON.stringify(value).slice(1, -1);
  return jsonBody.replace(
    /[\u007F-\u009F\u2028\u2029]/gu,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

/** Quote one path after applying terminal-safe JSON-style escaping. */
function formatDiagnosticPath(file: string): string {
  return `"${escapeDiagnosticText(file)}"`;
}

/**
 * Read at most one byte beyond the hard budget from one verified regular-file
 * handle. Non-blocking open prevents a FIFO path from stalling the CI gate.
 * @param file - Absolute candidate learnings path
 * @param maximumBytes - Shared executable maxTokens byte ceiling
 * @returns Strictly decoded UTF-8 content within the byte ceiling
 */
async function readBoundedRegularFile(
  file: string,
  maximumBytes: number
): Promise<string> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) {
      throw new Error("unsafe input: expected a regular file");
    }
    if (before.size > BigInt(maximumBytes)) {
      throw new Error(
        `maxTokens exceeded: measured ${before.size}, allowed ${maximumBytes}`
      );
    }

    const buffer = Buffer.allocUnsafe(maximumBytes + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const result = await handle.read(
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        null
      );
      if (result.bytesRead === 0) {
        break;
      }
      bytesRead += result.bytesRead;
    }
    if (bytesRead > maximumBytes) {
      throw new Error(
        `maxTokens exceeded: measured at least ${bytesRead}, allowed ${maximumBytes}`
      );
    }

    const after = await handle.stat({ bigint: true });
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs
    ) {
      throw new Error("unsafe input: file changed during bounded read");
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(
      buffer.subarray(0, bytesRead)
    );
  } finally {
    await handle.close();
  }
}

/**
 * Load the executable contract from current source in a checkout or compiled
 * output in an npm package. The `.js` source specifier keeps Bun development
 * runs aligned with TypeScript's NodeNext resolution while publishing no
 * runtime dependency on the excluded `src` tree.
 * @returns Canonical executable learnings module
 */
async function loadLearningsModule(): Promise<LearningsCheckerModule> {
  const packageRoot = path.resolve(import.meta.dir, "..");
  const sourceTypescript = path.join(
    packageRoot,
    "src",
    "core",
    "learnings.ts"
  );
  const runtimeRoot = path.join(
    packageRoot,
    existsSync(sourceTypescript) ? "src" : "dist",
    "core"
  );
  const [contract, document, entry] = await Promise.all([
    import(pathToFileURL(path.join(runtimeRoot, "learnings-contract.js")).href),
    import(pathToFileURL(path.join(runtimeRoot, "learnings-document.js")).href),
    import(pathToFileURL(path.join(runtimeRoot, "learnings-entry.js")).href),
  ]);
  return {
    LEARNINGS_CONTRACT: contract.LEARNINGS_CONTRACT,
    estimateLearningTokens: contract.estimateLearningTokens,
    parseLearningsFile: document.parseLearningsFile,
    renderLearningsFile: document.renderLearningsFile,
    validateLearningEntry: entry.validateLearningEntry,
  } as LearningsCheckerModule;
}

/** Print one deterministic failure diagnostic and exit non-zero. */
function fail(message: string): never {
  console.error(`check:learnings-budget: ${message}`);
  process.exit(1);
}

await main();
