/**
 * Fixture projects and a fake command runner for the session-start Lisa
 * auto-update (CodySwannGT/lisa#4337).
 *
 * The runner behaves like git, the package manager and `lisa apply` closely
 * enough that `autoUpdate` runs its real control flow over a real directory —
 * writing the installed version, the apply receipt and the pending marker to
 * disk — while nothing touches npm, a network or a real repository.
 * @module tests/helpers/auto-update-fixture
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { autoUpdate } from "../../plugins/src/base/hooks/auto-update.mjs";

/** Installed version in the fixture. */
export const OLD = "4.66.5";
/** Version npm reports. */
export const NEW = "4.68.0";
/** The package kept current. */
export const LISA = "@codyswann/lisa";
/** A feature branch. */
export const FEATURE = "feat/thing";
/** Command a full apply runs. */
export const APPLY = "node node_modules/@codyswann/lisa/dist/index.js";
/** Command prefix for a commit. */
export const COMMIT = "git commit";
/** Command prefix for a bump. */
export const BUMP = "bun add";

/** Project manifest name. */
const MANIFEST = "package.json";
/** The git control directory inside a fixture. */
const GIT_DIR = ".git";
/** Where the engine keeps its state inside the git dir. */
const STATE_DIR = "lisa";
/** The files an update changes, as `git status --porcelain` reports them. */
const CHANGED = [
  " M package.json",
  " M bun.lock",
  " M .lisa/apply-receipt.json",
];

/** How the fake environment answers. */
export interface World {
  /** `git status --porcelain` before the update. */
  readonly dirtyBefore?: string;
  /** Current branch. */
  readonly branch?: string;
  /** Subjects between the release tags (self mode). */
  readonly subjects?: readonly string[];
  /** Whether the bump actually installs the target. */
  readonly bumpWorks?: boolean;
  /** Whether `git commit` succeeds. */
  readonly commitWorks?: boolean;
  /** Whether release tags can be read (self mode); false fails log and fetch. */
  readonly tagsReadable?: boolean;
}

/**
 * Write a JSON file, creating its directory.
 * @param file - Absolute path
 * @param value - Value to serialise
 */
function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}

/**
 * The installed Lisa manifest inside a project.
 * @param root - Project root
 * @returns Absolute path
 */
function installedManifest(root: string): string {
  return path.join(root, "node_modules", "@codyswann", "lisa", MANIFEST);
}

/**
 * A fixture project with an installed Lisa and a git control directory.
 * @param options - What the project carries
 * @param options.installed - Installed Lisa version
 * @param options.config - `.lisa.config.json` contents, if any
 * @param options.self - Whether the project IS Lisa
 * @returns Absolute project root
 */
export function project(options: {
  installed?: string;
  config?: Record<string, unknown>;
  self?: boolean;
}): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-auto-update-"));
  const manifest = options.self
    ? {
        name: LISA,
        version: NEW,
        devDependencies: { [LISA]: `^${OLD}` },
        engines: { npm: "please-use-bun" },
      }
    : { name: "host", devDependencies: { [LISA]: `^${OLD}` } };
  mkdirSync(path.join(root, GIT_DIR), { recursive: true });
  writeJson(path.join(root, MANIFEST), manifest);
  writeFileSync(path.join(root, "bun.lock"), "");
  writeJson(installedManifest(root), { version: options.installed ?? OLD });
  if (options.config) {
    writeJson(path.join(root, ".lisa.config.json"), options.config);
  }
  return root;
}

/**
 * Seed a pending-update marker, as an earlier session would have left it.
 * @param root - Project root
 */
export function seedPendingMarker(root: string): void {
  writeJson(path.join(root, GIT_DIR, STATE_DIR, "pending-update.json"), {
    to: NEW,
    files: [MANIFEST],
  });
}

/**
 * Seed the per-worktree lock another live session would hold.
 * @param root - Project root
 */
