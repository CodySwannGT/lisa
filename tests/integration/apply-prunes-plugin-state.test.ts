/**
 * The Validation Journey of CodySwannGT/lisa#4645, as a test, against the
 * built CLI.
 *
 * A host that applied Lisa in March 2026 still enables the retired
 * `typescript@lisa` next to its successor, and Claude Code's registry still
 * holds a Lisa registration for a worktree that was deleted. Before the fix
 * every apply tried, and failed, to install `typescript@lisa`, and the dead
 * registration was never looked at.
 *
 * The `claude` on PATH is a stub that keeps a registry in a JSON file and
 * applies `install` / `uninstall` to it relative to its own working directory,
 * exactly as the real CLI does — so the test can see which path each uninstall
 * ran from, and a second apply sees the state the first one left.
 * @module tests/integration/apply-prunes-plugin-state
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../helpers/test-utils.js";
import { resolveGit } from "../support/git-executable.js";

useIoLatencyBudget();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DIST_CLI = path.join(REPO_ROOT, "dist", "index.js");
const GIT = resolveGit();
const LISA = "lisa@lisa";
const OTHER = "foo@other";
const RETIRED = "typescript@lisa";

/** Stub `claude`: a JSON-file registry that acts on its working directory. */
const STUB_SOURCE = `
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const [, , ...args] = process.argv;
const state = process.env.STUB_STATE;
const read = () => JSON.parse(readFileSync(state, "utf8"));
const write = value => writeFileSync(state, JSON.stringify(value));
appendFileSync(process.env.STUB_LOG, JSON.stringify({ cwd: process.cwd(), args }) + "\\n");
const [first, verb, id] = args;
if (first === "--version") process.stdout.write("0.0.0 (stub)\\n");
else if (first === "plugin" && verb === "list") process.stdout.write(JSON.stringify(read()));
else if (first === "plugin" && verb === "uninstall")
  write(read().filter(e => !(e.id === id && e.projectPath === process.cwd())));
else if (first === "plugin" && verb === "install") {
  const registry = read();
  if (!registry.some(e => e.id === id && e.projectPath === process.cwd()))
    write([...registry, { id, scope: "project", projectPath: process.cwd() }]);
}
`;

/** One recorded stub call. */
interface StubCall {
  readonly cwd: string;
  readonly args: readonly string[];
}

/** Paths of one scratch fixture. */
interface Fixture {
  readonly root: string;
  readonly host: string;
  readonly bin: string;
  readonly home: string;
  readonly state: string;
  readonly log: string;
  readonly deadTop: string;
  readonly dead: string;
  readonly live: string;
  readonly deadOther: string;
}

/**
 * Build the scratch host, stub CLI and seeded registry.
 * @param root - Owned temp directory
 * @returns Fixture paths
 */
function createFixture(root: string): Fixture {
  const fixture: Fixture = {
    root,
    host: path.join(root, "host"),
    bin: path.join(root, "bin"),
    home: path.join(root, "home"),
    state: path.join(root, "registry.json"),
    log: path.join(root, "claude-calls.jsonl"),
    deadTop: path.join(root, "dead-wt"),
    dead: path.join(root, "dead-wt", "nested"),
    live: path.join(root, "live-wt"),
    deadOther: path.join(root, "dead-other"),
  };
  for (const dir of [
    path.join(fixture.host, ".claude"),
    fixture.bin,
    path.join(fixture.home, ".claude"),
    fixture.live,
  ]) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path.join(fixture.bin, "claude-stub.mjs"), STUB_SOURCE);
  writeFileSync(
    path.join(fixture.bin, "claude"),
    `#!/bin/sh\nexec '${process.execPath}' '${path.join(fixture.bin, "claude-stub.mjs")}' "$@"\n`
  );
  chmodSync(path.join(fixture.bin, "claude"), 0o755);
  writeFileSync(
    path.join(fixture.host, "package.json"),
    JSON.stringify({
      name: "scratch-host",
      version: "1.0.0",
      private: true,
      type: "module",
      devDependencies: { typescript: "^5.0.0" },
    })
  );
  writeFileSync(
    path.join(fixture.host, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true } })
  );
  writeFileSync(
    path.join(fixture.host, ".claude", "settings.json"),
    JSON.stringify({
      enabledPlugins: {
        [RETIRED]: true,
        "lisa-typescript@lisa": true,
        [OTHER]: true,
      },
    })
  );
  for (const args of [
    ["init", "-q"],
    ["add", "-A"],
    [
      "-c",
      "user.email=t@example.invalid",
      "-c",
      "user.name=t",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "init",
    ],
  ]) {
    boundedSpawnSync({
      label: `git ${args.join(" ")}`,
      command: GIT,
      args,
      cwd: fixture.host,
    });
  }
  writeFileSync(
    fixture.state,
    JSON.stringify([
      { id: LISA, scope: "project", projectPath: fixture.dead },
      { id: LISA, scope: "project", projectPath: fixture.live },
      { id: OTHER, scope: "project", projectPath: fixture.deadOther },
    ])
  );
  return fixture;
}

