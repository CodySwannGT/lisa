import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

/** Minimal environment for project-scoped git commands, free of caller hook state. */
const GIT_COMMAND_ENV: NodeJS.ProcessEnv = {
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
};

/**
 * The two `push.default` values that resolve a push's destination from the
 * branch's UPSTREAM rather than from its own name.
 *
 * `tracking` is the deprecated spelling of `upstream`; git still honours it, so
 * a guard that only knew the modern name would leave half the trap armed.
 */
const INHERITING_VALUES: ReadonlySet<string> = new Set([
  "upstream",
  "tracking",
]);

/** What the inheriting values are rewritten to — git's own default since 2.0. */
const SAFE_VALUE = "simple";

/**
 * Read the effective `push.default` for a project, or undefined when unset.
 *
 * Reads the EFFECTIVE value, not the local one. A repository inherits
 * `push.default` from the user's global config just as readily as from its own
 * `.git/config`, and the accident this migration disarms does not care which
 * file the value came from.
 * @param cwd - Project directory
 * @returns The configured value lowercased, or undefined when unset or unreadable
 */
async function readPushDefault(cwd: string): Promise<string | undefined> {
  const { exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(exec);
  try {
    const { stdout } = await run("git config --get push.default", {
      cwd,
      env: GIT_COMMAND_ENV,
    });
    const value = stdout.trim().toLowerCase();
    return value === "" ? undefined : value;
  } catch {
    // Exit 1 means "not set", which is git's default `simple` and needs no fix.
    // Any other failure means this is not a readable git directory, which is
    // equally nothing to do here.
    return undefined;
  }
}

/**
 * Write the safe value into the project's LOCAL git config.
 * @param cwd - Project directory
 * @returns True when the write succeeded
 */
async function writeLocalPushDefault(cwd: string): Promise<boolean> {
  const { exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(exec);
  try {
    await run(`git config --local push.default ${SAFE_VALUE}`, {
      cwd,
      env: GIT_COMMAND_ENV,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Migration: stop a push from inheriting its destination from the upstream ref.
 *
 * With `push.default=upstream`, git resolves a push's destination from the
 * branch's upstream instead of from the branch it was told to push. A working
 * branch created the ordinary way — `git checkout -b <branch> origin/main` —
 * has `main` as its upstream, so the ordinary `git push -u origin <branch>`
 * resolves to `refs/heads/main` and lands there. The push reports success;
 * branch protection and every required check are bypassed; the operator is told
 * only afterwards, if at all.
 *
 * Measured in Lisa's own repository (CodySwannGT/lisa#3495): two commits
 * reached the default branch this way. Every detection control afterwards fired
 * correctly — the bypass was reported, the agent force-push was refused, the
 * release run was caught and cancelled — and the commits shipped in a published
 * release regardless, because an ordinary unrelated merge cut a release before
 * anyone could rewind. Nothing had prevented the original push, and prevention
 * turned out to be the only control that would have mattered.
 *
 * The rewrite is deliberately narrow. Only `upstream` and `tracking` are
 * touched; `simple`, `current`, `matching`, and `nothing` are left exactly as
 * the host set them, because none of them resolve a destination the pusher did
 * not name. The write is `--local`, which shadows a global setting rather than
 * editing the user's global config — this repository's problem to fix is this
 * repository, not the machine.
 *
 * This is one half of the fix and the weaker half: it disarms the trap but
 * cannot bind a clone made before it ran, and it does not survive a host
 * setting the value back. The `validate-push-destination` guard in the pre-push
 * hook is the other half, and it reads the destination git actually resolved
 * rather than the config that produced it.
 */
export class EnsurePushDefaultSafeMigration implements Migration {
  readonly name = "ensure-push-default-safe";
  readonly description = `Set push.default=${SAFE_VALUE} locally where it currently resolves a push's destination from the upstream ref, so a feature-branch push cannot land on the default branch`;

  /**
   * Applies only where `push.default` currently inherits the destination.
   * @param ctx - Migration context
   * @returns True when there is work to do
   */
  async applies(ctx: MigrationContext): Promise<boolean> {
    const current = await readPushDefault(ctx.projectDir);
    return current !== undefined && INHERITING_VALUES.has(current);
  }

  /**
   * Rewrite the inheriting value to the safe one in local git config.
   * @param ctx - Migration context
   * @returns Result describing the action taken
   */
  async apply(ctx: MigrationContext): Promise<MigrationResult> {
    const current = await readPushDefault(ctx.projectDir);
    if (current === undefined || !INHERITING_VALUES.has(current)) {
      return { name: this.name, action: "noop" };
    }
    const detail = `push.default was "${current}", which resolves a push's destination from the branch's upstream — a feature branch created from the default branch would push straight to it. Set to "${SAFE_VALUE}" locally.`;
    if (ctx.dryRun) {
      ctx.logger.dry(`Would set push.default=${SAFE_VALUE} (was "${current}")`);
      return { name: this.name, action: "applied", message: detail };
    }
    if (!(await writeLocalPushDefault(ctx.projectDir))) {
      return { name: this.name, action: "noop" };
    }
    ctx.logger.success(detail);
    return { name: this.name, action: "applied", message: detail };
  }
}
