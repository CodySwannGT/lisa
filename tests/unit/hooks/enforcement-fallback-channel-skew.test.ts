/**
 * YOU CANNOT RETIRE A REFUSAL BY SHIPPING A FIX.
 *
 * The same guards reach an agent by two independent channels — this dispatcher,
 * registered in `.claude/settings.json`, and the plugin manifest, which
 * registers each guard individually. Both fire on one tool call and the agent
 * sees the UNION of their verdicts. So a TIGHTENING on either channel takes
 * effect at once, while a RELAXATION is inert until the slower channel catches
 * up: the stale copy goes on refusing and its refusal wins. The operator sees a
 * guard blocking what `main` already permits, reads it as the guard being WRONG
 * rather than OLD, and routes around it.
 *
 * The dispatcher could not see any of that. Its `plugin_tree` is repo-relative,
 * so it exists only inside the Lisa monorepo; in a host project the plugin
 * actually in force is elsewhere, and the vintage machinery written for #3205
 * was blind to the channel it races. It now resolves that channel from
 * `plugins/installed_plugins.json`, which the runtime keeps PER PROJECT
 * DIRECTORY — which is why two checkouts of one repository on one disk really
 * do run different vintages.
 *
 * Three verdicts, never two. "The channels agree" and "one of them could not be
 * read" are different facts, and a probe that reports the first when it means
 * the second is the green-but-inert failure this repository keeps relearning.
 * @module tests/unit/hooks/enforcement-fallback-channel-skew
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

/** Absolute, so the interpreter is never resolved through a writeable PATH. */
const BASH = "/bin/bash";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const FALLBACK = path.join(
  REPO_ROOT,
  "scripts",
  "lisa-enforcement-fallback.sh"
);

/** Every guard the dispatcher's own loop resolves. */
const GUARDS = [
  "block-no-verify",
  "parity-safety-net",
  "block-shell-json-parsing",
  "block-instruction-file-edits",
  "block-direct-issue-create",
  "block-managed-file-edits",
  "block-blind-automerge",
  "worktree-binding-guard",
] as const;

/** The vintage the dispatcher's own channel reports, via the apply receipt. */
const DISPATCHER_VINTAGE = "4.10.0";

/** A different vintage for the plugin channel, so the two disagree. */
const PLUGIN_VINTAGE = "4.47.0";

/** A command no guard has an opinion about. */
const HARMLESS = "ls -la";

/** The loud verdict: two channels on disk at different vintages. */
const SKEW = "cross-channel vintage SKEW";

/** The verdict that is NOT agreement: a channel that could not be read. */
const UNDETERMINED = "cross-channel vintage UNDETERMINED";

const temporaries: string[] = [];

