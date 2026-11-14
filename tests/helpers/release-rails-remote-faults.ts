/**
 * Remote failure modes for the release-rails race tests: a remote that
 * refuses pushes, one that vanishes mid-push, and a push whose acceptance
 * never reaches the client. Each one installs a hook on the fixture's bare
 * remote or a shim on the job's PATH, so the shipped workflow meets a real
 * git failure rather than a mocked one.
 * @module tests/helpers/release-rails-remote-faults
 */
import * as path from "node:path";

import * as fs from "fs-extra";

import type { ReleaseFixture } from "./release-rails-job.js";
import { resolveGit } from "../support/git-executable.js";

/** The bare remote's pre-receive hook, relative to the remote. */
const PRE_RECEIVE = path.join("hooks", "pre-receive");

/**
 * Installs an executable script.
 * @param file - Where to write it.
 * @param lines - Its lines, without trailing newline.
 */
function writeExecutable(file: string, lines: readonly string[]): void {
  fs.writeFileSync(file, [...lines, ""].join("\n"));
  fs.chmodSync(file, 0o700);
}

/**
 * Makes the remote refuse every push without the branch moving: a revoked
 * deploy key, a ruleset, or a network failure, rather than a race.
 * @param fixture - The fixture whose remote refuses.
 */
export function refuseAllPushes(fixture: ReleaseFixture): void {
  writeExecutable(path.join(fixture.remote, PRE_RECEIVE), [
    "#!/bin/sh",
    "echo 'push refused by policy' >&2",
    "exit 1",
  ]);
}

/**
 * Makes the remote reject the next push and then disappear, so the run's
 * follow-up fetch fails too and it cannot tell a race from a refusal.
 * @param fixture - The fixture whose remote vanishes.
 */
export function vanishOnPush(fixture: ReleaseFixture): void {
  writeExecutable(path.join(fixture.remote, PRE_RECEIVE), [
    "#!/bin/sh",
    `mv '${fixture.remote}' '${fixture.remote}.gone'`,
    "exit 1",
  ]);
}

/**
 * Puts back a remote that `vanishOnPush` moved away, minus its hook.
 * @param fixture - The fixture whose remote vanished.
 */
export function restoreVanished(fixture: ReleaseFixture): void {
  fs.renameSync(`${fixture.remote}.gone`, fixture.remote);
  fs.removeSync(path.join(fixture.remote, PRE_RECEIVE));
}

/**
 * Shadows `git` so a push the server accepted still reports failure to the
 * client, as when the connection drops before the server's reply arrives.
 * @param fixture - The fixture whose runs see the shadowed `git`.
 */
export function dropPushReplies(fixture: ReleaseFixture): void {
  writeExecutable(path.join(fixture.stubBin, "git"), [
    "#!/bin/bash",
    `'${resolveGit()}' "$@"`,
    "status=$?",
    'if [ "$1" = push ] && [ "$status" -eq 0 ]; then',
    "  echo 'fatal: the remote end hung up unexpectedly' >&2",
    "  exit 128",
    "fi",
    'exit "$status"',
  ]);
}
