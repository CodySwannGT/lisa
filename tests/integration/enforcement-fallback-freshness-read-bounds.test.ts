/**
 * Observe actual descriptor reads and inject filesystem races at the read
 * boundary. Guard policy still executes normally; only diagnostic I/O faults.
 * @module tests/integration/enforcement-fallback-freshness-read-bounds
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupScratchRoots,
  scratchRoot,
} from "../helpers/enforcement-fallback-fixtures.js";
import {
  currentHost,
  driveFreshness,
  SELECTED_GUARDS,
  template,
} from "../helpers/host-guard-freshness-fixtures.js";

afterEach(cleanupScratchRoots);

/** Real fs operations are delegated; one owned template optionally changes. */
const OBSERVER = [
  'import fs from "node:fs";',
  'import { syncBuiltinESMExports } from "node:module";',
  "const open = fs.openSync, read = fs.readSync, write = fs.writeSync;",
  'const log = open(process.env.LISA_FRESHNESS_READ_TRACE, "a");',
  "const files = new Map(); let mutated = false;",
  'const record = value => write(log, JSON.stringify(value) + "\\n");',
  'fs.openSync = (...args) => { record({event: "open", file: String(args[0])}); const fd = open(...args); files.set(fd, String(args[0])); return fd; };',
  "fs.readSync = (...args) => {",
  " const file = files.get(args[0]);",
  " if (!mutated && file === process.env.LISA_FRESHNESS_MUTATE_FILE) {",
  "  mutated = true; const mode = process.env.LISA_FRESHNESS_MUTATE_MODE;",
  '  if (mode === "replace") { fs.writeFileSync(file + ".new", fs.readFileSync(file)); fs.renameSync(file + ".new", file); }',
  '  if (mode === "grow") fs.appendFileSync(file, Buffer.alloc(1024 * 1024 + 1));',
  '  if (mode === "error") throw Object.assign(new Error("injected read failure"), {code: "EIO"});',
  " }",
  ' const bytes = read(...args); record({event: "read", file, bytes}); return bytes;',
  "};",
  "syncBuiltinESMExports();",
  "",
].join("\n");

/**
 * Real guard semantics with comments/JSON whitespace filling specified caps.
 * @param root Owned host fixture.
 * @param config Owned Claude config fixture.
 * @param overflow Whether one pair exceeds the guard cap.
 */
function fillEvidence(root: string, config: string, overflow: boolean): void {
  for (const guard of SELECTED_GUARDS) {
    const host = path.join(root, "scripts/lisa-hooks", `${guard}.sh`);
    const original = readFileSync(host);
    const limit =
      1024 * 1024 * (overflow && guard === "block-no-verify" ? 2 : 1);
    const bytes = Buffer.concat([
      original,
      Buffer.from("\n#"),
      Buffer.alloc(limit - original.length - 3, 0x20),
      Buffer.from("\n"),
    ]);
    writeFileSync(host, bytes);
    writeFileSync(template(root, guard), bytes);
  }
  for (const [file, value, limit] of [
    [
      path.join(root, "node_modules/@codyswann/lisa/package.json"),
      { name: "@codyswann/lisa", version: "4.72.7" },
      64 * 1024,
    ],
    [
      path.join(root, ".lisa/apply-receipt.json"),
      { schema_version: 1, lisa_version: "4.33.1", applied_at: "2026-09-12" },
      64 * 1024,
    ],
    [
      path.join(root, "plugins/lisa/.claude-plugin/plugin.json"),
      { name: "lisa", version: "4.72.7" },
      64 * 1024,
    ],
    [
      path.join(
        config,
        "plugins/marketplaces/lisa/plugins/lisa/.claude-plugin/plugin.json"
      ),
      { name: "lisa", version: "4.72.7" },
      64 * 1024,
    ],
    [
      path.join(config, "plugins/installed_plugins.json"),
      {
        plugins: {
          "lisa@lisa": [
            {
              projectPath: root,
              installPath: `${config}/cache/lisa/lisa/4.72.7`,
              version: "4.72.7",
            },
          ],
        },
      },
      4 * 1024 * 1024,
    ],
  ] as const) {
    const content = Buffer.from(JSON.stringify(value));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      Buffer.concat([content, Buffer.alloc(limit - content.length, 0x20)])
    );
  }
}

