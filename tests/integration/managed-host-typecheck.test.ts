/** Exercise the shipped NestJS and CDK typecheck commands with real Vitest types. */
import * as fs from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import { linkPackage } from "../support/borrowed-node-modules.mjs";

useIoLatencyBudget();
const root = path.resolve(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);
const tsc = require.resolve("typescript/bin/tsc");
const TYPECHECK_CLI = "scripts/lisa-typecheck.mjs";
const directories: string[] = [];
const mockFixture = `import { vi } from 'vitest';
export const mock = vi.fn();
export const spy = vi.spyOn({ lookup: () => 42 }, 'lookup');
`;
const declarationError = /TS2883.*Procedure/u;

afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

/**
 * Read a shipped package script layer.
 * @param stack - Lisa template directory.
 * @returns Managed scripts and defaults in this layer.
 */
function scripts(stack: string): Record<string, string> {
  const manifest = fs.readFileSync(
    path.join(root, stack, "package-lisa/package.lisa.json"),
    "utf8"
  );
  const layer = JSON.parse(manifest) as {
    defaults?: { scripts?: Record<string, string> };
    force?: { scripts?: Record<string, string> };
  };
  return { ...layer.defaults?.scripts, ...layer.force?.scripts };
}

/**
 * Assemble an owned project from the shipped configs and installed compiler.
 * @param stack - Lisa template directory.
 * @param sourceFolder - Included source folder for the mock fixture.
 * @returns Fixture paths.
 */
function host(stack: string, sourceFolder: string) {
  const cwd = fs.mkdtempSync(path.join(tmpdir(), "lisa-managed-typecheck-"));
  const fixture = path.join(cwd, sourceFolder, "inferred-fixture.ts");
  directories.push(cwd);
  fs.mkdirSync(path.dirname(fixture), { recursive: true });
  fs.mkdirSync(path.join(cwd, "scripts/lib"), { recursive: true });
  fs.writeFileSync(fixture, mockFixture);
  fs.writeFileSync(
    path.join(cwd, "package.json"),
    JSON.stringify({ scripts: { ...scripts("typescript"), ...scripts(stack) } })
  );
  for (const [source, destination] of [
    [`${stack}/copy-overwrite/tsconfig.json`, "tsconfig.json"],
    [`${stack}/create-only/tsconfig.local.json`, "tsconfig.local.json"],
    [`typescript/copy-overwrite/${TYPECHECK_CLI}`, TYPECHECK_CLI],
    [
      "all/copy-overwrite/scripts/lib/worktree-dependencies.mjs",
      "scripts/lib/worktree-dependencies.mjs",
    ],
    [
      "all/copy-overwrite/scripts/lib/invoked-as-script.mjs",
      "scripts/lib/invoked-as-script.mjs",
    ],
  ] as const)
    fs.copyFileSync(path.join(root, source), path.join(cwd, destination));
  linkPackage(root, cwd, "@codyswann/lisa");
  for (const dependency of ["typescript", "vitest", "@types/node"])
    linkPackage(
      path.dirname(require.resolve(`${dependency}/package.json`)),
      cwd,
      dependency
    );
  return { cwd, fixture };
}

/**
 * Run a real compiler or package command in a fixture.
 * @param cwd - Fixture root.
 * @param command - Executable to start.
 * @param args - Forwarded arguments.
 * @returns Exit status and captured output.
 */
function run(cwd: string, command: string, ...args: string[]) {
  const child = boundedSpawnSync({ label: args.join(" "), command, args, cwd });
  return { status: child.status, output: `${child.stdout}${child.stderr}` };
}

describe.each([
  { stack: "nestjs", source: "src/testing", script: "typecheck" },
  { stack: "cdk", source: "test", script: "build" },
])("$stack managed typecheck", ({ stack, source, script }) => {
  it("checks inferred Vitest mocks and still reports ordinary type errors", () => {
    const { cwd, fixture } = host(stack, source);
    const before = run(
      cwd,
      process.execPath,
      tsc,
      "--noEmit",
      "--pretty",
      "false"
    );
    expect(before.output).toMatch(declarationError);
    expect(before.status).not.toBe(0);

    const checked = run(cwd, "bun", "run", script);
    expect(checked.status, checked.output).toBe(0);
    expect(fs.existsSync(fixture.replace(/\.ts$/u, ".js"))).toBe(false);

    fs.appendFileSync(fixture, "export const invalid: number = 'bad';\n");
    const invalid = run(cwd, "bun", "run", script);
    expect(invalid.output).toContain("TS2322");
    expect(invalid.status).not.toBe(0);
  });
});

it("preserves an explicit declaration check and production declaration output", () => {
  const { cwd, fixture } = host("nestjs", "src/testing");
  const explicit = run(
    cwd,
    process.execPath,
    TYPECHECK_CLI,
    "--declaration",
    "--pretty",
    "false"
  );
  expect(explicit.output).toMatch(declarationError);
  expect(explicit.status).not.toBe(0);

  fs.writeFileSync(fixture, "export const health = (): boolean => true;\n");
  fs.copyFileSync(
    path.join(root, "nestjs/copy-overwrite/tsconfig.build.json"),
    path.join(cwd, "tsconfig.build.json")
  );
  const build = run(
    cwd,
    process.execPath,
    tsc,
    "--project",
    "tsconfig.build.json",
    "--emitDeclarationOnly"
  );
  expect(build.status, build.output).toBe(0);
  expect(
    fs.readFileSync(
      path.join(cwd, ".build/testing/inferred-fixture.d.ts"),
      "utf8"
    )
  ).toContain("export declare const health: () => boolean;");
});

it("retains declaration checks in an explicitly selected composite project", () => {
  const { cwd } = host("cdk", "test");
  fs.writeFileSync(
    path.join(cwd, "tsconfig.composite.json"),
    JSON.stringify({
      extends: "./tsconfig.json",
      compilerOptions: { composite: true },
    })
  );
  const checked = run(
    cwd,
    process.execPath,
    TYPECHECK_CLI,
    "--project",
    "tsconfig.composite.json",
    "--pretty",
    "false"
  );
  expect(checked.output).toMatch(declarationError);
  expect(checked.status).not.toBe(0);
});