export function seedLock(root: string): void {
  mkdirSync(path.join(root, GIT_DIR, STATE_DIR), { recursive: true });
  writeFileSync(path.join(root, GIT_DIR, STATE_DIR, "auto-update.lock"), "");
}

/**
 * The pending-update marker, if one was written.
 * @param root - Project root
 * @returns The parsed marker, or null
 */
export function pendingMarker(
  root: string
): { to: string; files: string[] } | null {
  const file = path.join(root, GIT_DIR, STATE_DIR, "pending-update.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

/**
 * Side effects of the commands that change the fixture on disk.
 * @param root - Project root
 * @param world - How the environment answers
 * @param argv - Command being run
 * @returns True once the command has updated the tree
 */
function applySideEffects(root: string, world: World, argv: string[]): boolean {
  if (argv[0] === "bun" && argv[1] === "add") {
    if (world.bumpWorks !== false) {
      writeJson(installedManifest(root), { version: NEW });
    }
    return true;
  }
  if (argv.join(" ").startsWith(APPLY)) {
    writeJson(path.join(root, ".lisa", "apply-receipt.json"), {
      lisa_version: NEW,
      apply_mode: "full",
    });
  }
  return false;
}

/**
 * A runner that records argv and behaves like git, bun and the apply.
 * @param root - Project root it mutates
 * @param world - How the environment answers
 * @returns The runner and the commands it saw
 */
export function fakeRunner(
  root: string,
  world: World = {}
): { run: (argv: string[]) => Promise<string>; seen: string[] } {
  const log: { current: readonly string[] } = { current: [] };
  const updated: { current: boolean } = { current: false };
  const answers: ReadonlyArray<[(line: string) => boolean, () => string]> = [
    [line => line.startsWith("git rev-parse --git-path "), () => ""],
    [
      line => line === "git status --porcelain",
      () => (updated.current ? CHANGED.join("\n") : (world.dirtyBefore ?? "")),
    ],
    [
      line => line.startsWith("git status --porcelain=v1 -z"),
      () => (updated.current ? `${CHANGED.join("\0")}\0` : ""),
    ],
    [
      line => line === "git branch --show-current",
      () => world.branch ?? FEATURE,
    ],
    [
      line => line.startsWith("git log "),
      () => (world.subjects ?? []).join("\n"),
    ],
    [line => line === "git rev-parse --short HEAD", () => "abc1234"],
  ];
  const run = async (argv: string[]): Promise<string> => {
    const line = argv.join(" ");
    log.current = [...log.current, line];
    if (line.startsWith("git rev-parse --git-path ")) {
      return path.join(root, GIT_DIR, argv[3] ?? "");
    }
    if (line.startsWith(COMMIT) && world.commitWorks === false) {
      throw new Error("commit-msg hook refused");
    }
    const tagRead = line.startsWith("git log ") || line.startsWith("git fetch");
    if (tagRead && world.tagsReadable === false) {
      throw new Error("could not read from remote repository");
    }
    updated.current = applySideEffects(root, world, argv) || updated.current;
    return answers.find(([matches]) => matches(line))?.[1]() ?? "";
  };
  return {
    run,
    get seen(): string[] {
      return [...log.current];
    },
  };
}

/**
 * Run the update the way a session start would, with npm answering `latest`.
 * @param root - Project root
 * @param world - How the environment answers
 * @param env - Process environment
 * @returns The context text and the commands run
 */
export async function sessionStart(
  root: string,
  world: World = {},
  env: NodeJS.ProcessEnv = {}
): Promise<{ text: string; seen: string[] }> {
  const runner = fakeRunner(root, world);
  const text = await autoUpdate({
    projectDir: root,
    env,
    nowMs: Date.parse("2026-10-03T12:00:00Z"),
    run: runner.run,
    refresh: async () => NEW,
  });
  return { text, seen: runner.seen };
}
