/**
 * An install may not change what a repository requires of a push.
 *
 * ## The incident
 *
 * `bun install` in a caller repo in the portfolio rewrote the checked-in
 * `.lisa.config.json`, and the rewrite ADDED `dependency-vulnerability` at
 * `push` as `required`. Same edit, byte for byte, five times over two days,
 * across four branches and four different agents. Every one of them noticed an
 * unfamiliar file in `git status` and stashed it as not-theirs — which is an
 * attention check, not a control. One routine `git add -A` would have committed
 * a change to the project's CI contract that nobody wrote and nobody reviewed.
 *
 * The direction observed was TIGHTENING, and that is the lucky case. A rewrite
 * that dropped a `required`, or demoted it, would look identical in
 * `git status`: one modified JSON file. Nothing in the signal separates
 * "postinstall tidied the file" from "postinstall weakened the gates". So the
 * rule these tests pin is about WHO ASKED, not about which way the change
 * points.
 *
 * ## What is deliberately still allowed
 *
 * Seeding itself is wanted. It is how a hardcoded fallback in a shipped hook or
 * workflow gets retired: the project declares the gate, the built-in stands
 * down, and the declaration becomes something the project can change. The
 * negative controls below fail if the fix degrades into "seeding never
 * happens" — an operator-invoked apply must still seed, into a diff that lands
 * in a reviewed commit.
 *
 * ## The second fault, which shares no cause with the first
 *
 * The same rewrite also MOVED `gates.runner` to the end of the block. Nothing
 * asked for that: the migration destructured `runner` out only to read it, and
 * the rest-spread that came with the syntax dropped the key, so the seeder
 * re-appended it. Pure churn, and it dirties a working tree and shows up as an
 * unexplained line in somebody's review.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED rather than
 * computed from the code under test.
 * @module tests/unit/migrations/seeded-gates-install-restraint
 */
import os from "node:os";
import path from "node:path";

import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ProjectType } from "../../../src/core/config.js";
import type { ILogger } from "../../../src/logging/logger.interface.js";
import { EnsureSeededGatesMigration } from "../../../src/migrations/ensure-seeded-gates.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";

const LISA_CONFIG = ".lisa.config.json";

/**
 * The gate the install added, and the moment it added it at.
 *
 * Written out rather than imported from the registry: the assertion is about
 * one specific reported edit, and deriving it from the table would make the
 * test agree with whatever that table happens to say.
 */
const ADDED_GATE = "dependency-vulnerability";
const ADDED_MOMENT = "push";

/** The only script the fixture ships, so exactly one gate is seedable. */
const SCRIPTS: Record<string, string> = {
  "security:audit": "npm audit --production --json",
  typecheck: "tsc --noEmit",
  lint: "oxlint",
};

/**
 * The consumer's config as it stood before the install, with `runner` sitting
 * where its author put it — third key in, not last.
 * @returns A fresh copy of the fixture config
 */
const fixtureConfig = (): Record<string, unknown> => ({
  harness: "fleet",
  tracker: "github",
  gates: {
    "code-style": { push: "required", "pull-request": "required" },
    runner: "bun run",
    "type-correctness": { push: "required", "pull-request": "required" },
    [ADDED_GATE]: {
      "pull-request": "required",
      "continuous:production": "required",
    },
  },
});

/** Captures every line the migration printed. */
class RecordingLogger implements ILogger {
  readonly lines: string[] = [];

  /**
   * Record an informational line.
   * @param message - Line to record
   */
  info(message: string): void {
    this.lines.push(message);
  }

  /**
   * Record a success line.
   * @param message - Line to record
   */
  success(message: string): void {
    this.lines.push(message);
  }

  /**
   * Record a warning line.
   * @param message - Line to record
   */
  warn(message: string): void {
    this.lines.push(message);
  }

  /**
   * Record an error line.
   * @param message - Line to record
   */
  error(message: string): void {
    this.lines.push(message);
  }

  /**
   * Record a dry-run line.
   * @param message - Line to record
   */
  dry(message: string): void {
    this.lines.push(message);
  }

  /**
   * Everything printed, as one searchable string.
   * @returns Joined output
   */
  get output(): string {
    return this.lines.join("\n");
  }
}

