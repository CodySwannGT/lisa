/**
 * Tests for the workstation bootstrap.
 *
 * Every probe is injected, so nothing here touches the machine running the
 * suite: a test that asked the real PATH would pass or fail depending on whose
 * laptop it ran on, which is precisely the bug class this skill exists to
 * remove.
 * @module tests/unit/workstation/workstation-install
 */

import { describe, expect, it } from "vitest";

import {
  AGENTS,
  TOOLS,
} from "../../../plugins/src/base/skills/lisa-setup-workstation/scripts/catalogue.mjs";
import {
  chooseProvider,
  renderDockerfile,
  run,
} from "../../../plugins/src/base/skills/lisa-setup-workstation/scripts/cli.mjs";
import { installEntry } from "../../../plugins/src/base/skills/lisa-setup-workstation/scripts/workstation.mjs";
import {
  CHILD_BUDGET_MS,
  SETUP_OPERATION_BUDGET_MS,
} from "../../../plugins/src/base/skills/lisa-setup-workstation/scripts/bounded-child.mjs";

import {
  ANY_PATH,
  BIN_DIR,
  SCRIPT_URL,
  SYSTEM_GIT,
  SYSTEM_NODE,
  VENDOR_SCRIPT,
  probes,
} from "./fixtures.js";

const NPM_GLOBAL_KIND = "npm-global";
const CODEX_PACKAGE = "@openai/codex";

