/** Opt-in transport hardening; existing work-item fixture defaults stay intact. */
import { chmodSync, copyFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Fixture } from "./work-item-cli.js";

/**
 * Install the write-driven provider in one owned disposable repository.
 * @param fixture - Existing fixture whose fake gh will be replaced.
 * @param initial - Initial native-shaped issue response, before any mutation.
 * @returns Path of the append-only attempted-write record.
 */
export function installStatefulProvider(
  fixture: Fixture,
  initial: string
): string {
  const executable = path.join(fixture.root, "fake-bin/gh");
  const state = path.join(fixture.root, "provider-state.json");
  const writes = path.join(fixture.root, "provider-writes.jsonl");
  const unhandled = path.join(fixture.root, "provider-unhandled.jsonl");
  copyFileSync(
    path.join(process.cwd(), "tests/support/work-item-stateful-gh.mjs"),
    executable
  );
  copyFileSync(
    path.join(process.cwd(), "tests/support/work-item-provider-api.mjs"),
    path.join(fixture.root, "fake-bin/work-item-provider-api.mjs")
  );
  chmodSync(executable, 0o755);
  writeFileSync(state, initial);
  writeFileSync(writes, "");
  writeFileSync(unhandled, "");
  fixture.env.FAKE_GH_STATE_FILE = state;
  fixture.env.FAKE_GH_WRITES_FILE = writes;
  fixture.env.FAKE_GH_UNHANDLED_FILE = unhandled;
  return writes;
}
