/** Preserve the entire published readonly contract independently of its formatting. */
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import { cleanupTempDir } from "../helpers/test-utils.js";

useIoLatencyBudget();
const ROOT = path.resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const TSC = path.join(
  path.dirname(require.resolve("typescript/package.json")),
  "bin/tsc"
);
const DECLARATION = path.join(
  ROOT,
  "all/copy-overwrite/scripts/lib/usage-effectiveness.d.mts"
);
const ATTENTION =
  "  readonly attention: readonly { readonly id: string; readonly source: string }[] | null;";

// The original public API, not a snapshot generated from the implementation.
// Equivalent spellings such as ReadonlyArray must remain interchangeable.
const REFERENCE = `export interface EffectivenessObservation {
  readonly schema: 1;
  readonly lisaVersion: string | null;
  readonly workerConfigRevision: string | null;
  readonly workerWallMs: number | null;
  readonly feedbackMs: readonly number[] | null;
  readonly workerSource: string | null;
${ATTENTION}
  readonly readyAt: string | null;
  readonly acceptedAt: string | null;
  readonly lifecycleSources: readonly string[] | null;
  readonly reworkSources: readonly string[] | null;
}
export declare function isEvidenceString(value: unknown): value is string;
export declare function isEvidenceTime(value: unknown): value is string;
export declare function parseEffectiveness(value: unknown): EffectivenessObservation;
export declare function parseEffectivenessTokens(section: string): ReadonlyMap<string, EffectivenessObservation>;
`;
const PROOF = `import type * as Actual from "./actual.mjs";
import type * as Reference from "./reference.mjs";
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Value extends true> = Value;
type ObservationContract = Assert<Equal<
  Actual.EffectivenessObservation, Reference.EffectivenessObservation
>>;
type AttentionContract = Assert<Equal<
  Actual.EffectivenessObservation["attention"],
  Reference.EffectivenessObservation["attention"]
>>;
type FunctionContracts = Assert<Equal<
  [typeof Actual.isEvidenceString, typeof Actual.isEvidenceTime,
   typeof Actual.parseEffectiveness, typeof Actual.parseEffectivenessTokens],
  [typeof Reference.isEvidenceString, typeof Reference.isEvidenceTime,
   typeof Reference.parseEffectiveness, typeof Reference.parseEffectivenessTokens]
>>;
`;

/**
 * Ask the actual strict NodeNext compiler about the public module contract.
 * @param directory - Owned isolated declaration fixture
 * @returns The real compiler process result
 */
function compile(directory: string): ReturnType<typeof boundedSpawnSync> {
  return boundedSpawnSync({
    label: "strict public usage-effectiveness API equivalence",
    command: process.execPath,
    args: [TSC, "--project", path.join(directory, "tsconfig.json")],
    cwd: directory,
    baseMs: 30_000,
  });
}

describe("published usage-effectiveness public API", () => {
  it("preserves the complete readonly interface and every existing function signature", async () => {
    const original = fs.readFileSync(DECLARATION);
    const directory = fs.mkdtempSync(
      path.join(tmpdir(), "usage-effectiveness-api-")
    );
    try {
      const actual = path.join(directory, "actual.d.mts");
      fs.writeFileSync(actual, original);
      fs.writeFileSync(path.join(directory, "reference.d.mts"), REFERENCE);
      fs.writeFileSync(path.join(directory, "contract.mts"), PROOF);
      fs.writeFileSync(
        path.join(directory, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            strict: true,
            noEmit: true,
            types: [],
          },
          files: ["contract.mts"],
        })
      );
      const positive = compile(directory);
      expect(positive.error).toBeUndefined();
      expect(positive.signal).toBeNull();
      expect(positive.status, `${positive.stdout}${positive.stderr}`).toBe(0);

      // Mutate only an owned copy. The same independent proof must refuse an
      // array that has become mutable, including its containing return types.
      const mutable = REFERENCE.replace(
        ATTENTION,
        ATTENTION.replace(": readonly {", ": {")
      );
      expect(mutable).not.toBe(REFERENCE);
      fs.writeFileSync(actual, mutable);
      const negative = compile(directory);
      const diagnostics = `${negative.stdout}${negative.stderr}`;
      expect(negative.error).toBeUndefined();
      expect(negative.signal).toBeNull();
      expect(negative.status, diagnostics).toBeGreaterThan(0);
      expect(diagnostics).toContain("contract.mts(");
      expect(diagnostics).toContain("error TS2344:");
      expect(diagnostics.match(/error TS2344:/g)).toHaveLength(3);
      expect(diagnostics).toContain("Type 'false' does not satisfy");
      expect(diagnostics).not.toContain("error TS2307:");
      expect(fs.readFileSync(DECLARATION)).toEqual(original);
    } finally {
      await cleanupTempDir(directory);
    }
  });
});
