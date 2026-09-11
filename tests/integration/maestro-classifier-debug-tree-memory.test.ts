/**
 * The classifier must survive a debug tree larger than its heap.
 *
 * `readDebugArtifacts` used to build an array holding every artifact's text at
 * once. A real iOS debug tree is 3.5 GB across 540 files — one flow's
 * `device-simulator.log` reached 235 MB — so the array exhausted V8 and the
 * classifier died with `FATAL ERROR: Reached heap limit` inside
 * `fs.readFileSync`. Measured on a 44-flow iOS leg, 2026-09-11.
 *
 * The crash was INVISIBLE, which is why it earns a test rather than a fix
 * alone: the workflow step runs the classifier under `|| true` and `exit 0` so
 * it can never fail the job (pinned by the suite beside this file), and the
 * classifier treats an absent debug tree as "no evidence". An OOM therefore
 * produces exactly the observable of a run with nothing to classify. On the
 * measured run the leg's one failure was a simulator launch failure — the
 * device fault this classifier exists to name — and it went unnamed.
 *
 * The property is memory SHAPE, not speed: peak usage must track the largest
 * single artifact rather than their sum. So the tree below is built with a sum
 * that comfortably exceeds the heap cap and a largest file that comfortably
 * fits under it, and the run is given that cap explicitly.
 *
 * The first case is the CONTROL and it must FAIL to allocate. Without it a
 * green in the second case proves nothing — it would pass just as happily if
 * the cap were loose enough to hold the whole tree, which is the exact shape of
 * a measurement that cannot fail.
 */

import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  boundedSpawnSync,
  ioLatencyBudgetMs,
} from "../helpers/io-latency-budget.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
/** Where the shipped classifier and its sibling modules live in this repo. */
const VENDORED_SCRIPTS_DIR = path.join(
  REPO_ROOT,
  "expo",
  "copy-overwrite",
  "scripts"
);
/** Name of the classifier, both in this repo and in the scratch project. */
const CLASSIFIER_FILE = "classify-maestro-failures.mjs";
const CLASSIFIER_SRC = path.join(VENDORED_SCRIPTS_DIR, CLASSIFIER_FILE);
const CLASSIFIER_DEPENDENCY_DIRS = ["lib", "bdd"];

/** Heap ceiling for the child, in MB. Must sit between FILE_MB and TREE_MB. */
const HEAP_MB = 192;
/** Size of each synthetic artifact, in MB — comfortably under the ceiling. */
const FILE_MB = 24;
/** How many artifacts to write. FILE_MB * COUNT must exceed the ceiling. */
const FILE_COUNT = 16;
/** Total tree size implied by the two above, in MB. */
const TREE_MB = FILE_MB * FILE_COUNT;

let scratch: string;
let debugRoot: string;
let reportPath: string;

/**
 * One line of filler, sized so a whole file is an exact number of megabytes.
 * ASCII on purpose: a one-byte-per-character body makes the on-disk size and
 * the in-heap string length agree, so the arithmetic above means what it says.
 */
const FILLER_LINE = `${"maestro-debug filler ".repeat(48)}\n`;

beforeAll(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-classifier-oom-"));

  // A real vendored checkout, not a stub — the classifier imports siblings and
  // would otherwise fail to start, which reads back as "found nothing".
  const scriptsDir = path.join(scratch, "scripts");
  await fs.ensureDir(scriptsDir);
  await fs.copy(CLASSIFIER_SRC, path.join(scriptsDir, CLASSIFIER_FILE));
  for (const dir of CLASSIFIER_DEPENDENCY_DIRS)
    await fs.copy(
      path.join(VENDORED_SCRIPTS_DIR, dir),
      path.join(scriptsDir, dir)
    );

  debugRoot = path.join(scratch, "maestro-debug");
  const bytesPerFile = FILE_MB * 1024 * 1024;
  const lines = Math.ceil(bytesPerFile / Buffer.byteLength(FILLER_LINE));
  const body = FILLER_LINE.repeat(lines);
  for (let index = 0; index < FILE_COUNT; index += 1) {
    const flowDir = path.join(debugRoot, `Flow ${index}`, "logs");
    await fs.ensureDir(flowDir);
    // The LAST file carries a device-fault marker, at its very end. Anything
    // that reads less than the whole tree — or truncates a file — loses it, and
    // losing it is the defect this suite exists for rather than a cosmetic
    // miss: an uncounted fault marker is a device death reported as a product
    // regression.
    const tail =
      index === FILE_COUNT - 1
        ? "maestro.android.DeviceServerDiedException: Device server died during eraseText\n"
        : "";
    await fs.writeFile(
      path.join(flowDir, "device-simulator.log"),
      `${body}${tail}`
    );
  }

  reportPath = path.join(scratch, "report.xml");
  await fs.writeFile(
    reportPath,
    `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="Test Suite" tests="1" failures="1">
    <testcase name="Flow 0" classname="Flow 0" file="flow-0.yaml" time="27">
      <failure>Assertion is false: "something" is visible</failure>
    </testcase>
  </testsuite>
</testsuites>
`
  );
}, ioLatencyBudgetMs(300_000));

