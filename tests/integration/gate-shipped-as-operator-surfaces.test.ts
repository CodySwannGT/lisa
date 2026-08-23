/**
 * The operator surfaces stop hiding the prover the project already ships.
 *
 * `shippedAs` recorded, per gate, that a template installs a working prover
 * under a vendor's name. Measured on `main` @ `eb9dee054`, no operator surface
 * read it: `list` printed the concern name, `validate` printed `configuration
 * is valid` for a gate that resolved to a script the project does not have,
 * and the only way to learn the alias existed was to open the registry source.
 *
 * These tests spawn the real CLI in a throwaway project, because the question
 * is what an operator sees, and only a process answers that. The two controls
 * matter as much as the two substitutions:
 *
 * - a project whose manifest cannot be read gets exactly today's output, since
 *   an unknown manifest must never be reported as a missing script;
 * - `validate` still exits 0. Naming a gap is advisory; turning a gap into a
 *   blocking failure would red-wall every consumer on upgrade, which is a
 *   scope this issue did not authorise.
 * @module tests/integration/gate-shipped-as-operator-surfaces
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GATES = path.join(
  __dirname,
  "..",
  "..",
  "all",
  "copy-overwrite",
  "scripts",
  "lisa-gates.mjs"
);

/** How long a CLI probe may take before the box, not the code, is the finding. */
const CLI_TIMEOUT_MS = 60_000;

const DEPLOY = "pre-deploy:production";
const DAST = "runtime-web-vulnerability";
const A11Y = "accessibility";

/** A gates block declaring the DAST gate at the production deploy moment. */
const DAST_AT_DEPLOY = { gates: { [DAST]: { [DEPLOY]: "required" } } };

/** The script name the two DAST-capable stacks install their scanner under. */
const ZAP = "security:zap";

/** The headline `validate` prints when it has nothing at all to report. */
const ALL_CLEAR = "configuration is valid";

/** The manifest of a project that ships the alias but not the concern name. */
const SHIPS_ALIAS = { scripts: { [ZAP]: "zap-baseline.py" } };

/**
 * Run one `lisa-gates.mjs` subcommand in a throwaway project.
 * @param options - Probe inputs
 * @param options.args - Arguments after the script path
 * @param options.config - `.lisa.config.json` contents, or null to omit it
 * @param options.manifest - `package.json` contents, or null to omit it
 * @returns Exit status and merged output
 */
function cli(options: {
  args: string[];
  config: unknown;
  manifest: unknown | null;
}): { status: number | null; out: string } {
  const { args, config, manifest } = options;
  const root = mkdtempSync(path.join(tmpdir(), "lisa-shipped-as-"));
  try {
    writeFileSync(
      path.join(root, ".lisa.config.json"),
      JSON.stringify(config),
      "utf8"
    );
    if (manifest !== null) {
      writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify(manifest),
        "utf8"
      );
    }
    const child = spawnSync(process.execPath, [GATES, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: CLI_TIMEOUT_MS,
    });
    // A killed child returns EMPTY streams, so a timeout presents as a content
    // failure that never says "time". Say it here instead.
    expect(child.signal, "the CLI was killed, not answered").toBeNull();
    return { status: child.status, out: `${child.stdout}${child.stderr}` };
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

describe("`list` shows the command that will actually run", () => {
  it("resolves the DAST gate to the script the project ships", () => {
    const { out } = cli({
      args: ["list", `--moment=${DEPLOY}`, "--json"],
      config: DAST_AT_DEPLOY,
      manifest: SHIPS_ALIAS,
    });
    const [gate] = JSON.parse(out) as { task: string; command: string }[];

    expect(gate?.task).toBe(ZAP);
    expect(gate?.command).toBe(`npm run ${ZAP}`);
  });

  it("names both scripts in the human listing", () => {
    const { out } = cli({
      args: ["list", `--moment=${DEPLOY}`],
      config: DAST_AT_DEPLOY,
      manifest: SHIPS_ALIAS,
    });

    expect(out).toContain(ZAP);
    expect(out).toContain("security:dast");
  });

  it("prints the concern name unchanged when no manifest can be read", () => {
    const { out } = cli({
      args: ["list", `--moment=${DEPLOY}`, "--json"],
      config: DAST_AT_DEPLOY,
      manifest: null,
    });
    const [gate] = JSON.parse(out) as { command: string }[];

    expect(gate?.command).toBe("npm run security:dast");
  });
});

describe("`validate` stops calling a gate that resolves nowhere valid", () => {
  it("tells the operator which shipped script the gate was resolved through", () => {
    const { status, out } = cli({
      args: ["validate"],
      config: DAST_AT_DEPLOY,
      manifest: SHIPS_ALIAS,
    });

    expect(out).toContain(ZAP);
    expect(out).not.toContain(ALL_CLEAR);
    // Advisory, not blocking. See the module note.
    expect(status).toBe(0);
  });

  it("says plainly when nothing in the project will run a declared gate", () => {
    const { status, out } = cli({
      args: ["validate"],
      config: { gates: { [A11Y]: { [DEPLOY]: "required" } } },
      manifest: { scripts: { lint: "oxlint" } },
    });

    expect(out).toContain("a11y:check");
    expect(out).not.toContain(ALL_CLEAR);
    expect(status).toBe(0);
  });

  it("stays quiet about a gate whose own script the project ships", () => {
    const { status, out } = cli({
      args: ["validate"],
      config: { gates: { "code-style": { commit: "required" } } },
      manifest: { scripts: { lint: "oxlint" } },
    });

    expect(out).toContain(ALL_CLEAR);
    expect(status).toBe(0);
  });

  it("stays quiet when there is no manifest to check against", () => {
    // Unknown is not the same claim as missing. A project whose manifest this
    // process cannot read must not be told its scripts are absent.
    const { status, out } = cli({
      args: ["validate"],
      config: DAST_AT_DEPLOY,
      manifest: null,
    });

    expect(out).toContain(ALL_CLEAR);
    expect(status).toBe(0);
  });
});