/**
 * Run the actual fallback with a diagnostic-only filesystem observer.
 * @param mode Controlled mutation, or no mutation for read accounting.
 * @returns Actual refusal output and recorded descriptor operations.
 */
function observed(mode = "none"): {
  readonly output: string;
  readonly operations: readonly {
    readonly event: string;
    readonly file: string;
    readonly bytes?: number;
  }[];
} {
  const root = currentHost();
  const tools = scratchRoot();
  const preload = path.join(tools, "observe.mjs");
  const startup = path.join(tools, "observe.bash");
  const trace = path.join(tools, "reads.jsonl");
  const config = path.join(tools, "config");
  /**
   * Execute only after the owned observer files have been created.
   * @returns Process output and the actual file-I/O trace.
   */
  const execute = () => {
    const result = driveFreshness(root, undefined, {
      env: {
        BASH_ENV: startup,
        LISA_FRESHNESS_OBSERVER: preload,
        LISA_FRESHNESS_READ_TRACE: trace,
        LISA_FRESHNESS_MUTATE_FILE: mode === "none" ? "" : template(root),
        LISA_FRESHNESS_MUTATE_MODE: mode,
        ...(mode.startsWith("maximum") ? { CLAUDE_CONFIG_DIR: config } : {}),
      },
    });
    expect(result.status).toBe(2);
    expect(result.output).toContain("Blocked: this command bypasses");
    return {
      output: result.output,
      operations: readFileSync(trace, "utf8")
        .trim()
        .split("\n")
        .map(
          line =>
            JSON.parse(line) as { event: string; file: string; bytes?: number }
        ),
    };
  };
  writeFileSync(preload, OBSERVER);
  writeFileSync(
    startup,
    'node() { case "$1" in *lisa-enforcement-freshness.mjs) command node --import "$LISA_FRESHNESS_OBSERVER" "$@" ;; *) command node "$@" ;; esac; }\nexport -f node\n'
  );
  writeFileSync(trace, "");
  if (mode.startsWith("maximum"))
    fillEvidence(root, config, mode === "maximum-overflow");
  return execute();
}

describe("finite actual diagnostic file reads", () => {
  it.each(["maximum", "maximum-overflow"])(
    "bounds actual reads with %s-sized real guards and metadata",
    mode => {
      const result = observed(mode);
      const evidence = result.operations.filter(
        operation => !operation.file.endsWith("/lisa-enforcement-freshness.mjs")
      );
      const bytes = evidence.reduce(
        (total, operation) => total + (operation.bytes ?? 0),
        0
      );
      expect(bytes).toBe(
        mode === "maximum"
          ? 16 * 1024 * 1024 + 4 * 64 * 1024 + 4 * 1024 * 1024
          : 14 * 1024 * 1024 + 4 * 64 * 1024 + 4 * 1024 * 1024
      );
      expect(result.output).toMatch(
        mode === "maximum"
          ? /Refused by .*block-no-verify\.sh \(matches installed template/u
          : /Refused by .*block-no-verify\.sh \(host content unknown/u
      );
    }
  );
  it("reads only eight selected pairs and five bounded metadata paths", () => {
    const result = observed();
    // Node loads the canonical helper module after this preload; that artifact
    // read is not guard/metadata evidence. Keep it visible and separate.
    const evidence = result.operations.filter(
      operation => !operation.file.endsWith("/lisa-enforcement-freshness.mjs")
    );
    const opened = evidence.filter(operation => operation.event === "open");
    const bytes = evidence.reduce(
      (total, operation) => total + (operation.bytes ?? 0),
      0
    );
    expect(opened).toHaveLength(21);
    expect(
      opened.filter(operation => operation.file.endsWith(".sh"))
    ).toHaveLength(16);
    expect(bytes).toBeLessThanOrEqual(
      16 * (1024 * 1024 + 1) + 4 * (64 * 1024 + 1) + 4 * 1024 * 1024 + 1
    );
    expect(result.output).toMatch(
      /Refused by .*block-no-verify\.sh \(matches installed template/u
    );
  });

  it.each(["replace", "grow", "error"])(
    "reports unknown on a %s race/error and preserves real refusal",
    mode => {
      const result = observed(mode);
      expect(result.output).toMatch(
        /Refused by .*block-no-verify\.sh \(host content unknown/u
      );
      expect(result.output).not.toContain("npx @codyswann/lisa apply");
    }
  );
});