afterAll(async () => {
  if (scratch) await fs.remove(scratch);
});

describe("classifier memory shape against a large debug tree", () => {
  it(
    `CONTROL: holding all ${TREE_MB} MB at once exhausts a ${HEAP_MB} MB heap`,
    () => {
      // Reproduces the OLD reading strategy — every artifact's text retained in
      // one array — so the ceiling below is demonstrably binding. If this ever
      // starts passing, the sizes have drifted and the real case beneath it has
      // stopped proving anything.
      //
      // Run one level down, inside a supervisor that exits 0 and REPORTS what
      // the eager read did. V8 aborts on heap exhaustion, so the eager process
      // dies by SIGABRT — and `boundedSpawnSync` treats a signal death as a
      // hang, correctly, because for every other caller it is one. The
      // supervisor keeps the deadline on this case while letting the crash it
      // is measuring be an ordinary observation rather than the child's own
      // fate.
      const eager = `
      import * as fs from "node:fs";
      import * as path from "node:path";
      const root = ${JSON.stringify(debugRoot)};
      const files = [];
      const walk = dir => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else files.push(full);
        }
      };
      walk(root);
      const artifacts = [];
      for (const file of files) artifacts.push({ path: file, text: fs.readFileSync(file, "utf8") });
      console.log("HELD", artifacts.length);
    `;
      const supervisor = `
      import { spawnSync } from "node:child_process";
      const outcome = spawnSync(
        process.execPath,
        ["--max-old-space-size=${HEAP_MB}", "--input-type=module", "-e", ${JSON.stringify(eager)}],
        { encoding: "utf8" }
      );
      console.log(JSON.stringify({
        status: outcome.status,
        signal: outcome.signal,
        output: \`\${outcome.stdout ?? ""}\${outcome.stderr ?? ""}\`,
      }));
    `;
      const result = boundedSpawnSync({
        label: "eager-read control supervisor",
        command: process.execPath,
        args: ["--input-type=module", "-e", supervisor],
        cwd: scratch,
        maxBuffer: 16 * 1024 * 1024,
      });

      expect(result.status, result.stderr).toBe(0);
      const eagerOutcome = JSON.parse(result.stdout) as {
        status: number | null;
        signal: string | null;
        output: string;
      };
      expect(
        eagerOutcome.status,
        "the eager read must not have completed"
      ).not.toBe(0);
      expect(eagerOutcome.output).toMatch(
        /Reached heap limit|heap out of memory/
      );
    },
    ioLatencyBudgetMs(300_000)
  );

  it(
    `reads the same ${TREE_MB} MB tree within that heap and classifies the run`,
    () => {
      const result = boundedSpawnSync({
        label: "classify-maestro-failures",
        command: process.execPath,
        args: [
          `--max-old-space-size=${HEAP_MB}`,
          path.join("scripts", CLASSIFIER_FILE),
          "--json",
          "--platform=ios",
          `--debug-output=${path.relative(scratch, debugRoot)}`,
          path.relative(scratch, reportPath),
        ],
        cwd: scratch,
      });

      expect(
        `${result.stdout}${result.stderr}`,
        "the classifier must not run out of heap"
      ).not.toMatch(/Reached heap limit|heap out of memory/);
      expect(result.status, result.stderr).toBe(0);
      // Parsed, not merely non-empty: an OOM mid-write would leave truncated
      // output that a substring check would happily accept.
      expect(() => JSON.parse(result.stdout)).not.toThrow();

      // Surviving the tree is not the same as READING it, and an exit code
      // cannot tell them apart: a classifier that skipped every artifact would
      // also exit 0 with valid JSON, and would also be immune to the heap cap.
      // The marker planted in the LAST flow's log is what separates them —
      // counting it means the read reached the far end of the tree.
      const runs = JSON.parse(result.stdout) as {
        deviceRunEvidence: {
          marker: string;
          count: number;
          artifact: string;
        }[];
      }[];
      expect(
        runs,
        "the classifier must report the one report it was given"
      ).toHaveLength(1);
      expect(
        runs[0]?.deviceRunEvidence,
        "the planted fault marker must have been counted"
      ).toContainEqual({
        marker: "DeviceServerDiedException",
        count: 1,
        artifact: "device-simulator.log",
      });
    },
    ioLatencyBudgetMs(300_000)
  );
});
