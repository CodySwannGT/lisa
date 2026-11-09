/** Module files must reach real unchanged pre-commit tasks and their formatter. */
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";
import {
  createStagedModuleFixture,
  runStagedTool,
  stagedGit,
} from "../support/staged-module-fixture.js";

useIoLatencyBudget();

const ROOT = path.resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const LINT_STAGED = path.join(
  path.dirname(require.resolve("lint-staged/package.json")),
  "bin/lint-staged.js"
);
const PRETTIER = path.join(
  path.dirname(require.resolve("prettier/package.json")),
  "bin/prettier.cjs"
);
const PRETTIER_39 = path.join(
  path.dirname(require.resolve("prettier-compat-3-9/package.json")),
  "bin/prettier.cjs"
);
const DECLARATION = "all/copy-overwrite/scripts/lib/usage-effectiveness.d.mts";

/** Ordinary module probes and the actual managed declaration. */
type SubjectKind = "mts" | "cts" | "d.mts" | "managed-declaration";

/**
 * Prepare a real module probe or the actual managed declaration.
 * @param kind - Module/declaration boundary under test
 * @returns Subject location, bytes and fixed-point expectation
 */
function subjectFor(kind: SubjectKind): {
  readonly relative: string;
  readonly before: Buffer;
  readonly managed: boolean;
} {
  if (kind === "managed-declaration") {
    return {
      relative: "scripts/lib/usage-effectiveness.d.mts",
      before: fs.readFileSync(path.join(ROOT, DECLARATION)),
      managed: true,
    };
  }
  return {
    relative: `src/probe.${kind}`,
    before: Buffer.from(
      kind === "d.mts"
        ? "export declare const fixtureValue:{readonly value:number};\n"
        : "/** Fixture value. */\nexport const fixtureValue=1;\n"
    ),
    managed: false,
  };
}

/** Actual listr task-state event in either native renderer. */
interface TaskEvent {
  readonly state: string;
  readonly title: string;
}

/**
 * Read a native JSON renderer event without mistaking unrelated tool output.
 * @param line - One captured output line
 * @returns Actual task event when present
 */
function jsonTaskEvent(line: string): TaskEvent | undefined {
  try {
    const row = JSON.parse(line) as {
      event?: unknown;
      data?: unknown;
      task?: { title?: unknown };
    };
    if (
      row.event !== "STATE" ||
      typeof row.data !== "string" ||
      typeof row.task?.title !== "string"
    ) {
      return undefined;
    }
    return { state: row.data, title: row.task.title };
  } catch {
    return undefined;
  }
}

/**
 * Assert real command completion and sequential execution in either renderer.
 * @param output - Actual native lint-staged stdout/stderr
 * @param commands - Unchanged commands read from the actual configuration
 */
function expectTaskOrder(output: string, commands: readonly string[]): void {
  const events = output.split("\n").flatMap(line => {
    const json = jsonTaskEvent(line);
    if (json !== undefined) return [json];
    const match = /^\[(STARTED|COMPLETED)\] (.+)$/.exec(line);
    return match ? [{ state: match[1] ?? "", title: match[2] ?? "" }] : [];
  });
  const positions = commands.map(command => ({
    started: events.findIndex(
      event => event.state === "STARTED" && event.title === command
    ),
    completed: events.findIndex(
      event => event.state === "COMPLETED" && event.title === command
    ),
  }));
  for (const [index, position] of positions.entries()) {
    expect(position.started).toBeGreaterThan(
      positions[index - 1]?.completed ?? -1
    );
    expect(position.completed).toBeGreaterThan(position.started);
  }
}

describe.each(["root", "emitted"] as const)(
  "%s real staged module formatting",
  configuration => {
    for (const kind of [
      "mts",
      "cts",
      "d.mts",
      "managed-declaration",
    ] as const) {
      it(`runs all existing tasks for staged-alone ${kind}`, () => {
        const fixture = createStagedModuleFixture(configuration);
        try {
          const { managed, relative, before } = subjectFor(kind);
          const subject = path.join(fixture.directory, relative);
          fs.mkdirSync(path.dirname(subject), { recursive: true });
          fs.writeFileSync(subject, before);
          stagedGit(fixture, ["add", "--", relative]);
          const configFile = path.join(fixture.directory, ".lintstagedrc.json");
          const configBytes = fs.readFileSync(configFile);
          const config = JSON.parse(configBytes.toString()) as Record<
            string,
            readonly string[]
          >;
          const commands = Object.values(config).find(tasks =>
            tasks.some(task => task.startsWith("oxlint --fix"))
          );
          if (commands === undefined) {
            throw new Error("The real configuration has no fixer task group.");
          }
          expect(commands).toHaveLength(4);
          const check = (cli: string): number | null =>
            runStagedTool(fixture, process.execPath, [
              cli,
              "--check",
              "--config",
              ".prettierrc.json",
              relative,
            ]).status;

          expect(check(PRETTIER)).toBe(managed ? 0 : 1);
          const lint = runStagedTool(fixture, process.execPath, [LINT_STAGED]);
          const output = `${lint.stdout}${lint.stderr}`;
          expect(lint.status, output).toBe(0);
          expectTaskOrder(output, commands);
          expect(check(PRETTIER)).toBe(0);
          const after = fs.readFileSync(subject);
          expect(
            Buffer.from(stagedGit(fixture, ["show", `:${relative}`]))
          ).toEqual(after);
          expect(
            stagedGit(fixture, ["diff", "--cached", "--name-only"]).trim()
          ).toBe(relative);
          expect(fs.readFileSync(configFile)).toEqual(configBytes);
          expect(stagedGit(fixture, ["diff", "--name-only"])).toBe("");
          expect(stagedGit(fixture, ["stash", "list", "--format=%gd"])).toBe(
            ""
          );
          if (managed) {
            expect(after).toEqual(before);
            expect(check(PRETTIER_39)).toBe(0);
          } else {
            expect(after).not.toEqual(before);
          }
        } finally {
          fs.rmSync(fixture.directory, { recursive: true, force: true });
        }
      });
    }
  }
);
