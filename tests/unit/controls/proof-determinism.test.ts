/**
 * The same repository always gets the same results (CodySwannGT/lisa#4995).
 *
 * The paired-proof runner is the only code allowed to say a control works,
 * so nothing that varies may reach its results: no model, no network, no
 * clock but the one it is handed, no order but the register's. Two runs are
 * compared byte for byte with only their times set aside.
 * @module tests/unit/controls/proof-determinism
 */
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ACCEPTS_EVERYTHING,
  checks,
  F_NONE_SOURCE,
  FAILS_FOR_ANOTHER_REASON,
  proofFiles,
  proofPatches,
  provedGates,
  REJECTS_EVERYTHING,
  withoutTimes,
} from "../../helpers/control-proofs.js";
import {
  prove,
  removeCopies,
  setting,
  steppingClock,
} from "./support/proof-run.js";
import { removeFixtures } from "./support/report-check-run.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPTS = path.join(REPO_ROOT, "all", "copy-overwrite", "scripts");
const PATCHES = proofPatches("F-none", F_NONE_SOURCE);

/** One entry of every kind: passed, failed, unknown and unproved. */
const EVERY_KIND = {
  // Declared out of order on purpose: the results follow the register.
  ...provedGates(
    [{ command: FAILS_FOR_ANOTHER_REASON, name: "types" }],
    "type-correctness",
    ["push"]
  ),
  ...provedGates(
    [{ command: ACCEPTS_EVERYTHING, name: "cover" }],
    "coverage-adequacy",
    ["pull-request"]
  ),
  ...provedGates(
    [{ command: REJECTS_EVERYTHING, name: "tests" }],
    "test-correctness",
    ["push"]
  ),
  ...provedGates([{ command: checks(F_NONE_SOURCE), name: "lint" }]),
};

const FILES = {
  ...proofFiles(PATCHES, "types"),
  ...proofFiles(PATCHES, "cover"),
  ...proofFiles(PATCHES, "tests"),
  ...proofFiles(PATCHES, "lint"),
};

/** Modules that open a connection, with and without the `node:` prefix. */
const NETWORK_MODULES = new Set(
  ["dgram", "dns", "http", "http2", "https", "net", "tls"].flatMap(name => [
    name,
    `node:${name}`,
  ])
);

/** Package names a model client goes by. */
const MODEL_CLIENT =
  /anthropic|openai|bedrock|vertex|genai|ai-sdk|langchain|ollama|mistral|cohere/iu;

