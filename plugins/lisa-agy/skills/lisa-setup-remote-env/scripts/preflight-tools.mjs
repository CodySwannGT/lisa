/**
 * Prove, before an agent starts work, that the CLIs it needs are on PATH.
 *
 * The symmetric half of `preflight-secrets.mjs`, and it exists for the same
 * reason: the logic to answer the question was already good, and nothing asked
 * it at the moment the answer mattered. `planToolchain` decides presence,
 * minimum version, and installability correctly — but its only callers were
 * `/lisa:setup:local-env`, which a human runs deliberately, and container
 * provisioning. An agent on a laptop could claim a ticket, cut a branch, and
 * discover `maestro` was never installed forty minutes later.
 *
 * **This is a caller, not a checker.** Every decision comes from
 * `planToolchain`. Writing a second implementation is exactly the defect this
 * change also fixes elsewhere — `verify-remote-env.mjs` grew its own toolchain
 * check that forgot `minVersion`, so a container verified clean against a node
 * older than the manifest demanded. One function, one verdict, no drift.
 *
 * **Three verdicts, and the third one was learned the hard way.** The original
 * header here claimed two sufficed: `preflight-secrets` needs `unreachable`
 * because a vault can fail to be asked, and "probing a local binary cannot: it
 * is present or it is not." That sentence was true of probing and false of this
 * module, because one branch of `planToolchain` never probed at all — an
 * install entry with no pin for the running platform short-circuited to
 * `invalid` before the binary was looked for. So a `bws` that was installed, on
 * PATH, and resolving secrets in the very same session was reported under
 * "These need you", next to an instruction to route the work to blocked. Four
 * operator sessions believed it.
 *
 * The third tier is `unverified`: present and usable, but with no pin for this
 * platform, so Lisa can neither reinstall it nor say where it came from. That
 * is a real thing to know — an unpinned binary is a supply-chain claim nobody
 * checked — and it is emphatically not a reason to stop. Availability and
 * provenance are two questions, and answering the first with the second is the
 * defect this tier exists to prevent recurring.
 *
 * The analogous trap — a tool whose version cannot be parsed — is
 * already handled correctly upstream, because `planRequired` compares
 * `found.version ?? "0"` and an unknown version loses every `minVersion`
 * comparison. It fails closed without needing a verdict of its own.
 *
 * **The one thing tools have that credentials do not** is a self-service
 * remedy. An `install` entry is pinned and checksummed, so "missing" splits
 * into "Lisa can place this for you" and "you must act". A credential can never
 * be self-provisioned, which is why that distinction has no secrets equivalent.
 * @module preflight-tools
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { probe, readRemoteEnvConfig } from "./setup-remote-env.mjs";
import {
  compareVersions,
  currentPlatform,
  planToolchain,
} from "./toolchain.mjs";
import { toolFloor } from "./tool-floor.mjs";

/**
 * Plan actions that mean the agent cannot use the tool right now.
 *
 * `invalid` is here because most of its causes really are stops — an unpinned
 * version, a malformed `platforms` map, an unknown install method. The one
 * cause that is not, an entry with no pin for this platform whose binary is
 * nonetheless on PATH, is lifted out below before this set is applied.
 */
const BLOCKING = new Set(["missing", "invalid"]);

/**
 * Whether an unpinnable entry is nonetheless usable on this machine.
 *
 * Presence-only, and deliberately not a skip. Dropping the entry entirely would
 * report clean for a tool that is neither pinned nor installed, which is the
 * vacuous green this module refuses everywhere else. So the probe still decides
 * — it just gets asked, which on this branch it previously never was.
 *
 * A declared `minVersion` still bites. The pin is unusable here (it names an
 * artifact for another platform), but a minimum is a statement about the tool
 * rather than about the download, and a binary below it cannot do the work.
 * @param {object} step One `planToolchain` decision.
 * @param {Record<string, string>} minVersions Declared minimums by tool name.
 * @returns {boolean} Whether the tool is present and good enough to use.
 */