describe("gate seeding during a package manager's install", () => {
  const migration = new EnsureSeededGatesMigration();
  let tempDir: string;
  let projectDir: string;
  let lisaDir: string;
  let logger: RecordingLogger;
  let before: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-seedrestraint-"));
    lisaDir = path.join(tempDir, "lisa");
    projectDir = path.join(tempDir, "project");
    logger = new RecordingLogger();
    await fs.ensureDir(lisaDir);
    await fs.ensureDir(projectDir);
    await fs.writeJson(path.join(projectDir, "package.json"), {
      name: "demo",
      scripts: SCRIPTS,
    });
    await fs.writeJson(path.join(projectDir, LISA_CONFIG), fixtureConfig(), {
      spaces: 2,
    });
    before = await fs.readFile(path.join(projectDir, LISA_CONFIG), "utf8");
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  /**
   * Build a migration context for one apply.
   * @param postinstallSafe - Whether this apply is a package manager's install
   * @returns The context
   */
  const ctx = (postinstallSafe: boolean): MigrationContext => ({
    projectDir,
    lisaDir,
    detectedTypes: ["typescript"] as ProjectType[],
    dryRun: false,
    postinstallSafe,
    logger,
  });

  /**
   * The config file as it stands on disk.
   * @returns Raw file contents
   */
  const onDisk = async (): Promise<string> =>
    fs.readFile(path.join(projectDir, LISA_CONFIG), "utf8");

  /**
   * The parsed `gates` block on disk.
   * @returns The gates object
   */
  const gatesOnDisk = async (): Promise<Record<string, unknown>> => {
    const parsed = (await fs.readJson(
      path.join(projectDir, LISA_CONFIG)
    )) as Record<string, unknown>;
    return parsed.gates as Record<string, unknown>;
  };

  it("adds no required gate when the apply came from an install", async () => {
    // THE BITE. `dependency-vulnerability` at `push` is the exact declaration
    // the reported install added, and adding it is a change to what every
    // developer and every agent in the repository must satisfy before a push
    // is allowed to leave the machine.
    await migration.apply(ctx(true));

    const gates = await gatesOnDisk();
    const declaration = gates[ADDED_GATE] as Record<string, unknown>;
    expect(declaration[ADDED_MOMENT]).toBeUndefined();
  });

  it("leaves the file byte-for-byte untouched during that install", async () => {
    // Broader than the assertion above and deliberately so: the guard is "an
    // install writes nothing here", not "an install writes nothing to this one
    // key". A future seeder that touched a different declaration would pass
    // the first test and fail this one.
    await migration.apply(ctx(true));

    expect(await onDisk()).toBe(before);
  });

  it("names what it withheld and how to apply it deliberately", async () => {
    // A migration that just went quiet here would be this codebase's signature
    // defect — work that stops happening with nothing saying so. The install
    // has to hand the operator both halves: what was declined, and the one
    // command that applies it into a reviewable diff.
    await migration.apply(ctx(true));

    expect(logger.output).toContain(ADDED_GATE);
    expect(logger.output).toContain("npx @codyswann/lisa@latest .");
  });

  it("reports the install as skipped rather than applied", async () => {
    // The receipt and the apply summary both count on this. Recording a write
    // that did not happen is how an instrument ends up vouching for state it
    // never checked.
    const result = await migration.apply(ctx(true));

    expect(result.action).toBe("skipped");
    expect(result.changedFiles).toEqual([]);
  });

  it("still seeds that gate when an operator ran the apply", async () => {
    // The negative control the fix is judged by. "Never write" would satisfy
    // every test above and destroy the mechanism that retires a hardcoded
    // fallback. An operator-invoked apply must still declare it.
    await migration.apply(ctx(false));

    const gates = await gatesOnDisk();
    const declaration = gates[ADDED_GATE] as Record<string, unknown>;
    expect(declaration[ADDED_MOMENT]).toBe("required");
  });
});

describe("gate seeding and the keys the project already declared", () => {
  const migration = new EnsureSeededGatesMigration();
  let tempDir: string;
  let projectDir: string;
  let lisaDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-seedorder-"));
    lisaDir = path.join(tempDir, "lisa");
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(lisaDir);
    await fs.ensureDir(projectDir);
    await fs.writeJson(path.join(projectDir, "package.json"), {
      name: "demo",
      scripts: SCRIPTS,
    });
    await fs.writeJson(path.join(projectDir, LISA_CONFIG), fixtureConfig(), {
      spaces: 2,
    });
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  /**
   * Build a migration context for an operator-invoked apply.
   * @returns The context
   */
  const ctx = (): MigrationContext => ({
    projectDir,
    lisaDir,
    detectedTypes: ["typescript"] as ProjectType[],
    dryRun: false,
    postinstallSafe: false,
    logger: new RecordingLogger(),
  });

  it("leaves runner where its author declared it", async () => {
    // THE BITE for the second fault. `runner` was written second in this
    // block; seeding moved it to the end. That is a modification to a
    // checked-in file that changes no behaviour and communicates nothing, and
    // it arrives in a reviewer's diff needing an explanation nobody has.
    await migration.apply(ctx());

    const parsed = (await fs.readJson(
      path.join(projectDir, LISA_CONFIG)
    )) as Record<string, unknown>;
    const keys = Object.keys(parsed.gates as Record<string, unknown>);

    expect(keys[0]).toBe("code-style");
    expect(keys[1]).toBe("runner");
    expect(keys[2]).toBe("type-correctness");
  });

  it("keeps the runner value the project declared", async () => {
    // The guard on the non-fix: preserving the POSITION must not come at the
    // cost of preserving the VALUE. A lockfile-probing fallback that fired
    // here would rewrite a bun project's runner on a yarn machine.
    await migration.apply(ctx());

    const parsed = (await fs.readJson(
      path.join(projectDir, LISA_CONFIG)
    )) as Record<string, unknown>;
    const gates = parsed.gates as Record<string, unknown>;

    expect(gates.runner).toBe("bun run");
  });
});