/** The three ways a line of code names a module it imports. */
const IMPORT_FORMS = [
  // The last line of `import … from "x";` or `export … from "x";`.
  /\bfrom ["']([^"'\n]+)["'];?$/u,
  // `import "x";`
  /^import ["']([^"'\n]+)["'];?$/u,
  // `import("x")`
  /\bimport\(["']([^"'\n]+)["']/u,
];

/**
 * The modules a file imports by a literal name.
 * @param file - Absolute path of the file
 * @returns Each name, as written
 */
function importedBy(file: string): readonly string[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .map(line => line.trim())
    .filter(line => !line.startsWith("*") && !line.startsWith("//"))
    .flatMap(line => {
      const name = IMPORT_FORMS.map(form => form.exec(line)?.[1]).find(
        found => found !== undefined
      );
      return name === undefined ? [] : [name];
    });
}

/**
 * The file a relative import leads to.
 * @param from - Absolute path of the importing file
 * @param specifier - The relative name it imports
 * @returns Absolute path of the imported file
 */
function importedFile(from: string, specifier: string): string {
  const resolved = path.resolve(path.dirname(from), specifier);
  const target = [resolved, resolved.replace(/\.js$/u, ".ts")].find(candidate =>
    existsSync(candidate)
  );
  if (target === undefined) throw new Error(`${from} imports ${specifier}`);
  return target;
}

/**
 * Every file reachable from some entry files through imports of literal
 * relative paths, and every other module name those files import.
 * @param entries - Absolute paths to start from
 * @returns The files and the module names
 */
function closure(entries: readonly string[]): {
  readonly files: readonly string[];
  readonly modules: readonly string[];
} {
  const files = new Set<string>();
  const modules = new Set<string>();
  const visit = (file: string): void => {
    if (files.has(file)) return;
    files.add(file);
    importedBy(file).forEach(specifier => {
      if (specifier.startsWith(".")) visit(importedFile(file, specifier));
      else modules.add(specifier);
    });
  };
  entries.forEach(visit);
  return { files: [...files], modules: [...modules] };
}

afterEach(() => {
  vi.restoreAllMocks();
  removeCopies();
  removeFixtures();
});

describe("two runs on the same repository", () => {
  it("give results that are identical apart from their times", async () => {
    const where = setting(EVERY_KIND, { files: FILES });
    const again = setting(EVERY_KIND, { files: FILES });

    const first = await prove(where, { clock: () => new Date() });
    const second = await prove(again, {
      clock: steppingClock("2031-05-05T05:05:05.000Z"),
    });

    expect(first.entries.map(entry => entry.outcome)).toEqual([
      "passed",
      "unproved",
      "failed",
      "unknown",
    ]);
    expect(withoutTimes(second)).toBe(withoutTimes(first));
    expect(JSON.stringify(second)).not.toBe(JSON.stringify(first));
  });

  it("list the entries in register order, whatever order they were declared in", async () => {
    const run = await prove(setting(EVERY_KIND, { files: FILES }));

    expect(run.entries.map(entry => entry.entry_id)).toEqual([
      "code-style@.",
      "coverage-adequacy@.",
      "test-correctness@.",
      "type-correctness@.",
    ]);
  });

  it("read the clock they are handed twice per half that is run, and no other", async () => {
    const readings: string[] = [];
    const clock = steppingClock();
    const run = await prove(setting(EVERY_KIND, { files: FILES }), {
      clock: () => {
        const now = clock();
        readings.push(now.toISOString());
        return now;
      },
    });
    const times = run.entries.flatMap(entry =>
      entry.halves.flatMap(half => [half.started_at, half.completed_at])
    );

    // Three entries are run, two halves each; the pull-request one is not.
    expect(readings).toHaveLength(12);
    expect(times).toEqual(readings);
  });
});

describe("what the runner is built from", () => {
  const source = closure([
    path.join(REPO_ROOT, "src", "controls", "commands", "attest.ts"),
  ]);
  const shipped = closure([
    path.join(SCRIPTS, "lisa-run-gates.mjs"),
    path.join(SCRIPTS, "lib", "gate-failure-diagnosis.mjs"),
  ]);
  const modules = [...source.modules, ...shipped.modules];
  const files = [...source.files, ...shipped.files];

  it("covers the runner, the patch handling and the gate runner it calls", () => {
    expect(files.map(file => path.basename(file))).toEqual(
      expect.arrayContaining([
        "proof-runner.ts",
        "proof-half-run.ts",
        "proof-plan.ts",
        "proof-patch.ts",
        "proof-workspace.ts",
        "proof-tools.ts",
        "lisa-run-gates.mjs",
        "process-tree-runner.mjs",
      ])
    );
  });

  it("imports no model client", () => {
    expect(modules.filter(name => MODEL_CLIENT.test(name))).toEqual([]);
  });

  it("imports nothing that opens a connection, and calls no fetch", () => {
    expect(modules.filter(name => NETWORK_MODULES.has(name))).toEqual([]);
    expect(
      files.filter(file =>
        /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/u.test(
          readFileSync(file, "utf8")
        )
      )
    ).toEqual([]);
  });

  it("opens no connection while it runs", async () => {
    const fetched = vi.spyOn(globalThis, "fetch");
    const connected = vi.spyOn(net.Socket.prototype, "connect");

    const run = await prove(setting(EVERY_KIND, { files: FILES }));

    expect(run.entries).toHaveLength(4);
    expect(fetched).not.toHaveBeenCalled();
    expect(connected).not.toHaveBeenCalled();
  });
});
