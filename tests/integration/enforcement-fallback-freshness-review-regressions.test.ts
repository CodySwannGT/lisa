/**
 * Real process controls for receipt validity and the final observed path state.
 * Filesystem observers delegate actual operations; enforcement guards are real.
 * @module tests/integration/enforcement-fallback-freshness-review-regressions
 */
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupScratchRoots,
  scratchRoot,
} from "../helpers/enforcement-fallback-fixtures.js";
import {
  currentHost,
  driveFreshness,
  hostState,
  installedChannel,
  template,
} from "../helpers/host-guard-freshness-fixtures.js";

afterEach(cleanupScratchRoots);

/** Mutate only at the final path stat; all recorded stats are actual fs stats. */
const OBSERVER = [
  'import fs from "node:fs";',
  'import { syncBuiltinESMExports } from "node:module";',
  "const stat = fs.statSync, open = fs.openSync, write = fs.writeSync;",
  'const log = open(process.env.LISA_FRESHNESS_REVIEW_TRACE, "a");',
  'const record = value => write(log, JSON.stringify(value) + "\\n");',
  'fs.openSync = (...args) => { record({event: "open", file: String(args[0])}); return open(...args); };',
  "let mutated = false;",
  "fs.statSync = (...args) => {",
  " if (!mutated && String(args[0]) === process.env.LISA_FRESHNESS_REVIEW_TARGET) {",
  "  mutated = true; const before = stat(...args);",
  "  const mode = process.env.LISA_FRESHNESS_REVIEW_MODE;",
  '  if (mode === "grow") fs.appendFileSync(args[0], "\\n# changed before final stat\\n");',
  '  if (mode === "unreadable") fs.chmodSync(args[0], 0);',
  '  if (mode === "preserved-mtime") { const bytes = fs.readFileSync(args[0]); bytes[bytes.length - 1] = bytes[bytes.length - 1] === 32 ? 10 : 32; fs.writeFileSync(args[0], bytes); fs.utimesSync(args[0], before.atime, before.mtime); }',
  "  const current = stat(...args);",
  '  record({event: "final-stat", before: {size: before.size, mode: before.mode, mtime: before.mtimeMs, ctime: before.ctimeMs}, current: {size: current.size, mode: current.mode, mtime: current.mtimeMs, ctime: current.ctimeMs}});',
  "  return current;",
  " }",
  " return stat(...args);",
  "};",
  "syncBuiltinESMExports();",
  "",
].join("\n");

/** Actual filesystem operations emitted by the diagnostic-only observer. */
interface Observation {
  readonly event: string;
  readonly file?: string;
  readonly before?: Readonly<Record<string, number>>;
  readonly current?: Readonly<Record<string, number>>;
}

/**
 * Observe only the optional diagnostic helper, preserving actual guard calls.
 * @param root Owned host/plugin fixture.
 * @param mode Final-stat mutation, or matching control.
 * @param config Optional owned plugin registry.
 * @returns Real process result and delegated filesystem observations.
 */
function observed(root: string, mode: string, config?: string) {
  const tools = scratchRoot();
  const preload = path.join(tools, "observe.mjs");
  const startup = path.join(tools, "observe.bash");
  const trace = path.join(tools, "trace.jsonl");
  /**
   * Execute only after the owned observer files and metadata exist.
   * @returns Real refusal and actual filesystem observations.
   */
  const execute = () => {
    const result = driveFreshness(root, undefined, {
      env: {
        BASH_ENV: startup,
        LISA_FRESHNESS_REVIEW_OBSERVER: preload,
        LISA_FRESHNESS_REVIEW_TRACE: trace,
        LISA_FRESHNESS_REVIEW_TARGET: template(root),
        LISA_FRESHNESS_REVIEW_MODE: mode,
        ...(config ? { CLAUDE_CONFIG_DIR: config } : {}),
      },
    });
    const operations = readFileSync(trace, "utf8")
      .trim()
      .split("\n")
      .map(line => JSON.parse(line) as Observation);
    expect(result.status).toBe(2);
    expect(result.output).toContain("Blocked: this command bypasses");
    return { ...result, operations };
  };
  writeFileSync(preload, OBSERVER);
  writeFileSync(trace, "");
  writeFileSync(
    startup,
    'node() { case "$1" in *lisa-enforcement-freshness.mjs) command node --import "$LISA_FRESHNESS_REVIEW_OBSERVER" "$@" ;; *) command node "$@" ;; esac; }\nexport -f node\n'
  );
  utimesSync(template(root), 1700000000, 1700000000);
  return execute();
}

describe("convergent review diagnostic regressions", () => {
  it.each([
    { schema_version: 999, lisa_version: "4.33.1", applied_at: "2026-09-12" },
    { schema_version: 1, lisa_version: "4.33.1" },
  ])("rejects unsupported or incomplete receipt history: %j", value => {
    const root = currentHost();
    writeFileSync(
      path.join(root, ".lisa/apply-receipt.json"),
      JSON.stringify(value)
    );
    const before = hostState(root);
    const result = driveFreshness(root);
    expect(result.status).toBe(2);
    expect(result.output).toContain("Blocked: this command bypasses");
    expect(result.output).toMatch(
      /Refused by .*block-no-verify\.sh \(matches installed template/u
    );
    expect(result.output).toContain("last applied lisa unknown");
    expect(result.output).not.toContain("npx @codyswann/lisa apply");
    expect(hostState(root)).toEqual(before);
  });

  it.each(["grow", "unreadable", "preserved-mtime", "none"])(
    "uses actual final path evidence after descriptor reads: %s",
    mode => {
      const root = currentHost();
      const result = observed(root, mode);
      const observation = result.operations.find(
        entry => entry.event === "final-stat"
      );
      expect(observation).toBeDefined();
      if (mode === "grow")
        expect(observation?.current?.size).toBeGreaterThan(
          observation?.before?.size ?? 0
        );
      if (mode === "unreadable")
        expect((observation?.current?.mode ?? 0) & 0o444).toBe(0);
      if (mode === "preserved-mtime") {
        expect(observation?.current?.size).toBe(observation?.before?.size);
        expect(observation?.current?.mtime).toBe(observation?.before?.mtime);
        expect(observation?.current?.ctime).not.toBe(
          observation?.before?.ctime
        );
      }
      expect(result.output).toMatch(
        mode === "none"
          ? /Refused by .*block-no-verify\.sh \(matches installed template/u
          : /Refused by .*block-no-verify\.sh \(host content unknown/u
      );
      expect(result.output).not.toContain("npx @codyswann/lisa apply");
    }
  );

  it("does not open host history when all selected real guards are plugin guards", () => {
    const root = currentHost();
    const plugin = path.join(root, "plugins/lisa");
    mkdirSync(plugin, { recursive: true });
    cpSync(path.join(root, "scripts/lisa-hooks"), path.join(plugin, "hooks"), {
      recursive: true,
    });
    rmSync(path.join(root, "scripts/lisa-hooks"), { recursive: true });
    mkdirSync(path.join(plugin, ".claude-plugin"));
    writeFileSync(
      path.join(plugin, ".claude-plugin/plugin.json"),
      JSON.stringify({ name: "lisa", version: "4.72.7" })
    );
    const result = observed(root, "none", installedChannel(root, "4.72.7"));
    expect(result.output).toMatch(
      /Refused by .*plugins\/lisa\/hooks\/block-no-verify\.sh/u
    );
    expect(
      result.operations.filter(
        entry =>
          entry.event === "open" &&
          entry.file === path.join(root, ".lisa/apply-receipt.json")
      )
    ).toHaveLength(0);
  });
});