function usableWithoutPin(step, minVersions) {
  if (!step.unpinnedForPlatform || !step.found?.present) return false;
  const floor = minVersions[step.name];
  return !floor || compareVersions(step.found.version ?? "0", floor) >= 0;
}

/**
 * Read the whole config, for the derivations that live outside `remoteEnv`.
 *
 * The floor is implied by `tracker`, `secrets.provider` and `quality`, none of
 * which sit under `remoteEnv` — so this reads the root rather than reusing
 * `readRemoteEnvConfig`, which deliberately returns only its own block.
 *
 * **Absent and damaged are not the same answer.** A project with no
 * `.lisa.config.json` declares no tools, and `{}` states that correctly. A file
 * that exists and does not parse states nothing — and returning `{}` for it
 * derives an empty floor, which reports `ok` precisely when the declaration
 * this check exists to enforce could not be read. That is the vacuous green
 * `preflight-secrets` refuses in its own header, so this throws instead, the
 * same way `readConfig` in `surfaces.mjs` does.
 * @param {string} [cwd] Directory to look in.
 * @returns {object} Parsed config root, empty only when the file is absent.
 * @throws {Error} When the file exists but cannot be read or parsed.
 */
export function readConfigRoot(cwd = process.cwd()) {
  const path = join(cwd, ".lisa.config.json");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(
      `${path} is not readable, so the tools it requires could not be ` +
        `derived and nothing was checked: ${err.message}`
    );
  }
}

/**
 * Merge the derived floor into a declared manifest.
 *
 * A derived tool that the project already declares is dropped rather than
 * duplicated, and the declaration wins: a project that pinned `minVersion` for
 * `gh` has said something more specific than the derivation knows, and
 * overriding it would discard the more informed statement.
 * @param {{require?: object[], install?: object[]}} tools Declared manifest.
 * @param {Array<{name: string, reason: string}>} floor Derived tools.
 * @returns {{tools: {require: object[], install?: object[]}, reasons: Record<string, string>}} Merged manifest.
 */
export function mergeFloor(tools, floor) {
  const declared = new Set([
    ...(tools.require ?? []).map(tool => tool.name),
    ...(tools.install ?? []).map(tool => tool.name),
  ]);
  const added = floor.filter(entry => !declared.has(entry.name));
  const reasons = Object.fromEntries(
    floor.map(entry => [entry.name, entry.reason])
  );
  return {
    tools: {
      ...tools,
      require: [
        ...(tools.require ?? []),
        ...added.map(entry => ({ name: entry.name })),
      ],
    },
    reasons,
  };
}

/**
 * Check every required tool against this machine.
 * @param {object} [config] Parsed config root.
 * @param {object} [remoteEnv] Parsed `remoteEnv` block.
 * @param {Function} [versionProbe] Version probe, injected for tests.
 * @param {string} [platform] Platform key, injected for tests.
 * @returns {{verdict: string, blocked: Array<{name: string, action: string, reason: string}>, installable: Array<{name: string, action: string, reason: string}>, unverified: Array<{name: string, action: string, reason: string}>, reasons: Record<string, string>}}
 */