describe("installEntry", () => {
  it("gives network installation a longer budget than local probes", () => {
    const options: Array<{ timeout?: number }> = [];
    installEntry(
      { name: "codex", kind: NPM_GLOBAL_KIND, package: CODEX_PACKAGE },
      { label: "Codex" },
      {
        run: (_cmd, _args, callOptions) => options.push(callOptions),
        locate: () => `${BIN_DIR}/codex`,
      }
    );

    expect(SETUP_OPERATION_BUDGET_MS).toBeGreaterThan(CHILD_BUDGET_MS);
    expect(options).toEqual([{ timeout: SETUP_OPERATION_BUDGET_MS }]);
  });

  it("installs an npm-global entry with npm", async () => {
    const calls = [];
    const entry = {
      name: "codex",
      kind: NPM_GLOBAL_KIND,
      package: CODEX_PACKAGE,
    };
    const result = installEntry(
      entry,
      { label: "Codex" },
      {
        run: (cmd, args) => calls.push([cmd, ...args]),
        // `locate` MUST be injected. Without it the post-install check runs a
        // real `command -v codex`, which passes on a laptop that has Codex and
        // fails on CI that does not — the machine-dependent test this whole
        // skill exists to stop people writing. It failed on CI exactly that way.
        locate: () => `${BIN_DIR}/codex`,
      }
    );
    expect(calls).toEqual([["npm", "install", "-g", CODEX_PACKAGE]]);
    expect(result.action).toBe("installed");
  });

  it("pipes vendor scripts to bash, never sh", async () => {
    // On Ubuntu /bin/sh is dash and every one of these vendor installers is a
    // bash script. Piping them to sh in a container gave `Syntax error: "("
    // unexpected` while the identical command worked on a Mac, where sh IS
    // bash — the environment doing the verifying hiding the bug.
    const calls: string[][] = [];
    installEntry(
      { name: "claude", kind: VENDOR_SCRIPT, script: SCRIPT_URL },
      { label: "Claude Code" },
      {
        run: (cmd: string, args: string[]) => calls.push([cmd, ...args]),
        locate: () => `${BIN_DIR}/claude`,
      }
    );
    expect(calls[0][0]).toBe("bash");
    expect(calls[0].join(" ")).toContain("| bash");
    expect(calls[0].join(" ")).not.toMatch(/\|\s*sh\b/);
  });

  it("sets pipefail so a 404 is not laundered into success", async () => {
    // Without pipefail the exit status is bash's, not curl's: a 404 feeds an
    // empty script to bash, bash exits 0, and a tool that was never installed
    // is reported as installed. sonarsource.com/install did exactly this.
    const calls: string[][] = [];
    installEntry(
      { name: "sonar", kind: VENDOR_SCRIPT, script: SCRIPT_URL },
      { label: "SonarQube CLI" },
      {
        run: (cmd: string, args: string[]) => calls.push([cmd, ...args]),
        locate: () => `${BIN_DIR}/sonar`,
      }
    );
    expect(calls[0]).toContain("-o");
    expect(calls[0]).toContain("pipefail");
  });

  it("fails when the installer exits 0 but the binary is still absent", async () => {
    // The structural fix: verify by looking, not by exit status. Every
    // installer here can exit 0 having installed nothing.
    const result = installEntry(
      { name: "sonar", kind: VENDOR_SCRIPT, script: SCRIPT_URL },
      { label: "SonarQube CLI" },
      { run: () => undefined, locate: () => null }
    );
    expect(result.action).toBe("failed");
    expect(result.reason).toContain("still not on PATH");
  });

  it("performs a checksummed install rather than deferring it", async () => {
    // These were reported as `deferred` and never installed, so a container
    // came up with no bws and no gh while the run exited 0.
    const installed: string[] = [];
    const result = installEntry(
      { name: "bws", kind: "release-zip" },
      { label: "Bitwarden Secrets Manager" },
      {
        installPinned: (entry: { name: string }) => installed.push(entry.name),
        locate: () => `${BIN_DIR}/bws`,
      }
    );
    expect(installed).toEqual(["bws"]);
    expect(result.action).toBe("installed");
  });

  it("fails loudly when the pinned installer is unavailable", async () => {
    const result = installEntry(
      { name: "bws", kind: "release-zip" },
      { label: "Bitwarden Secrets Manager" },
      { locate: () => null }
    );
    expect(result.action).toBe("failed");
    expect(result.reason).toContain("checksum");
  });

  it("installs the AWS CLI under $HOME, not /usr/local", async () => {
    // The vendor installer defaults to /usr/local, which needs root and puts a
    // container and a laptop on different paths.
    const calls: string[][] = [];
    installEntry(
      { name: "aws", kind: "aws-cli" },
      { label: "AWS CLI v2" },
      {
        run: (cmd: string, args: string[]) => calls.push([cmd, ...args]),
        locate: () => "/home/me/.local/bin/aws",
        home: "/home/me",
        platform: "linux",
      }
    );
    const script = calls[0].join(" ");
    expect(script).toContain('--install-dir "/home/me/.local/aws-cli"');
    expect(script).toContain('--bin-dir "/home/me/.local/bin"');
    expect(script).not.toContain("/usr/local");
  });

  it("defers the AWS CLI to Homebrew on macOS rather than prompting for admin", async () => {
    const result = installEntry(
      { name: "aws", kind: "aws-cli" },
      { label: "AWS CLI v2" },
      { platform: "darwin", locate: () => null }
    );
    expect(result.action).toBe("manual");
    expect(result.reason).toContain("brew install awscli");
  });

  it("reports a failure instead of throwing", async () => {
    const result = installEntry(
      { name: "codex", kind: NPM_GLOBAL_KIND, package: "x" },
      { label: "Codex" },
      {
        run: () => {
          throw new Error("network down");
        },
        // Deterministic without this, since the throw happens before the
        // post-install check — injected anyway so no test in this file reaches
        // for the host, and none can start depending on it later by accident.
        locate: () => null,
      }
    );
    expect(result.action).toBe("failed");
    expect(result.reason).toContain("network down");
  });
});

describe("chooseProvider", () => {
  it("honours an explicit flag without asking", async () => {
    const ask = () => {
      throw new Error("should not prompt");
    };
    expect(chooseProvider("vault", { ask, interactive: true })).toBe("vault");
  });

  it("defaults to none when headless, so a build cannot hang", async () => {
    expect(chooseProvider(null, { ask: () => "1", interactive: false })).toBe(
      "none"
    );
  });

  it("accepts a menu number", async () => {
    expect(chooseProvider(null, { ask: () => "3", interactive: true })).toBe(
      "doppler"
    );
  });

  it("accepts a provider name", async () => {
    expect(
      chooseProvider(null, { ask: () => "vault", interactive: true })
    ).toBe("vault");
  });

  it("falls back to none on an unrecognised answer", async () => {
    expect(chooseProvider(null, { ask: () => "wat", interactive: true })).toBe(
      "none"
    );
  });
});

