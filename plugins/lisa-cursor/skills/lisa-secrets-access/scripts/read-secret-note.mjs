#!/usr/bin/env node
/**
 * Print one credential's usage note without opening the values file.
 *
 * This is a separate program from the resolver on purpose. An agent about to
 * use a credential needs to know its blast radius — scope, owner, rotation,
 * cautions — and should be able to learn that without any code path that could
 * serialize a secret value. Values never enter this process, so its output
 * cannot leak one even if it is logged.
 *
 * Usage:
 *   read-secret-note.mjs NAME
 * @module read-secret-note
 */

import { existsSync, readFileSync } from "node:fs";

import { materializedPaths, readConfig } from "./surfaces.mjs";

/** A key must be an exact environment-variable name; see the naming rule. */
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Load the notes manifest, rejecting a shape this version does not understand.
 * @param {string} notesFile Path to `secret-notes.json`.
 * @returns {Record<string, string>} Notes by exact key name.
 */
export function loadNotes(notesFile) {
  if (!existsSync(notesFile)) {
    throw new Error(
      `secret notes are unavailable at ${notesFile}.\n` +
        `Run the remote environment bootstrap before using a credential.`
    );
  }
  const payload = JSON.parse(readFileSync(notesFile, "utf8"));
  if (payload.schemaVersion !== 1 || typeof payload.secrets !== "object") {
    throw new Error("unsupported or malformed secret-notes manifest");
  }
  return payload.secrets;
}

/**
 * Resolve one note, treating absence as a stop condition rather than a default.
 *
 * A missing note is deliberately fatal for the credential that lacks it. The
 * alternative — carrying on with an inferred purpose — is how a token scoped to
 * one repository gets used against another, and the failure is silent.
 * @param {string} name Exact environment-variable name.
 * @param {Record<string, string>} notes Loaded manifest entries.
 * @returns {string} The note text.
 */
export function noteFor(name, notes) {
  if (!ENV_KEY.test(name)) {
    throw new Error("secret key must be an exact environment-variable name");
  }
  const note = notes[name];
  if (typeof note !== "string" || !note.trim()) {
    throw new Error(
      `no usable note exists for ${name}.\n` +
        `A missing or ambiguous note is a stop condition for that credential — ` +
        `do not infer its purpose from its name.`
    );
  }
  return note;
}

function main() {
  const [name] = process.argv.slice(2);
  if (!name) throw new Error("usage: read-secret-note.mjs NAME");
  const cfg = readConfig();
  const { notesFile } = materializedPaths(cfg.namespace);
  console.log(noteFor(name, loadNotes(notesFile)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
