/** Exercise actual setup with a complete inherited lease in disposable roots. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  SCRATCH_OWNER_FILE,
  createScratchOwnerRecord,
  scratchPathIdentity,
  writeScratchOwnerRecord,
} from "../../../src/configs/vitest/scratch-owner.ts";
import {
  createSupervisedWorkerScope,
  removeSupervisedWorkerScope,
} from "../../../src/configs/vitest/scratch-supervision.ts";

const [root, mode] = process.argv.slice(2);
const declared = path.join(root, "declared");
const base = mode === "foreign-base" ? path.join(root, "foreign") : declared;
const namespace = path.join(
  base,
  mode === "foreign-namespace" ? "other-scratch" : "lisa-scratch"
);
const suite = path.join(namespace, "run-fixture");
fs.mkdirSync(declared, { recursive: true, mode: 0o700 });
fs.mkdirSync(suite, { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(suite, "sentinel"), "keep");
const owner = createScratchOwnerRecord({
  authority: { namespace: scratchPathIdentity(namespace) },
  root: suite,
  suiteLabel: "fixture",
  registeredPrefixes: [],
});
writeScratchOwnerRecord(suite, owner);
const lease = {
  schema: 1,
  token: owner.token,
  suiteRootBasename: path.basename(suite),
  baseCanonicalPath: fs.realpathSync(base),
  namespace: scratchPathIdentity(namespace),
  suiteRoot: scratchPathIdentity(suite),
  suiteLabel: "fixture",
  registeredPrefixes: [],
};
const parent = mode.startsWith("nested")
  ? createSupervisedWorkerScope(lease)
  : undefined;
const inheritedTemp = parent?.path ?? (mode === "direct" ? suite : declared);
if (parent && mode === "nested-stale-owner") {
  fs.writeFileSync(
    path.join(parent.path, SCRATCH_OWNER_FILE),
    JSON.stringify({
      ...parent.owner,
      processBirthFingerprint: "stale",
    })
  );
}
Object.assign(process.env, {
  TMPDIR: inheritedTemp,
  TMP: inheritedTemp,
  TEMP: inheritedTemp,
  LISA_TEST_RUN_LEASE: JSON.stringify(lease),
  LISA_TEST_SCRATCH_SUITE: "fixture",
  LISA_TEST_SCRATCH_PREFIXES: "[]",
});
try {
  await import("../../../src/configs/vitest/scratch-setup.ts");
  process.stdout.write(
    JSON.stringify({ accepted: true, worker: os.tmpdir(), suite })
  );
} catch (error) {
  process.stdout.write(
    JSON.stringify({ accepted: false, error: error.message, suite })
  );
}
if (parent)
  process.once("exit", () => removeSupervisedWorkerScope(parent, lease));