/**
 * Run the built `lisa apply` against the host with the stub first on PATH.
 * @param fixture - Fixture paths
 * @param run - Run number; each run logs its stub calls to its own file
 * @returns Combined output, and the stub calls this run made
 */
function apply(
  fixture: Fixture,
  run: number
): {
  readonly output: string;
  readonly calls: readonly StubCall[];
} {
  const log = `${fixture.log}.${run}`;
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
    ),
    PATH: `${fixture.bin}${path.delimiter}${process.env.PATH ?? ""}`,
    HOME: fixture.home,
    CLAUDE_CONFIG_DIR: path.join(fixture.home, ".claude"),
    LISA_BOOTSTRAP: "1",
    LISA_SKIP_UPDATE_CHECK: "1",
    STUB_STATE: fixture.state,
    STUB_LOG: log,
  };
  const result = boundedSpawnSync({
    label: "lisa apply (scratch host)",
    command: process.execPath,
    args: [
      DIST_CLI,
      "--no-update-check",
      "apply",
      "--yes",
      "--harness",
      "claude",
      "--skip-git-check",
      fixture.host,
    ],
    // Measured: ~0.85 s per apply on a quiet box; the ceiling the case's own
    // margin guard admits is 30 s.
    baseMs: 30_000,
    cwd: fixture.host,
    env,
  });
  const calls = existsSync(log)
    ? readFileSync(log, "utf8")
        .split("\n")
        .filter(Boolean)
        .map(line => JSON.parse(line) as StubCall)
    : [];
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  return { output: `${result.stdout}\n${result.stderr}`, calls };
}

/**
 * The uninstall calls in a run.
 * @param calls - Stub calls
 * @returns Only the uninstalls
 */
function uninstalls(calls: readonly StubCall[]): readonly StubCall[] {
  return calls.filter(call => call.args[1] === "uninstall");
}

describe("lisa apply prunes retired plugin keys and dead registrations (#4645)", () => {
  let root: string;
  let fixture: Fixture;

  beforeEach(async () => {
    root = await createTempDir();
    fixture = createFixture(root);
  });

  afterEach(async () => {
    await cleanupTempDir(root);
  });

  it("removes typescript@lisa, uninstalls only the dead Lisa registration from its path, and settles", () => {
    const first = apply(fixture, 1);

    expect(first.output).toContain(`Removed retired plugin key: ${RETIRED}`);
    const enabled = (
      JSON.parse(
        readFileSync(
          path.join(fixture.host, ".claude", "settings.json"),
          "utf8"
        )
      ) as { enabledPlugins: Record<string, boolean> }
    ).enabledPlugins;
    expect(enabled).not.toHaveProperty([RETIRED]);
    expect(enabled["lisa-typescript@lisa"]).toBe(true);
    expect(enabled[OTHER]).toBe(true);

    expect(uninstalls(first.calls)).toEqual([
      {
        cwd: fixture.dead,
        args: [
          "plugin",
          "uninstall",
          LISA,
          "--scope",
          "project",
          "--keep-data",
        ],
      },
    ]);
    expect(first.output).toContain("Pruned 1 Lisa plugin registration");
    expect(first.calls.some(call => call.args.includes(RETIRED))).toBe(false);
    // The recreated path, and every directory above it this run created, is
    // gone again.
    expect(existsSync(fixture.deadTop)).toBe(false);

    const registry = JSON.parse(readFileSync(fixture.state, "utf8")) as {
      id: string;
      projectPath: string;
    }[];
    expect(
      registry.some(e => e.id === LISA && e.projectPath === fixture.dead)
    ).toBe(false);
    expect(
      registry.some(e => e.id === LISA && e.projectPath === fixture.live)
    ).toBe(true);
    expect(
      registry.some(e => e.id === OTHER && e.projectPath === fixture.deadOther)
    ).toBe(true);

    const second = apply(fixture, 2);
    expect(uninstalls(second.calls)).toEqual([]);
    expect(second.output).not.toContain("Removed retired plugin key");
    expect(second.output).not.toContain("Pruned");
    expect(second.output).not.toContain(RETIRED);
  });
});
