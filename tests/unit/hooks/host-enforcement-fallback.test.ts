/**
 * A host project must keep its guards when the Lisa plugin does not install.
 *
 * Every `PreToolUse` guard is declared in the plugin, so a container whose
 * plugin install fails runs with no enforcement at all — silently, which is how
 * a dispatched session bypassed a hook nobody had disabled. Lisa closed that for
 * itself with a repository hook, because `.claude/settings.json` is part of the
 * clone and reaches a cloud session whether or not a plugin ever installs.
 *
 * A host project has the identical hole and no `plugins/` directory to fall back
 * on, so `lisa apply` writes the same guards into its checkout. These tests
 * cover the three parts that can rot independently: the shipped copies drifting
 * from the reviewed originals, the dispatcher not finding them in the layout a
 * host project actually has, and the dispatcher standing down on something that
 * does not mean what it looks like it means.
 * @module tests/unit/hooks/host-enforcement-fallback
 */
import {
  chmodSync,
  cpSync,
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

import {
  hasOwnershipHeader,
  withoutOwnershipHeader,
} from "../../../scripts/materialize-copy-overwrite.mjs";

/** Absolute, so the interpreter is never resolved through a writeable PATH. */
const BASH = "/bin/bash";

/** The directory a host project receives scripts into. */
const SCRIPTS = "scripts";

/** The dispatcher's filename, in both trees. */
const FALLBACK_NAME = "lisa-enforcement-fallback.sh";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** The reviewed originals, which the plugin ships. */
const PLUGIN_HOOKS = path.join(REPO_ROOT, "plugins", "src", "base", "hooks");

/** The directory the guards sit in, under `scripts/`, in both trees. */
const HOOKS_DIRNAME = "lisa-hooks";

/** What `lisa apply` writes into a host checkout. */
const SHIPPED_HOOKS = path.join(
  REPO_ROOT,
  "all",
  "copy-overwrite",
  SCRIPTS,
  HOOKS_DIRNAME
);

const SHIPPED_FALLBACK = path.join(
  REPO_ROOT,
  "all",
  "copy-overwrite",
  SCRIPTS,
  FALLBACK_NAME
);

/** Claude's refusal code. Anything else lets the command through. */
const BLOCKED = 2;

/** The command that started all of this. */
const BYPASS = "git commit --no-verify -m x";

// Every guard the build syncs into `all/copy-overwrite/scripts/lisa-hooks/`.
// The byte-equality assertion below is what stops a shipped guard drifting from
// the reviewed one, so a guard missing from this list is an unreviewed guard.
const GUARDS = [
  "block-no-verify",
  "parity-safety-net",
  "block-shell-json-parsing",
  "block-instruction-file-edits",
  "block-direct-issue-create",
  "block-managed-file-edits",
  "worktree-binding-guard",
] as const;

/**
 * Files a guard resolves as a sibling of itself, which travel with it.
 *
 * Named separately from `GUARDS` because the build's mirror loop treats them
 * differently and that difference is the whole of issue #3483: the loop
 * appends `.sh` to every roster entry, so `parity-safety-net-heredoc.py` could
 * not ride along on the guard that needs it. Byte-equality matters here for the
 * same reason it does above — the guard hands a command to this parser and acts
 * on the answer, so a stale copy is a guard with different behaviour.
 */
const COMPANIONS = [
  "parity-safety-net-heredoc.py",
  "worktree-binding-guard.mjs",
] as const;

/**
 * Everything the build materializes into `all/copy-overwrite/scripts/`.
 *
 * `sonar-secrets.sh` ships beside the guards but is not dispatched like one, so
 * it stays out of `GUARDS` above — and had no byte-equality pin at all until
 * the ownership stamp gave every generated copy a reason to be enumerated in
 * one place. The dispatcher is here for the same reason: the shipped guards,
 * their companions, and the ratchet copies are the assets #2547 is about, and
 * one added to the build without appearing here is the failure this list
 * exists to make loud.
 */
const MATERIALIZED: readonly { shipped: string; source: string }[] = [
  ...GUARDS.map(guard => ({
    shipped: path.join(SHIPPED_HOOKS, `${guard}.sh`),
    source: path.join(PLUGIN_HOOKS, `${guard}.sh`),
  })),
  ...COMPANIONS.map(companion => ({
    shipped: path.join(SHIPPED_HOOKS, companion),
    source: path.join(PLUGIN_HOOKS, companion),
  })),
  {
    shipped: path.join(SHIPPED_HOOKS, "sonar-secrets.sh"),
    source: path.join(PLUGIN_HOOKS, "sonar-secrets.sh"),
  },
  {
    shipped: SHIPPED_FALLBACK,
    source: path.join(REPO_ROOT, SCRIPTS, FALLBACK_NAME),
  },
];

const temporaries: string[] = [];

afterEach(() => {
  for (const dir of temporaries.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("the guards a host project receives", () => {
  it.each(MATERIALIZED)(
    "$shipped is byte-identical to the reviewed original",
    ({ shipped, source }) => {
      // Copies rot. The remote-env scripts sat 74 lines behind their asset until
      // exactly this assertion was added, so the shipped guard gets the same
      // treatment as the ratchet: synced by the build, pinned by a test.
      //
      // Compared with the ownership stamp stripped, using the generator's own
      // stripper (#2547) — re-implementing the removal here would let the test
      // keep passing against a stamp the build no longer writes.
      expect(
        withoutOwnershipHeader(readFileSync(shipped, "utf8"), shipped),
        shipped
      ).toBe(readFileSync(source, "utf8"));
    }
  );

  it.each(MATERIALIZED)(
    "$shipped states that it is replaced",
    ({ shipped }) => {
      // The direction the stripping above cannot see. A shipped guard that reads
      // as editable is the expensive failure: a consumer repo hardened its
      // block-no-verify.sh, the next sync reverted it, and the loss surfaced only
      // because two of that repo's own tests started failing.
      expect(hasOwnershipHeader(readFileSync(shipped, "utf8")), shipped).toBe(
        true
      );
    }
  );

  it.each(MATERIALIZED)(
    "$source, which maintainers edit, is not told it will be overwritten",
    ({ source }) => {
      // The other half of the contract. Moving the header upstream would have
      // been the easy fix and a fresh instance of #2538's defect — these source
      // files are durable, and a warning on them deters correct edits.
      expect(hasOwnershipHeader(readFileSync(source, "utf8")), source).toBe(
        false
      );
    }
  );
});

/**
 * Build a host project as `lisa apply` leaves it: `scripts/` populated, and
 * emphatically no `plugins/` directory to fall back on.
 * @returns Path to the fake host checkout
 */
function hostProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-host-"));
  const scripts = path.join(root, SCRIPTS);
  const fallback = path.join(scripts, FALLBACK_NAME);

  temporaries.push(root);
  mkdirSync(scripts, { recursive: true });
  cpSync(SHIPPED_HOOKS, path.join(scripts, HOOKS_DIRNAME), {
    recursive: true,
  });
  cpSync(SHIPPED_FALLBACK, fallback);
  chmodSync(fallback, 0o755);
  return root;
}

describe("enforcement in a host layout", () => {
  /**
   * Run the host's dispatcher against a proposed command.
   * @param root Host checkout
   * @param command The Bash command Claude proposes
   * @returns Exit status
   */
  function runInHost(root: string, command: string): number | null {
    return boundedSpawnSync({
      label: "host lisa-enforcement-fallback.sh",
      command: BASH,
      args: [path.join(root, SCRIPTS, FALLBACK_NAME)],
      input: JSON.stringify({
        tool_name: "Bash",
        tool_input: { command },
      }),
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: root,
        CLAUDE_CONFIG_DIR: "/nonexistent-claude-config",
      },
    }).status;
  }

  it("blocks the bypass with no plugin and no plugins directory", () => {
    expect(runInHost(hostProject(), BYPASS)).toBe(BLOCKED);
  });

  it("blocks a destructive command the safety net owns", () => {
    expect(runInHost(hostProject(), "rm -rf $UNSET_VAR/data")).toBe(BLOCKED);
  });

  it("lets an ordinary command through", () => {
    // A fallback that blocks everything is not enforcement, it is an outage.
    expect(runInHost(hostProject(), "ls -la")).toBe(0);
  });

  it("classifies a heredoc rather than blocking it outright", () => {
    // The safety net hands a heredoc to a Python classifier it finds beside
    // itself, and blocks when it cannot reach one — which is right, because a
    // heredoc payload is executable shell and guessing is worse than refusing.
    //
    // But the host tree shipped the guard WITHOUT that classifier, so the
    // sibling lookup failed on every machine and the fail-closed branch was the
    // only branch a host project could reach: every heredoc blocked, for good,
    // with a message blaming an absent runtime on a machine whose `python3` was
    // fine (issue #3483). This case is the one a complete tree makes reachable.
    expect(runInHost(hostProject(), "cat <<'EOF'\nhello\nEOF")).toBe(0);
  });
});

describe("the plugin registry cannot switch enforcement off", () => {
  /**
   * A plugin registry shaped like the real one: keyed by plugin, with an array
   * of per-project entries for other projects entirely.
   * @returns Path to a directory usable as CLAUDE_CONFIG_DIR.
   */
  function registryListingLisa(): string {
    const config = mkdtempSync(path.join(tmpdir(), "lisa-config-"));
    const plugins = path.join(config, "plugins");

    temporaries.push(config);
    mkdirSync(plugins, { recursive: true });
    writeFileSync(
      path.join(plugins, "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: {
          "lisa@lisa": [
            {
              scope: "project",
              projectPath: "/somewhere/else",
              version: "9.9",
            },
          ],
        },
      })
    );
    return config;
  }

  /**
   * Run the dispatcher with a registry that claims the plugin is installed.
   * @param root Host checkout.
   * @param command The Bash command Claude proposes.
   * @returns Exit status.
   */
  function runWithRegistry(root: string, command: string): number | null {
    return boundedSpawnSync({
      label: "host lisa-enforcement-fallback.sh",
      command: BASH,
      args: [path.join(root, SCRIPTS, FALLBACK_NAME)],
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: root,
        CLAUDE_CONFIG_DIR: registryListingLisa(),
      },
    }).status;
  }

  it("still blocks the bypass when the registry lists lisa@lisa", () => {
    // The registry answers "ever installed, for any project, on this machine".
    // The question is "are the plugin's guards running in this session", which
    // no file on disk can answer — so this file stopped asking. It stood down
    // on a registry entry belonging to another project entirely, which is what
    // this fixture reproduces.
    expect(runWithRegistry(hostProject(), BYPASS)).toBe(BLOCKED);
  });

  it("still blocks a write to a session-instruction file", () => {
    // Caught in the wild: a plugin updated four minutes into a session left the
    // registry saying "installed" with no plugin hooks loaded, and this write
    // went through even though both guard copies exit 2 for it.
    expect(runWithRegistry(hostProject(), ": > AGENTS.md")).toBe(BLOCKED);
  });

  it("still lets an ordinary command through", () => {
    expect(runWithRegistry(hostProject(), "ls -la")).toBe(0);
  });
});

describe("host projects are told to run it", () => {
  it("registers the fallback in the settings lisa apply merges", () => {
    // Shipping the script without registering it would be enforcement that
    // exists on disk and never runs — the same silent no-op, one layer over.
    const merged = JSON.parse(
      readFileSync(
        path.join(REPO_ROOT, "all", "merge", ".claude", "settings.json"),
        "utf8"
      )
    ) as {
      hooks?: {
        PreToolUse?: readonly {
          matcher?: string;
          hooks?: readonly { command?: string }[];
        }[];
      };
    };

    const commands = (merged.hooks?.PreToolUse ?? [])
      .filter(entry => entry.matcher === "Bash")
      .flatMap(entry => entry.hooks ?? [])
      .map(hook => hook.command ?? "");

    expect(commands.some(c => c.includes("lisa-enforcement-fallback.sh"))).toBe(
      true
    );
  });
});
