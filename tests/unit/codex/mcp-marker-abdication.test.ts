/**
 * A renamed MCP marker must not make Lisa disown servers it manages.
 *
 * This is the INVERSE of the orphaned-block defect, and the harder half to
 * see. Elsewhere an unrecognised marker makes a writer APPEND a second block,
 * which announces itself. Here it made Lisa abdicate:
 *
 *   1. `stripManagedBlock` returned the TOML unchanged when it could not find
 *      its start marker, so an orphaned block survived into `hostToml`.
 *   2. `hostMcpNames` read that orphan's server names and classified them as
 *      HOST-owned.
 *   3. `applicableEntries` filtered them out of what Lisa writes.
 *
 * So Lisa did not duplicate anything. It silently stopped managing servers it
 * was managing, because it now believed the host owned them — and the config
 * still looks entirely plausible afterwards. The servers are still listed. The
 * only difference is that Lisa never updates them again.
 *
 * These tests assert the PROPERTY — the servers stay Lisa-managed, in Lisa's
 * block, carrying Lisa's current definition — rather than that the marker
 * string changed.
 * @module tests/unit/codex/mcp-marker-abdication
 */
import { describe, expect, it } from "vitest";

import { mergeCodexMcpServers } from "../../../src/codex/mcp-installer.js";

/** The exact marker that shipped before the family recogniser existed. */
const OLD_START = "# >>> LISA MANAGED MCP SERVERS >>>";

/** Its closing half. */
const OLD_END = "# <<< LISA MANAGED MCP SERVERS <<<";

/** A marker from some other version of the same family. */
const OTHER_START = "# >>> LISA MANAGED MCP SERVERS v1 >>>";

/** Its closing half. */
const OTHER_END = "# <<< LISA MANAGED MCP SERVERS v1 <<<";

/** The family identifier plus the version this build is expected to write. */
const LISA_MCP_VERSION_MARKER = "# >>> LISA MANAGED MCP SERVERS v2";

/** Recognises a Lisa MCP block opener of any version. */
const FAMILY_RE = /# >>> LISA MANAGED MCP SERVERS[^\n]*>>>/g;

/** The server name every case here manages. */
const SERVER = "lisa-thing";

/** The TOML table header for that server. */
const SERVER_TABLE = `[mcp_servers.${SERVER}]`;

/** The command line every fixture uses. */
const NPX = 'command = "npx"';

/** The version Lisa is currently asked to install. */
const CURRENT_SPEC = `${SERVER}@1.2.3`;

/** The version an older block already carries. */
const STALE_SPEC = `${SERVER}@0.9.0`;

/** The server Lisa is asked to manage in every case here. */
const LISA_SERVERS = {
  [SERVER]: { command: "npx", args: ["-y", CURRENT_SPEC] },
} as const;

/**
 * How many Lisa MCP blocks the TOML carries.
 * @param toml Merged configuration.
 * @returns The match count.
 */
function blockCount(toml: string): number {
  return (toml.match(FAMILY_RE) ?? []).length;
}

describe("a Codex config carrying a Lisa block under a previous marker", () => {
  it("keeps managing the server rather than reclassifying it as the host's", () => {
    const existing = [
      OTHER_START,
      SERVER_TABLE,
      NPX,
      `args = ["-y", "${STALE_SPEC}"]`,
      OTHER_END,
      "",
    ].join("\n");

    const merged = mergeCodexMcpServers(existing, LISA_SERVERS);

    // Abdication shows up as the server vanishing from Lisa's block while
    // still being present in the file — so assert the CURRENT definition is
    // the one that survived, not merely that the name appears somewhere.
    expect(merged).toContain(CURRENT_SPEC);
    expect(merged).not.toContain(STALE_SPEC);
  });

  it("leaves exactly one managed block", () => {
    const existing = [OTHER_START, SERVER_TABLE, NPX, OTHER_END, ""].join("\n");

    const merged = mergeCodexMcpServers(existing, LISA_SERVERS);

    // Count alone is not enough here, and measuring showed why: the pre-fix
    // reader also leaves exactly one block — the ORPHAN — because it abdicates
    // and writes none of its own. A bare count passes for the wrong reason, so
    // this pins that the surviving block is the current one.
    expect(blockCount(merged)).toBe(1);
    expect(merged).toContain(`${LISA_MCP_VERSION_MARKER} >>>`);
  });

  it("recognises the exact literal that shipped before the version bump", () => {
    // Not bite proof — the pre-fix reader wrote and looked for this same
    // literal, so it handled it correctly. It is the assertion that would fail
    // if the family recogniser were wrong, which would disown every block in
    // the field at once.
    const existing = [
      OLD_START,
      SERVER_TABLE,
      NPX,
      `args = ["-y", "${STALE_SPEC}"]`,
      OLD_END,
      "",
    ].join("\n");

    const merged = mergeCodexMcpServers(existing, LISA_SERVERS);

    expect(blockCount(merged)).toBe(1);
    expect(merged).toContain(CURRENT_SPEC);
  });

  it("still lets a genuinely host-authored server win", () => {
    // The control. Host-authored servers winning on a name collision is the
    // behaviour the abdication bug was an accidental over-application of, and
    // reclaiming orphans must not cost it.
    const existing = [
      SERVER_TABLE,
      'command = "the-hosts-own-binary"',
      "",
    ].join("\n");

    const merged = mergeCodexMcpServers(existing, LISA_SERVERS);

    expect(merged).toContain("the-hosts-own-binary");
    expect(merged).not.toContain(CURRENT_SPEC);
  });

  it("preserves host TOML sitting outside the block", () => {
    const existing = [
      "[mcp_servers.someone-elses]",
      'command = "their-binary"',
      "",
      OTHER_START,
      SERVER_TABLE,
      NPX,
      OTHER_END,
      "",
    ].join("\n");

    const merged = mergeCodexMcpServers(existing, LISA_SERVERS);

    expect(merged).toContain("someone-elses");
    expect(merged).toContain("their-binary");
  });

  it("still throws loudly on a start marker with no closing marker", () => {
    // The one shape that must stay an error rather than being reconciled:
    // reclaiming it would swallow whatever follows, which may be entirely the
    // host's. Malformed is loud; renamed is silent — and only the second is
    // what this change makes safe.
    const existing = [OTHER_START, SERVER_TABLE, NPX, ""].join("\n");

    expect(() => mergeCodexMcpServers(existing, LISA_SERVERS)).toThrow(
      /without closing marker/
    );
  });
});