export function preflightTools(
  config = readConfigRoot(),
  remoteEnv = readRemoteEnvConfig(),
  versionProbe = probe,
  platform = currentPlatform()
) {
  const { tools, reasons } = mergeFloor(
    remoteEnv.tools ?? {},
    toolFloor(config)
  );
  if (!(tools.require ?? []).length && !(tools.install ?? []).length) {
    return {
      verdict: "ok",
      blocked: [],
      installable: [],
      unverified: [],
      reasons,
    };
  }

  // "local" because this runs where the agent is, and it is the surface word
  // `appliesToSurface` already understands — a tool narrowed to ["remote"] is
  // correctly ignored on a laptop rather than reported as missing there.
  const plan = planToolchain(tools, versionProbe, "local", platform);
  const minVersions = Object.fromEntries(
    (tools.install ?? [])
      .filter(tool => tool.minVersion)
      .map(tool => [tool.name, tool.minVersion])
  );
  const usable = new Set(
    plan
      .filter(step => usableWithoutPin(step, minVersions))
      .map(step => step.name)
  );
  // Restated in this module's own vocabulary rather than passed through.
  // `resolvePlatform`'s message is written for someone repairing a manifest —
  // "add a block for darwin-arm64 with its own url and sha256" — and reads as a
  // demand. What the reader here needs is the availability answer first and the
  // provenance caveat second, because only one of the two affects whether they
  // can start work.
  const unverified = plan
    .filter(step => usable.has(step.name))
    .map(step => ({
      ...step,
      action: "unverified",
      reason:
        `${step.name} ${step.found.version ?? "(version unknown)"} is on ` +
        `PATH and usable, but the manifest pins no artifact for ${platform}, ` +
        `so Lisa cannot reinstall it or say where it came from`,
    }));
  const blocked = plan.filter(
    step => BLOCKING.has(step.action) && !usable.has(step.name)
  );
  const installable = plan.filter(step => step.action === "install");
  if (blocked.length || installable.length)
    return { verdict: "missing", blocked, installable, unverified, reasons };
  // A note is not a failure and must not exit non-zero, but it does have to be
  // said — an "ok" verdict renders nothing at all, which would drop the only
  // signal this tier exists to carry.
  return {
    verdict: unverified.length ? "notice" : "ok",
    blocked,
    installable,
    unverified,
    reasons,
  };
}

/**
 * Count something and agree with itself about the verb.
 * @param {number} n How many.
 * @param {string} one Singular noun phrase.
 * @param {string} many Plural noun phrase.
 * @returns {string} A counted phrase such as "1 tool" or "3 tools".
 */
