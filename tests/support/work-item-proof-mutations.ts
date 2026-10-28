/** Actual-byte/native-state mutations used by negative proof controls. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { putAsset, proofFixture } from "./work-item-proof-fixture.js";
/** Complete owned fixture with actual source identities and proof resources. */
export type ProofFixture = ReturnType<typeof proofFixture>;
/** Named concrete unusable-proof input and its expected public outcome. */
export type Denial = {
  name: string;
  category: "pending-proof" | "invalid-proof" | "read-error";
  change: (fixture: ProofFixture) => void;
  afterAttach?: (fixture: ProofFixture) => void;
};

/**
 * Edit a typed/verdict native asset and return its newly observed pointer.
 * @returns Exact replacement native asset pointer.
 * @param fixture - Owned disposable repository and controlled provider.
 * @param id - Native fixture asset identifier.
 * @param change - Specific proof mutation under test.
 */
export function editAsset(
  fixture: ProofFixture,
  id: number,
  change: (value: ReturnType<typeof JSON.parse>) => void
) {
  const value = JSON.parse(
    readFileSync(
      path.join(fixture.env.FAKE_GH_ASSET_DIRECTORY!, `${id}.bin`),
      "utf8"
    )
  );
  change(value);
  return putAsset(fixture, id, value);
}

/**
 * Edit native issue state without inventing a successful provider mutation.
 * @param fixture - Owned disposable repository and controlled provider.
 * @param change - Specific proof mutation under test.
 */
export function editNative(
  fixture: ProofFixture,
  change: (value: ReturnType<typeof JSON.parse>) => void
) {
  const file = fixture.env.FAKE_GH_STATE_FILE!;
  const value = JSON.parse(readFileSync(file, "utf8"));
  change(value);
  writeFileSync(file, JSON.stringify(value));
}
