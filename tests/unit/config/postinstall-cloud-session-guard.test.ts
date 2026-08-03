/**
 * Guards the cloud-session skip on Lisa's Claude plugin postinstall.
 *
 * Background: Claude Code installs the plugins a repository declares in
 * `.claude/settings.json` at session start, from the marketplace that file
 * names. Lisa's postinstall was doing the same job from a package manager's
 * lifecycle script — which inside a cloud container runs during the environment
 * setup script, before Claude Code has launched and before any marketplace is
 * registered.
 *
 * Every install therefore failed, eight of eight, the official marketplace's
 * plugins included:
 *
 *   Installing plugin "lisa@lisa"...× Plugin "lisa" not found in marketplace "lisa"
 *
 * Each one is swallowed by `|| true`, so the damage is not a broken build. It is
 * an empty `installed_plugins.json` and several screens of red in the setup log
 * that read as the cause of whatever fails next — which is precisely how they
 * were read.
 *
 * Standing down is the fix rather than racing the platform with an earlier
 * install: there is no earlier moment at which one could succeed.
 * @module tests/unit/config/postinstall-cloud-session-guard
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "install-claude-plugins.sh");

/** The variable the platform sets, and the only reliable cloud signal. */
const REMOTE_FLAG = "CLAUDE_CODE_REMOTE";

describe("Claude plugin postinstall in a cloud session", () => {
  const script = readFileSync(SCRIPT, "utf8");

  it("stands down when the platform will do the install itself", () => {
    expect(script).toContain(`if [ "\${${REMOTE_FLAG}:-}" = "true" ]`);
  });

  it("stands down BEFORE it installs anything", () => {
    // Ordering is the whole guard. Placed after the first `claude plugin
    // install`, it would still emit the failures it exists to prevent.
    const guard = script.indexOf(`\${${REMOTE_FLAG}:-}`);
    const firstInstall = script.indexOf("claude plugin install");
    expect(guard).toBeGreaterThan(-1);
    expect(firstInstall).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(firstInstall);
  });

  it("says why it skipped rather than exiting silently", () => {
    // A postinstall that goes quiet in one environment and not another looks
    // like a broken install to the next person reading the setup log.
    expect(script).toMatch(/Cloud session: leaving plugin installation/);
  });

  it("leaves local installs alone", () => {
    // The guard tests one variable against one value. Anything broader would
    // change behaviour on developer machines, where this script is the thing
    // that installs the plugins.
    expect(script).not.toContain(`if [ -n "\${${REMOTE_FLAG}:-}" ]`);
  });
});