function count(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Render a verdict for whoever has to act on it.
 *
 * **The data was already tiered correctly; the layout undid it.** Two of two
 * operators reading this screen on the same morning concluded that a tool Lisa
 * was about to install for them was a blocker, and one of them only found out
 * otherwise by going to look at the machine. The verdict underneath was right
 * both times, which is what makes this a presentation defect rather than a
 * logic one — and per Lisa's own gate rule, everything crossing a gate outward
 * has to be readable by a non-technical operator, because that is who is
 * standing at the gate.
 *
 * Four things worked against that reader at once, and all four are addressed
 * here rather than one:
 *
 *   1. **Order.** The softer tier rendered first, so a reader met an
 *      installable tool while still holding the word FAILED. What stops the
 *      work now comes first, and what Lisa will handle comes after.
 *   2. **Scope.** A bare `FAILED.` says nothing about how much of the screen it
 *      covers. The header now carries counts, so "1 tool blocks; 1 more Lisa
 *      can install for you" is legible before any list is read.
 *   3. **Placement of the instruction.** *"Route the item to blocked"* was the
 *      last line of the whole report and read as applying to everything above
 *      it. That instruction is what a session acts on, which is how a layout
 *      problem became a routing decision. It now sits inside the blocking
 *      section, indented with it, and says "the tools above".
 *   4. **Markers.** The two lists were byte-identical in shape — same indent,
 *      same `name — reason`. A stop and an action now look different at a
 *      glance.
 * @param {object} result A {@link preflightTools} result.
 * @returns {string} Operator-readable report, empty when nothing needs saying.
 */
export function reportTools(result) {
  if (result.verdict === "ok") return "";

  // The header tracks the exit code. Only a blocked tool is a failure — one
  // Lisa can install is an action with a command attached, and calling that
  // "FAILED" while exiting zero teaches readers that the word means nothing.
  //
  // The counts are what scope the word to the part of the screen it owns. A
  // header that says how many tools it is talking about cannot be read as
  // covering a list it does not cover.
  const blocking = count(result.blocked.length, "tool blocks", "tools block");
  const spare = result.installable.length
    ? ` ${result.installable.length} more Lisa can install for you.`
    : ``;
  const header = () => {
    if (result.blocked.length)
      return `Tooling preflight FAILED — ${blocking}.${spare}`;
    if (result.installable.length)
      return (
        `Tooling preflight — action available. Nothing blocks;` +
        ` ${count(result.installable.length, "tool", "tools")} Lisa can` +
        ` install for you.`
      );
    // Nothing to do and nothing to fix; the note below is the whole message.
    // This third state arrived on main after this branch was cut — a result
    // carrying only UNVERIFIED tools reaches here, and the two-way header this
    // branch wrote would have called that "action available" with nothing to
    // act on.
    return `Tooling preflight passed, with a note.`;
  };
  const lines = [header()];
  // Blocking first, always. A reader who has been told something FAILED reads
  // the next thing on screen as the failure, so the next thing on screen has to
  // be one.
  if (result.blocked.length) {
    lines.push(
      ``,
      `STOP — these block the work. Lisa has no pinned artifact it can place,`,
      `so it cannot fix them for you:`,
      ``
    );
    for (const step of result.blocked) {
      const why = result.reasons[step.name];
      lines.push(`  [BLOCKED] ${step.name} — ${step.reason}`);
      if (why) lines.push(`            required because ${why}`);
    }
    // Indented into the section above and naming it, rather than trailing the
    // whole report where it silently claimed every tool listed anywhere.
    lines.push(
      ``,
      `  Work needing one of the tools above cannot be completed. Route that`,
      `  item to blocked citing that tool, rather than claiming it and`,
      `  stopping partway. Nothing else in this report is a reason to stop.`
    );
  }
  if (result.installable.length) {
    lines.push(
      ``,
      `NOT A BLOCKER — Lisa can install these itself; they are pinned and`,
      `checksummed. Run /lisa:setup:local-env to place them:`,
      ``
    );
    for (const step of result.installable) {
      lines.push(`  [INSTALLABLE] ${step.name} — ${step.reason}`);
    }
  }
  // Kept in main's wording and deliberately left unmarked. The markers above
  // separate a STOP from an ACTION, and this section is neither: nothing here
  // blocks and there is nothing to run. Giving it a third marker would say
  // these tools belong on the same axis as the two tiers this branch exists to
  // tell apart. It sits last because it is the only section a reader can skip.
  if (result.unverified.length) {
    lines.push(
      ``,
      `Installed, but Lisa did not put them there and cannot vouch for them:`,
      ``
    );
    for (const step of result.unverified) {
      lines.push(`  ${step.name} — ${step.reason}`);
    }
    lines.push(
      ``,
      `Nothing here blocks your work — these tools are usable right now. Add a`,
      `pin for this platform when you want Lisa able to verify or replace them.`
    );
  }
  return lines.join("\n");
}

/**
 * CLI entry point. Prints the report and exits non-zero when anything blocks.
 */
function main() {
  let result;
  try {
    result = preflightTools();
  } catch (err) {
    // A config that cannot be read is its own outcome, and it is not "ok". Said
    // in the operator's vocabulary rather than as a stack trace, because this
    // text is what the session-start hook injects for someone to act on.
    console.error(
      [
        `Tooling preflight could NOT be completed.`,
        ``,
        `  reason: ${err.message}`,
        ``,
        `Nothing was checked, so this is not a report that the toolchain is`,
        `fine. Repair the configuration, then start a new session.`,
      ].join("\n")
    );
    process.exit(1);
  }
  const text = reportTools(result);
  if (text) console.error(text);
  if (result.blocked.length) process.exit(1);
}

/**
 * Whether this module is the entry point node was asked to run.
 *
 * Both sides are realpath'd rather than compared as text: `import.meta.url` is
 * the resolved path while `process.argv[1]` is whatever the caller typed, so a
 * symlinked path — every git worktree, and every `/tmp` path on macOS — makes a
 * raw comparison false. The module then loads, runs nothing, and exits 0, which
 * is a readiness check reporting clean because it never ran. Same rule and same
 * reasoning as `scripts/lib/invoked-as-script.mjs`, written out here because a
 * plugin payload has no `./lib/` to import from.
 * @param {string} moduleUrl This module's own `import.meta.url`.
 * @param {string} [argv1] Entry path; defaults to `process.argv[1]`.
 * @returns {boolean} Whether the CLI body should run.
 */
function invokedAsScript(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (invokedAsScript(import.meta.url)) {
  main();
}
