/**
 * A real rollback against a local registry, with the real `npm` (#4605).
 *
 * The unit suite proves the command's decisions with an injected runner. This
 * suite proves the part an injected runner cannot: that the argv the command
 * hands `npm` really deprecates a version and really moves `latest`, and that
 * the read-back the command trusts sees both. `npm` is the real binary on PATH,
 * talking to a loopback registry that accepts writes; `gh` is a recorded stub,
 * because a real one would edit a real GitHub release.
 *
 * Isolation is the point of the setup, not a nicety. The child gets its own
 * npmrc through `NPM_CONFIG_USERCONFIG`, an empty global config, its own cache
 * and a scratch working directory, and every inherited `npm_config_*` variable
 * is dropped — so the operator's own `~/.npmrc`, and any token in it, are never
 * read, and nothing can reach the public registry.
 *
 * Expected values are HARDCODED, per the Test Isolation house rule.
 * @module tests/integration/lisa-rollback-release
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  startWritableRegistry,
  type WritableRegistry,
} from "../fixtures/release-rollback/writable-registry.js";
import { run } from "../fixtures/shared-runtime-hosts/process.js";

const SCRIPT = path.join(process.cwd(), "scripts/lisa-rollback-release.mjs");
const TOKEN = "fake-test-token";
const GH_LOG = "gh-calls.jsonl";
const ORIGINAL_NOTES = "## 4.90.1\n\n- the change that broke apply";
const NOTICE =
  "> **This release is deprecated:** breaks apply\n>\n> npm latest now points to 4.90.0.\n";

/** One sandbox: a registry, a stub `gh`, an isolated npm config. */
interface Sandbox {
  readonly dir: string;
  readonly registry: WritableRegistry;
  readonly env: NodeJS.ProcessEnv;
}

/**
 * Write the recorded `gh` stub.
 * @param bin - Directory placed first on PATH
 */
function writeGhStub(bin: string): void {
  const stub = [
    `#!${process.execPath}`,
    'const fs = require("node:fs");',
    "const args = process.argv.slice(2);",
    'fs.appendFileSync(process.env.GH_STUB_LOG, JSON.stringify(args) + "\\n");',
    'if (args[0] === "release" && args[1] === "view") {',
    "  process.stdout.write(JSON.stringify({ body: process.env.GH_STUB_BODY }));",
    '} else if (args[0] === "release" && args[1] === "edit") {',
    '  const file = args[args.indexOf("--notes-file") + 1];',
    "  fs.copyFileSync(file, process.env.GH_STUB_NOTES);",
    "}",
  ].join("\n");
  fs.writeFileSync(path.join(bin, "gh"), `${stub}\n`, { mode: 0o755 });
}

/**
 * The child environment: inherited, minus every npm setting, plus ours.
 * @param dir - Sandbox root
 * @returns Environment for the rollback command
 */
function childEnv(dir: string): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !/^(npm_config_|NPM_TOKEN$|NODE_AUTH_TOKEN$|LISA_NPM_REGISTRY$|GH_|GITHUB_TOKEN$)/i.test(
          name
        )
    )
  );
  return {
    ...inherited,
    PATH: `${path.join(dir, "bin")}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}${process.env["PATH"] ?? ""}`,
    NPM_CONFIG_USERCONFIG: path.join(dir, "npmrc"),
    NPM_CONFIG_GLOBALCONFIG: path.join(dir, "global-npmrc"),
    NPM_CONFIG_CACHE: path.join(dir, "npm-cache"),
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
    GH_STUB_LOG: path.join(dir, GH_LOG),
    GH_STUB_BODY: ORIGINAL_NOTES,
    GH_STUB_NOTES: path.join(dir, "edited-notes.md"),
  };
}

/**
 * Build a sandbox, with or without an npm token.
 * @param withToken - Whether the npmrc carries the registry token
 * @returns The sandbox
 */
async function sandbox(withToken: boolean): Promise<Sandbox> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-rollback-it-"));
  const registry = await startWritableRegistry({
    versions: ["4.90.0", "4.90.1"],
    latest: "4.90.1",
    token: TOKEN,
    username: "release-owner",
  });
  const auth = withToken ? `${registry.origin}:_authToken=${TOKEN}\n` : "";
  ["bin", "logs", "work", "npm-cache"].forEach(sub =>
    fs.mkdirSync(path.join(dir, sub))
  );
  fs.writeFileSync(
    path.join(dir, "npmrc"),
    `registry=${registry.url}/\n${auth}`
  );
  fs.writeFileSync(path.join(dir, "global-npmrc"), "");
  fs.writeFileSync(path.join(dir, GH_LOG), "");
  writeGhStub(path.join(dir, "bin"));
  return { dir, registry, env: childEnv(dir) };
}

