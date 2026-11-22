/** Read the profile tables emitted by Bitwarden's own configuration writer. */
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { boundedChildOutput } from "../../lisa-setup-workstation/scripts/bounded-child.mjs";

const profileHeader = /^\[profiles\.(.+)\]$/u;
const profileField = /^(\w+) = (.+)$/u;
const endpointFields = new Set([
  "server_base",
  "server_api",
  "server_identity",
]);

function readString(text) {
  if (text.startsWith('"')) return JSON.parse(text);
  if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1);
  if (/^[a-z\d_-]+$/iu.test(text)) return text;
  throw new Error("invalid Bitwarden profile string");
}

function parseProfiles(text) {
  const profiles = new Map();
  let selected;
  let multiline;
  for (const line of text.split(/\r?\n/u)) {
    if (multiline) {
      if (line.endsWith(multiline)) multiline = undefined;
      continue;
    }
    if (!line) continue;
    const header = profileHeader.exec(line);
    if (header) {
      const name = readString(header[1]);
      if (profiles.has(name)) throw new Error("duplicate Bitwarden profile");
      selected = {};
      profiles.set(name, selected);
      continue;
    }
    const field = profileField.exec(line);
    if (!selected || !field) throw new Error("invalid Bitwarden profile");
    const [, key, value] = field;
    const delimiter =
      value.startsWith('"""') || value.startsWith("'''")
        ? value.slice(0, 3)
        : undefined;
    if (delimiter && !value.slice(3).endsWith(delimiter)) multiline = delimiter;
    if (endpointFields.has(key)) {
      selected[key] = delimiter ? null : readString(value);
    }
  }
  if (multiline) throw new Error("unterminated Bitwarden profile");
  return profiles;
}

/** Validate and normalize a private copy through bws, without a provider login. */
export function readBitwardenProfiles(config, env) {
  const scratch = mkdtempSync(join(tmpdir(), "lisa-bitwarden-profile-"));
  try {
    const path = join(scratch, "config");
    const probe = `lisa-read-${randomUUID()}`;
    writeFileSync(path, config, { mode: 0o600 });
    boundedChildOutput(
      "bws",
      [
        "config",
        "state-opt-out",
        "true",
        "--profile",
        probe,
        "--config-file",
        path,
      ],
      {
        env: Object.fromEntries(
          ["PATH", "PATHEXT", "SystemRoot", "WINDIR"]
            .filter(key => env[key] !== undefined)
            .map(key => [key, env[key]])
        ),
        stdio: ["ignore", "ignore", "pipe"],
        timeout: 5_000,
        maxBuffer: 16 * 1024,
      }
    );
    const profiles = parseProfiles(readFileSync(path, "utf8"));
    if (!profiles.delete(probe))
      throw new Error("Bitwarden configuration was not validated");
    return profiles;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
