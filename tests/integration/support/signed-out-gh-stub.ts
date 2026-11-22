/**
 * A `gh` stub that behaves like the platform's tool on a machine where nobody
 * is signed in (CodySwannGT/lisa#4981).
 *
 * The built `lisa controls merge-protection` starts the real `gh` program, so
 * an integration suite cannot hand it a function. It puts this stub first on
 * `PATH` instead. The stub never reaches a network and holds no credential:
 * it appends the arguments of every call to a log, prints what the real tool
 * prints when it has no account to use, and exits the way the real tool does.
 * That makes it an honest stand-in for "the credential was removed", and
 * nothing more: no live platform is asked anything.
 *
 * It has the same folders as `./protect-gh-stub.ts`, so that module's
 * `protectGhEnv` and `recordedGhCalls` work on it unchanged.
 * @module tests/integration/support/signed-out-gh-stub
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import type { ProtectGhStub } from "./protect-gh-stub.js";
import { writeStub } from "./shell-guard-refusal-fixture.js";

/** What the platform's tool prints when no account is signed in. */
export const SIGNED_OUT_MESSAGE =
  "To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.";

/** The exit status the platform's tool gives when it has no account. */
const SIGNED_OUT_STATUS = 4;

const GH_BODY = `state="\${LISA_GH_STATE:?}"
printf '%s\\n' "$*" >> "$state/requests.log"
cat >&2 <<'MESSAGE'
${SIGNED_OUT_MESSAGE}
MESSAGE
exit ${String(SIGNED_OUT_STATUS)}
`;

/**
 * Install the stub.
 * @param root - An empty folder to build the stub in
 * @returns The stub's folders
 */
export function writeSignedOutGh(root: string): ProtectGhStub {
  const binDir = path.join(root, "bin");
  const stateDir = path.join(root, "state");
  mkdirSync(path.join(stateDir, "gh-config"), { recursive: true });
  writeStub(binDir, "gh", GH_BODY);
  return { binDir, stateDir };
}
