/**
 * The failed-bootstrap message must say what IS here, not only what was missing.
 *
 * Lisa looks up `<PREFIX>_<namespace>`, where the namespace defaults to the
 * project's own name. A workstation holding one bootstrap credential therefore
 * fails closed in every OTHER project on it — and the message this suite covers
 * used to report only the absence.
 *
 * That reads as "the provider is unavailable on this machine". Two sessions
 * drew exactly that conclusion, and one turned it into a standing instruction
 * telling other agents the CLI was missing and not to install it. The CLI was
 * installed and working throughout; only the credential NAME was wrong
 * (CodySwannGT/lisa#3555).
 *
 * So the property under test is not "the message mentions the key". It is that
 * the message **separates the two causes** — nothing provisioned anywhere, vs.
 * something provisioned under a different name — because they have different
 * remedies and the old text could not tell them apart.
 *
 * Every source is injected. A suite that read the real environment, the real
 * bootstrap directory, or the real keychain would assert against whatever the
 * developer's own workstation happens to hold — passing or failing by accident,
 * and failing on the one machine that reproduces the bug.
 * @module tests/unit/secrets/bootstrap-missing-diagnosis
 */
import { describe, expect, it } from "vitest";

import { describeMissingBootstrap } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/providers.mjs";

/** The name a project would look up, derived from its own name. */
const WANTED = "BWS_ACCESS_TOKEN_projectb";

/** A credential provisioned for a DIFFERENT project on the same workstation. */
const SIBLING = "BWS_ACCESS_TOKEN_projecta";

/** A second sibling, for the plural case. */
const OTHER_SIBLING = "BWS_ACCESS_TOKEN_projectc";

/** Bootstrap config as the resolver holds it when the lookup fails. */
const bootstrap = { key: WANTED, sources: ["env", "keychain"] };

/** A plausible token value, used wherever the value itself is irrelevant. */
const TOKEN = "a-token-value";

/** The sentence that must appear only when nothing at all is provisioned. */
const NOTHING_PROVISIONED = "No bootstrap credential of any name was found";

/** The sentence that must appear only when a differently-named one exists. */
const MISMATCH = "NAME MISMATCH";

/**
 * Build a complete set of injected sources for one case.
 * @param over Sources this case supplies; the rest are empty.
 * @param over.env Environment variables visible to discovery.
 * @param over.files Bootstrap file names on disk.
 * @param over.keychain Keychain service names.
 * @param over.cli Whether the provider CLI is on PATH.
 * @returns The dependency object `describeMissingBootstrap` accepts.
 */
const sources = (over: {
  env?: Record<string, string>;
  files?: string[];
  keychain?: string[];
  cli?: boolean | null;
}) => ({
  cliPresent: () => over.cli ?? true,
  env: over.env ?? {},
  keychainNames: () => over.keychain ?? [],
  listFiles: () => over.files ?? [],
});

describe("a bootstrap that is missing because nothing is provisioned", () => {
  it("says so, and does not imply something exists under another name", () => {
    const message = describeMissingBootstrap(bootstrap, sources({}));

    expect(message).toContain(WANTED);
    expect(message).toContain(NOTHING_PROVISIONED);
    // The distinguishing claim. Asserting its ABSENCE is the point: the two
    // causes must not be described with the same words.
    expect(message).not.toContain(MISMATCH);
  });
});