afterEach(() => {
  for (const dir of temporaries.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A host whose `scripts/lisa-hooks/` is fully populated with permissive guards
 * and whose apply receipt dates that tree.
 * @returns Absolute path to the host root.
 */
function hostRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-skew-host-"));
  const hooks = path.join(root, "scripts", "lisa-hooks");
  temporaries.push(root);
  mkdirSync(hooks, { recursive: true });
  for (const guard of GUARDS) {
    writeFileSync(path.join(hooks, `${guard}.sh`), "#!/bin/bash\nexit 0\n", {
      mode: 0o755,
    });
  }
  mkdirSync(path.join(root, ".lisa"), { recursive: true });
  writeFileSync(
    path.join(root, ".lisa", "apply-receipt.json"),
    JSON.stringify({ lisa_version: DISPATCHER_VINTAGE }, undefined, 2)
  );
  return root;
}

/**
 * A Claude config directory whose install record names `projectPath` at
 * `version`, in the shape the runtime actually writes.
 * @param projectPath Project directory the record is keyed on.
 * @param version Installed plugin version to record.
 * @returns Absolute path to the config directory.
 */
function configDir(projectPath: string, version: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-skew-cfg-"));
  temporaries.push(root);
  mkdirSync(path.join(root, "plugins"), { recursive: true });
  writeFileSync(
    path.join(root, "plugins", "installed_plugins.json"),
    JSON.stringify(
      {
        version: 1,
        plugins: {
          // A second plugin sharing the projectPath, because the real record
          // has many and the lookup must not answer with another one's version.
          "code-review@claude-plugins-official": [
            {
              scope: "project",
              projectPath,
              installPath: `${root}/plugins/cache/claude-plugins-official/code-review/0120fb83da5d`,
              version: "0120fb83da5d",
            },
          ],
          "lisa@lisa": [
            {
              scope: "project",
              projectPath,
              installPath: `${root}/plugins/cache/lisa/lisa/${version}`,
              version,
            },
          ],
        },
      },
      undefined,
      2
    )
  );
  return root;
}

/**
 * Run the dispatcher once and return everything it said.
 * @param root Host project root.
 * @param config Value for CLAUDE_CONFIG_DIR.
 * @returns Exit status and combined output.
 */
function run(
  root: string,
  config: string
): { status: number | null; output: string } {
  const result = boundedSpawnSync({
    label: "lisa-enforcement-fallback.sh",
    command: BASH,
    args: [FALLBACK],
    input: JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: HARMLESS },
    }),
    cwd: root,
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: root,
      CLAUDE_CONFIG_DIR: config,
    },
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

describe("the guard channel the dispatcher races", () => {
  it("reports SKEW when the two channels run different vintages", () => {
    const root = hostRoot();

    const { output } = run(root, configDir(root, PLUGIN_VINTAGE));

    expect(output).toContain(SKEW);
    expect(output).toContain(DISPATCHER_VINTAGE);
    expect(output).toContain(PLUGIN_VINTAGE);
    expect(output).not.toContain("UNDETERMINED");
  });

  it("says you cannot retire a refusal by shipping a fix", () => {
    // The sentence is the whole finding: a relaxation on one channel does
    // nothing while the other still refuses. An operator who is not told this
    // reads the block as the guard being wrong and routes around it.
    const root = hostRoot();

    const { output } = run(root, configDir(root, PLUGIN_VINTAGE));

    expect(output).toContain("YOU CANNOT RETIRE A REFUSAL BY SHIPPING A FIX");
  });

  it("reports what is installed without claiming both channels are live", () => {
    // `installed_plugins.json` is enablement-blind and session-blind — the
    // reason the header gives for removing an earlier stand-down keyed on it.
    // It answers what VINTAGE is installed, never whether those hooks loaded
    // into this session, so the notice must not assert that they did.
    const root = hostRoot();

    const { output } = run(root, configDir(root, PLUGIN_VINTAGE));

    expect(output).toContain("installed for this project is lisa");
    expect(output).toContain("When both fire on one tool call");
    // Never the stronger claim. Liveness is not observable from a repo hook.
    expect(output).not.toContain("the plugin manifest runs lisa");
  });

  it("names both channels so the skew can be repaired", () => {
    const root = hostRoot();
    const config = configDir(root, PLUGIN_VINTAGE);

    const { output } = run(root, config);

    expect(output).toContain(
      path.join(config, "plugins", "cache", "lisa", "lisa", PLUGIN_VINTAGE)
    );
    expect(output).toContain("npx @codyswann/lisa apply");
    expect(output).toContain("update the installed plugin");
  });

  it("stays silent when the two channels agree", () => {
    const root = hostRoot();

    const { output } = run(root, configDir(root, DISPATCHER_VINTAGE));

    expect(output).not.toContain("cross-channel vintage");
  });

  it("reports UNDETERMINED, never agreement, when the record is absent", () => {
    // The rejection control. A dispatcher that cannot read the other channel
    // has established nothing about it; reporting agreement there is a probe
    // that renders success while measuring nothing.
    const root = hostRoot();

    const { output } = run(root, "/nonexistent-claude-config");

    expect(output).toContain(UNDETERMINED);
    expect(output).toContain("Not agreement");
    expect(output).not.toContain(SKEW);
  });

  it("reports UNDETERMINED when the record names a different project", () => {
    // Installs are recorded per project directory, so a record that speaks
    // about some other checkout says nothing about this one.
    const root = hostRoot();
    const other = configDir(`${root}-somewhere-else`, PLUGIN_VINTAGE);

    const { output } = run(root, other);

    expect(output).toContain(UNDETERMINED);
    expect(output).not.toContain(SKEW);
  });

  it("does not answer with another plugin's version", () => {
    // The real record holds one entry per plugin under the same projectPath.
    // Matching on projectPath alone would let `code-review`'s version answer
    // for Lisa's, which reads as a skew that is not there.
    const root = hostRoot();

    const { output } = run(root, configDir(root, DISPATCHER_VINTAGE));

    expect(output).not.toContain("0120fb83da5d");
  });

  it("costs the silent allow path nothing", () => {
    // The dispatcher runs on EVERY matched tool call, and #3814 exists because
    // per-call hook cost is already the problem — so resolving the other
    // channel must happen only when something is going to be said. Asserted
    // structurally because the property is "where the call site is", and a
    // timing assertion for it would be a flake on a loaded machine.
    const source = readFileSync(FALLBACK, "utf8").split("\n");
    const lineOf = (pattern: RegExp): number =>
      source.findIndex(line => pattern.test(line));
    // The definition line matches the name too, so it is excluded explicitly.
    const callSites = source.filter(
      line =>
        /^\s*resolve_plugin_channel\b/.test(line) &&
        !/resolve_plugin_channel\(\)/.test(line)
    );
    const latch = lineOf(/^resolve_vintages\(\) \{/);
    const callSite = lineOf(/^\s+resolve_plugin_channel \|\| true$/);

    // One call site, and it is inside the body of the lazy, latched resolver.
    expect(callSites).toHaveLength(1);
    expect(latch).toBeGreaterThan(-1);
    expect(callSite).toBeGreaterThan(latch);
    expect(source[callSite + 1]).toBe("}");
  });

  it("lets a permitted command through whatever the verdict is", () => {
    // The probe reports; it never decides. A skewed pair of channels is a
    // thing to say, not a thing to block on.
    const root = hostRoot();

    expect(run(root, configDir(root, PLUGIN_VINTAGE)).status).toBe(0);
    expect(run(root, "/nonexistent-claude-config").status).toBe(0);
  });
});
