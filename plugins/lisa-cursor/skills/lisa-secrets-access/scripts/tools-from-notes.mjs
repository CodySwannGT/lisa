/**
 * Read which CLIs a secret set implies, from the notes stored beside it.
 *
 * A session with no checkout has no `remoteEnv.tools` to consult, so the
 * toolchain fell back to "install the whole catalogue" — which spends a
 * setup-script time budget on CLIs the container may never use, and on a
 * five-minute budget that is the difference between a session and no session.
 *
 * The vault already knows. A credential and the CLI that consumes it belong
 * together: `SONARQUBE_CLI_TOKEN` is only useful with `sonar`, and a machine
 * account that cannot see the token has no business installing the CLI. Using
 * the notes makes the provider grant the single boundary for both, instead of a
 * second list to keep in step.
 *
 * Notes are free text with a loose `key: value` convention already in use
 * (`scope:`, `owner:`, `consumers:`), so this reads a `tool:` or `tools:` line
 * in the same shape rather than inventing a format.
 *
 * **Names are matched against a catalogue, never executed.** A note is
 * remote-influenced input: anyone who can edit a secret in the vault can edit
 * its note. Selecting from a known set means the worst a hostile note can do is
 * ask for a CLI Lisa already ships a pinned, checksummed entry for — it can
 * never introduce a URL, a version, or a command.
 * @module tools-from-notes
 */

/** Matches `tool: name` or `tools: a, b`, case-insensitively, one per line. */
const TOOL_LINE = /^[ \t]*tools?[ \t]*:[ \t]*(.+)$/gim;

/**
 * Collect the tool names a set of notes asks for.
 *
 * Unknown names are dropped rather than reported as an error: a note naming a
 * CLI this version of Lisa does not ship is a request from the future, not a
 * broken environment, and failing setup over it would be a poor trade.
 * @param {Record<string, string>} notes Note text by secret name.
 * @param {string[]} known Tool names Lisa can install.
 * @returns {string[]} Known tool names, deduplicated, in catalogue order.
 */
export function toolsFromNotes(notes, known) {
  const allowed = new Set(known);
  const wanted = new Set();

  for (const note of Object.values(notes ?? {})) {
    if (typeof note !== "string") continue;
    // `matchAll` rather than `exec` in a loop: the regex is global, and a shared
    // lastIndex across secrets would skip matches in every note but the first.
    for (const [, list] of note.matchAll(TOOL_LINE)) {
      for (const raw of list.split(",")) {
        const name = raw.trim().toLowerCase();
        if (allowed.has(name)) wanted.add(name);
      }
    }
  }

  // Catalogue order, not note order, so the plan reads the same however the
  // vault happens to be arranged.
  return known.filter(name => wanted.has(name));
}
