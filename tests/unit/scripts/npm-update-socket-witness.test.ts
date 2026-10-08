/** Missing roots and dangling aliases cannot certify original-hook scratch absence. */
import { symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hookSocketWitness } from "../../fixtures/npm-update-hosted-runtime/socket-witness.mjs";
import { createSupervisedUnixFixture } from "../../helpers/supervised-unix-fixture.js";
import { SCRATCH_SUPERVISION_LEASE_ENV } from "../../../src/configs/vitest/scratch-supervision.js";

const metrics = {
  nativeBind: true,
  socketAbsent: true,
  tokenBytes: 32,
  socketBytes: 95,
};
const REFUSAL = "original hook scratch socket differs";

describe("native hook scratch witness", () => {
  it.each([undefined, null, "", " ", 42, false, {}])(
    "refuses an unobserved root %s",
    root => {
      expect(() => hookSocketWitness({ ...metrics, root })).toThrow(REFUSAL);
    }
  );

  it("requires actual absence and refuses a dangling symlink", () => {
    const owned = createSupervisedUnixFixture(
      "hook-reader.sock",
      process.env[SCRATCH_SUPERVISION_LEASE_ENV]
    );
    try {
      const absent = join(owned.root, "removed-native-root");
      expect(hookSocketWitness({ ...metrics, root: absent })).toEqual({
        syntheticSocketNativeBind: true,
        ownedRootAbsent: true,
        socketBytes: 95,
      });
      const alias = join(owned.root, "dangling-alias");
      symlinkSync(absent, alias);
      expect(() => hookSocketWitness({ ...metrics, root: alias })).toThrow(
        REFUSAL
      );
      writeFileSync(absent, "owned fixture");
      expect(() => hookSocketWitness({ ...metrics, root: absent })).toThrow(
        REFUSAL
      );
    } finally {
      owned.close();
    }
  });
});
