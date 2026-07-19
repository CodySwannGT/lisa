/** Cross-process contention regression tests for the learnings writer. */
import * as fs from "fs-extra";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseLearningsFile,
  type LearningEntry,
} from "../../../src/core/learnings.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const execFileAsync = promisify(execFile);
const LEARNINGS_FILENAME = "PROJECT_LEARNINGS.md";
const CROSS_PROCESS_WRITER = `
import { persistLearningEntry } from "./src/core/learnings-writer.ts";
const projectRoot = process.env.LEARNINGS_PROJECT_ROOT;
const serializedEntry = process.env.LEARNINGS_ENTRY_JSON;
if (projectRoot === undefined || serializedEntry === undefined) {
  throw new Error("Missing cross-process writer input");
}
await persistLearningEntry(projectRoot, JSON.parse(serializedEntry));
`;

/**
 * Build one compact valid entry for a child-process writer.
 * @param index - Stable numeric suffix
 * @returns Valid learning entry
 */
function numberedEntry(index: number): LearningEntry {
  return {
    id: `learning-${index}`,
    rule: `Rule ${index}.`,
    why: "Reason.",
    provenance: [`issue:#${index}`],
    first_learned: "2026-07-16",
    last_confirmed: "2026-07-16",
    confidence: "high",
  };
}

describe("learnings writer cross-process concurrency", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("serializes writers from separate processes without losing entries", async () => {
    const projectRoot = path.join(tempDir, "cross-process");
    await fs.ensureDir(projectRoot);
    const entries = Array.from({ length: 10 }, (_unused, index) =>
      numberedEntry(index)
    );
    await Promise.all(
      entries.map(entry =>
        execFileAsync("bun", ["--eval", CROSS_PROCESS_WRITER], {
          cwd: path.resolve("."),
          env: {
            ...process.env,
            LEARNINGS_PROJECT_ROOT: projectRoot,
            LEARNINGS_ENTRY_JSON: JSON.stringify(entry),
          },
        })
      )
    );
    const persisted = parseLearningsFile(
      await readFile(
        path.join(projectRoot, ".lisa", LEARNINGS_FILENAME),
        "utf8"
      )
    );
    expect(persisted.map(entry => entry.id)).toEqual(
      entries.map(entry => entry.id)
    );
  });
});