/**
 * Run the rollback command and return its combined output.
 * @param box - The sandbox
 * @param label - Log name
 * @param extra - Extra flags
 * @returns Exit outcome and output
 */
async function rollback(
  box: Sandbox,
  label: string,
  extra: readonly string[]
): Promise<{ readonly ok: boolean; readonly output: string }> {
  const args = [
    SCRIPT,
    "--bad",
    "4.90.1",
    "--reason",
    "breaks apply",
    "--registry",
    box.registry.url,
    ...extra,
  ];
  const logs = path.join(box.dir, "logs");
  const ok = await run(
    process.execPath,
    args,
    path.join(box.dir, "work"),
    box.env,
    logs,
    label,
    60_000
  ).then(
    () => true,
    () => false
  );
  return {
    ok,
    output: fs.readFileSync(path.join(logs, `${label}.log`), "utf8"),
  };
}

/**
 * The `gh` calls the stub recorded.
 * @param box - The sandbox
 * @returns Each call's argv
 */
function ghCalls(box: Sandbox): string[][] {
  return fs
    .readFileSync(path.join(box.dir, GH_LOG), "utf8")
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line) as string[]);
}

/**
 * Registry writes the registry saw.
 * @param box - The sandbox
 * @returns Every PUT request
 */
const writesSeen = (box: Sandbox) =>
  box.registry.requests().filter(request => request.method === "PUT");

let box: Sandbox | undefined;

afterEach(async () => {
  await box?.registry.close();
  if (box) fs.rmSync(box.dir, { recursive: true, force: true });
  box = undefined;
});

describe("with credentials present", () => {
  beforeEach(async () => {
    box = await sandbox(true);
  });

  it("a dry run prints the three commands with 4.90.0 and changes nothing", async () => {
    const result = await rollback(box!, "dry-run", ["--dry-run"]);

    expect(result.ok).toBe(true);
    expect(result.output).toContain(
      `npm deprecate --registry ${box!.registry.url} -- @codyswann/lisa@4.90.1 'breaks apply'`
    );
    expect(result.output).toContain(
      `npm dist-tag add @codyswann/lisa@4.90.0 latest --registry ${box!.registry.url}`
    );
    expect(result.output).toContain("gh release edit v4.90.1");
    expect(writesSeen(box!)).toEqual([]);
    expect(ghCalls(box!)).toEqual([]);
    expect(box!.registry.packument()["dist-tags"].latest).toBe("4.90.1");
    expect(box!.registry.packument().versions["4.90.1"]?.deprecated).toBe(
      undefined
    );
  });

  it("a real run deprecates 4.90.1, moves latest to 4.90.0 and verifies", async () => {
    const result = await rollback(box!, "real-run", []);

    expect(result.output).toContain(
      "Verified: 4.90.1 is deprecated and latest is 4.90.0."
    );
    expect(result.ok).toBe(true);
    const packument = box!.registry.packument();
    expect(packument.versions["4.90.1"]?.deprecated).toBe("breaks apply");
    expect(packument.versions["4.90.0"]?.deprecated).toBe(undefined);
    expect(packument["dist-tags"].latest).toBe("4.90.0");
    const notes = fs.readFileSync(
      path.join(box!.dir, "edited-notes.md"),
      "utf8"
    );
    expect(notes.startsWith(NOTICE)).toBe(true);
    expect(notes).toContain(ORIGINAL_NOTES);
    // The read-back that decided exit 0 asked the uncached packument.
    expect(
      box!.registry
        .requests()
        .some(
          r => r.method === "GET" && r.path === "/@codyswann%2flisa?write=true"
        )
    ).toBe(true);
  });

  it("passes a reason that starts with -- to npm as the message, not as an option", async () => {
    const reason = "--dry-run breaks apply";
    const result = await rollback(box!, "dash-reason", ["--reason", reason]);

    expect(result.output).toContain(
      "Verified: 4.90.1 is deprecated and latest is 4.90.0."
    );
    expect(result.ok).toBe(true);
    expect(box!.registry.packument().versions["4.90.1"]?.deprecated).toBe(
      reason
    );
  });
});

describe("without an npm token", () => {
  beforeEach(async () => {
    box = await sandbox(false);
  });

  it("refuses before any write, naming the missing npm sign-in", async () => {
    const result = await rollback(box!, "no-npm-auth", []);

    expect(result.ok).toBe(false);
    expect(result.output).toContain("You are not signed in to npm");
    expect(result.output).toContain("Nothing was changed");
    expect(writesSeen(box!)).toEqual([]);
    expect(ghCalls(box!).some(args => args[1] === "edit")).toBe(false);
    expect(box!.registry.packument()["dist-tags"].latest).toBe("4.90.1");
    expect(box!.registry.packument().versions["4.90.1"]?.deprecated).toBe(
      undefined
    );
  });
});
