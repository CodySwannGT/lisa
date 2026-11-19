/**
 * `lisa controls install-carriers` over an install made before the push
 * carrier told the runner what is being pushed (CodySwannGT/lisa#4989).
 *
 * A repository that ran the command earlier holds the earlier text: the
 * carrier script under `.lisa/hooks/`, and, where the repository has a push
 * hook of its own, the lines added to that hook. A run of the command must
 * bring both up to date in place and say `updated`: the script replaced
 * whole, the added lines replaced between their markers with everything else
 * in the hook left as it was. A second run must then change nothing.
 * @module tests/integration/controls-push-carrier-update
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  carrierCall,
  carrierMarkers,
  carrierScript,
} from "../../src/controls/carrier-script.js";
import {
  gitHooksFolder,
  writeExecutable,
} from "../support/carrier-hook-owners.js";
import {
  commitInstalled,
  dirt,
  installCarriers,
} from "../support/carrier-install.js";
import {
  PUSH_CALL_BLOCK_BEFORE,
  PUSH_CARRIER_BEFORE,
  type PushRepository,
  pushRepository,
} from "../support/carrier-push.js";

const PUSH_SCRIPT = ".lisa/hooks/pre-push";
const UPDATED = "updated";
const ALREADY_WIRED = "already-wired";
// Quoted: an apostrophe on its own opens a quote that nothing closes, and
// the lines added after it would then be text, which the command refuses.
const HOST_HOOK = '#!/bin/sh\necho "the repository\'s own push check"\n';
const { begin: BEGIN, end: END } = carrierMarkers("push");

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Build F-mixed with a remote, removed when the case ends.
 * @returns The repository
 */
function built(): PushRepository {
  const repository = pushRepository();
  cleanups.push(repository.cleanup);
  return repository;
}

/**
 * Count the lines of a text that are exactly one marker.
 * @param text - The text
 * @param marker - The marker line
 * @returns How many times it appears
 */
function count(text: string, marker: string): number {
  return text.split("\n").filter(line => line === marker).length;
}

describe.skipIf(process.platform === "win32")(
  "install-carriers over the earlier push carrier",
  () => {
    it("replaces the earlier script where git runs the carrier itself", async () => {
      const { root } = built();
      await installCarriers(root);
      const script = path.join(root, PUSH_SCRIPT);
      writeFileSync(script, PUSH_CARRIER_BEFORE);
      commitInstalled(root);

      const run = await installCarriers(root);
      const again = await installCarriers(root);
      const written = readFileSync(script, "utf8");

      expect(PUSH_CARRIER_BEFORE).not.toBe(carrierScript("push"));
      expect(run.code).toBe(0);
      expect(run.result?.outcome).toBe(UPDATED);
      expect(run.result?.changes).toEqual([
        { action: "update", path: PUSH_SCRIPT },
      ]);
      expect(
        run.result?.enforcement_points.find(point => point.moment === "push")
          ?.outcome
      ).toBe(UPDATED);
      expect(written).toBe(carrierScript("push"));
      expect([count(written, BEGIN), count(written, END)]).toEqual([1, 1]);
      expect(again.code).toBe(0);
      expect(again.result?.outcome).toBe(ALREADY_WIRED);
      expect(again.result?.changes).toEqual([]);
      expect(dirt(root)).toBe(` M ${PUSH_SCRIPT}`);
    });

    it("replaces the earlier lines in a hook of the repository, between their markers", async () => {
      const { root } = built();
      const hook = path.join(gitHooksFolder(root), "pre-push");
      writeExecutable(hook, HOST_HOOK);
      await installCarriers(root);
      writeFileSync(path.join(root, PUSH_SCRIPT), PUSH_CARRIER_BEFORE);
      writeFileSync(
        hook,
        `${HOST_HOOK}\n${PUSH_CALL_BLOCK_BEFORE}\necho added by the repository later\n`
      );
      commitInstalled(root);

      const run = await installCarriers(root);
      const again = await installCarriers(root);
      const written = readFileSync(hook, "utf8");

      expect(run.code).toBe(0);
      expect(run.result?.hook_owner).toBe("git-hooks");
      expect(run.result?.outcome).toBe(UPDATED);
      expect(run.result?.changes).toEqual([
        { action: "update", path: PUSH_SCRIPT },
        { action: "update", path: ".git/hooks/pre-push" },
      ]);
      expect(
        run.result?.enforcement_points.map(point => point.outcome)
      ).toEqual([UPDATED, UPDATED]);
      expect(written).toBe(
        `${HOST_HOOK}\n${[BEGIN, ...carrierCall("push"), END].join("\n")}\necho added by the repository later\n`
      );
      expect([count(written, BEGIN), count(written, END)]).toEqual([1, 1]);
      expect(again.code).toBe(0);
      expect(again.result?.outcome).toBe(ALREADY_WIRED);
      expect(again.result?.changes).toEqual([]);
    });
  }
);