describe("a bootstrap that is missing because the name differs", () => {
  it("names the credential that does exist, and calls it a name mismatch", () => {
    const message = describeMissingBootstrap(
      bootstrap,
      sources({ env: { [SIBLING]: TOKEN } })
    );

    expect(message).toContain(MISMATCH);
    expect(message).toContain(SIBLING);
    expect(message).not.toContain(NOTHING_PROVISIONED);
  });

  it("never puts the credential's VALUE in the message", () => {
    const value = "super-secret-token-value";

    // The message exists to be pasted into a terminal, a ticket, or a chat
    // between agents. Reporting names is the fix; reporting values would make
    // the fix worse than the defect.
    expect(
      describeMissingBootstrap(
        bootstrap,
        sources({ env: { [SIBLING]: value } })
      )
    ).not.toContain(value);
  });

  it("offers the config that actually resolves it, naming the real key", () => {
    const message = describeMissingBootstrap(
      bootstrap,
      sources({ env: { [SIBLING]: TOKEN } })
    );

    expect(message).toContain(`"bootstrap": { "key": "${SIBLING}" }`);
  });

  it("lists every sibling, so the operator picks rather than guesses", () => {
    const message = describeMissingBootstrap(
      bootstrap,
      sources({
        env: { [SIBLING]: TOKEN },
        keychain: [OTHER_SIBLING],
      })
    );

    expect(message).toContain(SIBLING);
    expect(message).toContain(OTHER_SIBLING);
  });

  it("says where each one lives, since the remedy differs by store", () => {
    const message = describeMissingBootstrap(
      bootstrap,
      sources({ keychain: [SIBLING] })
    );

    expect(message).toContain(`${SIBLING}  (keychain)`);
  });

  it("finds one that exists only as a bootstrap file", () => {
    // The Linux store. Omitting it would make the message correct on macOS and
    // wrong everywhere else.
    const message = describeMissingBootstrap(
      bootstrap,
      sources({ files: [SIBLING] })
    );

    expect(message).toContain(MISMATCH);
    expect(message).toContain(`${SIBLING}  (bootstrap file)`);
  });

  it("ignores a bootstrap belonging to a different provider", () => {
    // `DOPPLER_TOKEN_*` is a bootstrap, but pointing a Bitwarden project at it
    // would hand `bws` a Doppler token. A sibling is only a sibling within one
    // provider's prefix.
    const message = describeMissingBootstrap(
      bootstrap,
      sources({ env: { DOPPLER_TOKEN_projecta: "doppler-token-value" } })
    );

    expect(message).toContain(NOTHING_PROVISIONED);
    expect(message).not.toContain("DOPPLER_TOKEN_projecta");
  });

  it("does not list a name whose stored value is empty", () => {
    // An entry with no value is not a credential, and offering it sends the
    // operator to a store that will fail the same way a second time.
    const message = describeMissingBootstrap(
      bootstrap,
      sources({ env: { [OTHER_SIBLING]: "   ", [SIBLING]: TOKEN } })
    );

    expect(message).toContain(`${SIBLING}  (env)`);
    expect(message).not.toContain(OTHER_SIBLING);
  });

  it("never lists the missing key itself, even when another store holds it", () => {
    // `sources` is what this project SEARCHES; discovery looks wider. A key
    // found only in a store this project does not search must not be presented
    // as an available alternative to itself.
    const message = describeMissingBootstrap(
      { key: WANTED, sources: ["env"] },
      sources({ env: { [SIBLING]: TOKEN }, keychain: [WANTED] })
    );

    expect(message).toContain(`${SIBLING}  (env)`);
    expect(message).not.toContain(`${WANTED}  (`);
  });

  it("does not offer the missing key back as its own remedy", () => {
    // An empty value is not a credential. Counting it as a sibling would tell
    // the operator to set the key to the name that just failed.
    const message = describeMissingBootstrap(
      bootstrap,
      sources({ env: { [SIBLING]: TOKEN, [WANTED]: "   " } })
    );

    expect(message).toContain(`"key": "${SIBLING}"`);
    expect(message).not.toContain(`"key": "${WANTED}"`);
  });
});

describe("the missing-binary misreading, closed explicitly", () => {
  it("states the CLI is installed when it is, rather than leaving it inferred", () => {
    const message = describeMissingBootstrap(
      bootstrap,
      sources({ cli: true, env: { [SIBLING]: TOKEN } })
    );

    expect(message).toContain("The provider CLI is installed and working");
    expect(message).toContain("do not reinstall it");
  });

  it("says plainly when the CLI really is absent", () => {
    // The opposite reading must also be available, or the message is a
    // reassurance rather than a report.
    const message = describeMissingBootstrap(
      bootstrap,
      sources({ cli: false, env: { [SIBLING]: TOKEN } })
    );

    expect(message).toContain("NOT found on PATH");
    expect(message).not.toContain("do not reinstall it");
  });

  it("never tells an operator the provider is unavailable on this machine", () => {
    const message = describeMissingBootstrap(
      bootstrap,
      sources({ env: { [SIBLING]: TOKEN } })
    ).toLowerCase();

    expect(message).not.toContain("secrets are unavailable");
    expect(message).not.toContain("provider is unavailable");
  });
});