describe("run", () => {
  /**
   * Capture CLI output.
   * @returns {object} Sinks plus the collected lines.
   */
  const sink = () => {
    const lines = [];
    const errors = [];
    return {
      lines,
      errors,
      log: text => lines.push(String(text)),
      error: text => errors.push(String(text)),
    };
  };

  /** The base image's contribution: required tools present, agents absent. */
  const baseImage = { git: SYSTEM_GIT, node: SYSTEM_NODE };

  it("installs nothing without --install", async () => {
    const io = sink();
    const code = await run([], { ...io, probes: probes(baseImage) });
    expect(code).toBe(0);
    expect(io.lines.join("\n")).toContain(
      "Nothing has been installed or written"
    );
  });

  it("reports an already-prepared machine explicitly", async () => {
    const everything = Object.fromEntries(
      [...AGENTS, ...TOOLS].map(e => [e.name, `${ANY_PATH}/${e.name}`])
    );
    const io = sink();
    const code = await run([], { ...io, probes: probes(everything) });
    expect(code).toBe(0);
    expect(io.lines.join("\n")).toContain("already prepared");
  });

  it("is idempotent — a second run on a prepared machine installs nothing", async () => {
    const everything = Object.fromEntries(
      [...AGENTS, ...TOOLS].map(e => [e.name, `${ANY_PATH}/${e.name}`])
    );
    const calls = [];
    const io = sink();
    const options = {
      ...io,
      probes: { ...probes(everything), run: (...args) => calls.push(args) },
    };
    await run(["--install"], options);
    await run(["--install"], options);
    expect(calls).toHaveLength(0);
  });

  it("exits non-zero when a required tool is missing", async () => {
    const io = sink();
    const code = await run([], { ...io, probes: probes() });
    expect(code).toBe(1);
    expect(io.errors.join("\n")).toContain("required tool");
  });

  it("rejects an unknown provider without installing anything", async () => {
    const calls = [];
    const io = sink();
    const code = await run(["--install", "--provider=lastpass"], {
      ...io,
      probes: { ...probes(), run: (...args) => calls.push(args) },
    });
    expect(code).toBe(1);
    expect(calls).toHaveLength(0);
  });

  it("finds the catalogue entry for a provider planned under its binary name", async () => {
    // The lookup keys on the plan row's name (`bws`) while the catalogue keys
    // on the vendor name (`bitwarden`). A mismatch here does not throw — it
    // silently installs nothing — so it is asserted directly.
    const present = Object.fromEntries(
      [...AGENTS, ...TOOLS].map(e => [e.name, `${ANY_PATH}/${e.name}`])
    );
    const calls = [];
    const io = sink();
    await run(["--install", "--provider=doppler"], {
      ...io,
      probes: {
        ...probes(present),
        run: (cmd, args) => calls.push([cmd, ...args]),
      },
    });
    expect(calls.length).toBeGreaterThan(0);
    expect(JSON.stringify(calls)).toContain("cli.doppler.com");
  });

  it("emits JSON that carries the group of every row", async () => {
    const io = sink();
    await run(["--json", "--provider=vault"], { ...io, probes: probes() });
    const { plan } = JSON.parse(io.lines.join("\n"));
    expect(new Set(plan.map(r => r.group))).toEqual(
      new Set(["agent", "provider", "tool"])
    );
  });
});

describe("renderDockerfile", () => {
  it("passes the provider explicitly, since the build has no TTY", async () => {
    expect(renderDockerfile(["claude"], "bitwarden")).toContain(
      "--provider=bitwarden"
    );
  });

  it("bakes in no repository", async () => {
    const text = renderDockerfile(["claude"], "none");
    expect(text).not.toMatch(/git clone/);
  });

  it("runs the same script the host runs, not a parallel install path", async () => {
    const text = renderDockerfile([], "none");
    expect(text).toContain("lisa-setup-workstation/scripts/cli.mjs");
    expect(text).toContain("--install");
  });

  it("copies the whole skills tree, since pinned installs come from a sibling", async () => {
    // Copying only this skill's directory left bws and gh unprovisioned: the
    // checksummed installer lives in lisa-setup-remote-env.
    expect(renderDockerfile([], "bitwarden")).toContain("COPY skills/");
  });

  it("puts the bin directory on PATH BEFORE the install runs", async () => {
    // Ordering is the whole assertion. The post-install check looks for each
    // binary by bare name, so a PATH set after the RUN would fail every
    // verification in the image while passing on a laptop that already
    // exports ~/.local/bin.
    const lines = renderDockerfile(["claude"], "none").split("\n");
    const path = lines.findIndex(l => l.startsWith("ENV PATH="));
    const install = lines.findIndex(l => l.startsWith("RUN node"));
    expect(path).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(path);
  });
});
