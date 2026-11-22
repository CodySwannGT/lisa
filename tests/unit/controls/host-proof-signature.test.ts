/**
 * Host proof input and attestation receipts have separate signed purposes.
 * @module
 */
import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  signHostProof,
  verifyHostProof,
} from "../../../src/controls/host-proof-signature.js";

const IMPORT = "host-proof-import";
const RECEIPT = "host-proof-receipt";
const BODY = { entry: "code-style@api", marker: "synthetic record" };

describe("host proof signatures", () => {
  const attestor = generateKeyPairSync("ed25519");

  it("verifies the canonical payload for its original purpose", () => {
    const receipt = signHostProof(RECEIPT, BODY, attestor.privateKey);
    const reordered = {
      ...receipt,
      body: { marker: BODY.marker, entry: BODY.entry },
    };

    expect(verifyHostProof(reordered, RECEIPT, attestor.publicKey)).toEqual(
      BODY
    );
  });

  it("requires an authorized signer and the expected purpose", () => {
    const other = generateKeyPairSync("ed25519");
    const bundle = signHostProof(IMPORT, BODY, attestor.privateKey);

    expect(verifyHostProof(bundle, IMPORT, other.publicKey)).toBeNull();
    expect(verifyHostProof(bundle, RECEIPT, attestor.publicKey)).toBeNull();
    expect(
      verifyHostProof(
        { ...bundle, purpose: RECEIPT },
        RECEIPT,
        attestor.publicKey
      )
    ).toBeNull();
  });

  it("refuses a changed body, an incomplete signature and an extra wrapper field", () => {
    const receipt = signHostProof(RECEIPT, BODY, attestor.privateKey);
    const variants = [
      { ...receipt, body: { ...BODY, marker: "modified record" } },
      { ...receipt, signature: receipt.signature.slice(1) },
      { ...receipt, ignored: true },
    ];

    for (const variant of variants) {
      expect(verifyHostProof(variant, RECEIPT, attestor.publicKey)).toBeNull();
    }
  });
});
