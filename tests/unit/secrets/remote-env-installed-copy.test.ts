/**
 * Drift guard for the remote-env scripts Lisa installs into itself.
 *
 * `/lisa:setup:remote-env --install` copies its assets into
 * `scripts/lisa-remote-env/`, and those copies are committed on purpose: a
 * container that has just cloned the repository has never seen the plugin they
 * came from, so the copy is what actually executes there.
 *
 * Being a copy is what makes it rot. The assets are covered by tests and the
 * installed files were covered by nothing, so they fell 74 lines behind —
 * missing the dependency install, the node ordering fix and Yarn Classic
 * detection. Every one of those was written for remote containers, and every
 * one of them was invisible in a remote container, because the file the
 * container runs had not been refreshed.
 *
 * The failure is silent by construction: nothing errors, the old script just
 * keeps working the old way. So the check is byte equality, and the fix when it
 * goes red is to re-run `--install` and commit the result.
 * @module tests/unit/secrets/remote-env-installed-copy
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Where the reviewed, tested originals live. */
const ASSETS = "plugins/src/base/skills/lisa-setup-remote-env/assets";

/** Where `--install` puts them, and where a container finds them. */
const INSTALLED = path.join("scripts", "lisa-remote-env");

/** Every asset the installer writes. */
const SCRIPTS = [
  "setup.sh",
  "session-start.sh",
  "materialized-env-authority.mjs",
] as const;

describe("installed remote-env scripts", () => {
  it.each(SCRIPTS)(
    "%s is identical to the asset it was installed from",
    script => {
      expect(readFileSync(path.join(INSTALLED, script))).toEqual(
        readFileSync(path.join(ASSETS, script))
      );
      expect(statSync(path.join(INSTALLED, script)).mode & 0o777).toBe(0o755);
    }
  );
});
