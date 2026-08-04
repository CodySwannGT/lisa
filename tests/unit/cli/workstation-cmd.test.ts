/**
 * Tests for the workstation CLI bootstrap.
 *
 * The skill this fronts exists to prepare a machine with no coding agent and no
 * checkout — but as a skill it could only be reached by typing a slash command
 * into an agent, from a repo that had installed Lisa as a devDependency. Both
 * are the state it is supposed to create.
 *
 * So the property under test is reachability: this must run with nothing but
 * node, from anywhere, and forward what the operator typed without inventing a
 * second vocabulary for it.
 * @module tests/unit/cli/workstation-cmd
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  flagsAfterCommand,
  resolveWorkstationScript,
  runWorkstation,
} from "../../../src/cli/workstation-cmd.js";

/** The argv entries every fixture shares before the subcommand. */
const ARGV_PREFIX = ["/usr/bin/node", "/pkg/dist/index.js"];

/** Package roots created for a single test. */
const created: string[] = [];

/** Where the bootstrap script lives inside the published package. */
const SCRIPT_PATH = path.join(
  "plugins",
  "src",
  "base",
  "skills",
  "lisa-setup-workstation",
  "scripts",
  "cli.mjs"
);

/**
 * Build a throwaway package root, optionally containing the script.
 * @param withScript Whether to create the bootstrap script.
 * @returns The package root.
 */
function packageRoot(withScript: boolean): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-workstation-"));
  created.push(root);
  if (withScript) {
    const full = path.join(root, SCRIPT_PATH);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, "// bootstrap\n");
  }
  return root;
}

afterEach(() => {
  while (created.length > 0) {
    rmSync(created.pop() as string, { recursive: true, force: true });
  }
});

describe("flagsAfterCommand", () => {
  it("forwards everything typed after the subcommand", () => {
    expect(
      flagsAfterCommand([
        ...ARGV_PREFIX,
        "workstation",
        "--install",
        "--provider=bitwarden",
      ])
    ).toEqual(["--install", "--provider=bitwarden"]);
  });

  it("returns nothing when the subcommand is absent", () => {
    expect(flagsAfterCommand([...ARGV_PREFIX, "doctor"])).toEqual([]);
  });

  it("forwards an empty list when no flags follow", () => {
    expect(flagsAfterCommand([...ARGV_PREFIX, "workstation"])).toEqual([]);
  });

  it("ignores an argv[1] that happens to be named workstation", () => {
    // The search starts at index 2 so the script path cannot be mistaken for
    // the subcommand.
    expect(
      flagsAfterCommand([
        "/usr/bin/node",
        "/opt/workstation",
        "workstation",
        "--json",
      ])
    ).toEqual(["--json"]);
  });
});

describe("resolveWorkstationScript", () => {
  it("finds the script inside the installed package", () => {
    const root = packageRoot(true);
    expect(resolveWorkstationScript(root)).toBe(path.join(root, SCRIPT_PATH));
  });

  it("fails with a fix rather than a stack trace when the package is incomplete", () => {
    expect(() => resolveWorkstationScript(packageRoot(false))).toThrow(
      /npx -y @codyswann\/lisa@latest workstation/
    );
  });
});

describe("runWorkstation", () => {
  it("runs the script on the current node, not a PATH lookup", () => {
    // The bootstrap's whole premise is a machine that may have nothing on it.
    // Resolving `node` through PATH would assume the very thing in question.
    const calls: { command: string; args: string[] }[] = [];
    const root = packageRoot(true);
    runWorkstation(["--install"], {
      installPath: () => root,
      run: (command, args) => {
        calls.push({ command, args });
        return { status: 0 };
      },
    });
    expect(calls[0].command).toBe(process.execPath);
    expect(calls[0].args).toEqual([path.join(root, SCRIPT_PATH), "--install"]);
  });

  it("propagates the script's exit code", () => {
    // A bad provider or a failed install must fail the command, or a container
    // build would carry on with a machine that is not prepared.
    const root = packageRoot(true);
    const code = runWorkstation([], {
      installPath: () => root,
      run: () => ({ status: 1 }),
    });
    expect(code).toBe(1);
  });

  it("treats a script that never ran as a failure", () => {
    // spawnSync reports a null status when the process could not be spawned.
    const root = packageRoot(true);
    const code = runWorkstation([], {
      installPath: () => root,
      run: () => ({ status: null }),
    });
    expect(code).toBe(1);
  });

  it("reports an incomplete package without throwing", () => {
    const messages: string[] = [];
    const code = runWorkstation([], {
      installPath: () => packageRoot(false),
      run: () => ({ status: 0 }),
      error: message => messages.push(message),
    });
    expect(code).toBe(1);
    expect(messages.join("")).toContain("workstation script");
  });

  it("does not run the script when it cannot be found", () => {
    let ran = false;
    runWorkstation([], {
      installPath: () => packageRoot(false),
      run: () => {
        ran = true;
        return { status: 0 };
      },
      error: () => undefined,
    });
    expect(ran).toBe(false);
  });
});
