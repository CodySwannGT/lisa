/**
 * What `listBootstrapFiles` is allowed to report, against a real directory.
 *
 * These names are not internal. They are rendered into an operator-facing
 * failure message AND into a `.lisa.config.json` snippet the operator is invited
 * to paste, so the directory listing is an untrusted input to a document
 * somebody will copy (CodySwannGT/lisa#3555).
 *
 * Two filters, both load-bearing:
 * - **Grammar** — a name outside the key grammar is not one this module wrote,
 *   and one carrying a quote or newline corrupts the suggested JSON rather than
 *   merely looking odd.
 * - **Content** — an empty file is not a credential. The environment scan
 *   already refuses empty values, so listing empty FILES would make the two
 *   stores disagree about what counts as provisioned.
 *
 * Driven through a real temp directory rather than a mocked `fs`: the property
 * is what the filesystem actually hands back, and a mock would encode this
 * suite's guess about that instead of measuring it.
 * @module tests/unit/secrets/bootstrap-file-listing
 */
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listBootstrapFiles } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/bootstrap-store.mjs";

/** A well-formed bootstrap name holding a credential. */
const GOOD = "BWS_ACCESS_TOKEN_projecta";

/** A plausible credential body, where the value itself is irrelevant. */
const TOKEN = "a-token-value";

let home: string;
let dir: string;
let env: Record<string, string>;

/**
 * Writes one file into the bootstrap directory.
 * @param name The file name.
 * @param body Its contents.
 */
const put = (name: string, body: string): void => {
  fs.writeFileSync(path.join(dir, name), body);
};

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-bootstrap-list-"));
  dir = path.join(home, "lisa", "bootstrap");
  fs.mkdirpSync(dir);
  env = { XDG_CONFIG_HOME: home };
});

afterEach(() => {
  fs.rmSync(home, { force: true, recursive: true });
});

describe("listBootstrapFiles", () => {
  it("reports a well-formed name that holds a credential", () => {
    put(GOOD, `${TOKEN}\n`);

    expect(listBootstrapFiles(env)).toEqual([GOOD]);
  });

  it("omits a file with no content", () => {
    put(GOOD, TOKEN);
    put("BWS_ACCESS_TOKEN_empty", "");
    put("BWS_ACCESS_TOKEN_blank", "   \n");

    expect(listBootstrapFiles(env)).toEqual([GOOD]);
  });

  it("omits a name outside the key grammar", () => {
    put(GOOD, TOKEN);
    put("not a key", TOKEN);

    expect(listBootstrapFiles(env)).toEqual([GOOD]);
  });

  it("omits OS metadata that the key grammar happens to permit", () => {
    // `.DS_Store` passes KEY_GRAMMAR — dots and underscores are legal in a key
    // — and macOS writes it into any directory it browses. Without an explicit
    // dotfile filter the operator is offered a credential named `.DS_Store`.
    put(GOOD, TOKEN);
    put(".DS_Store", "binary junk");

    expect(listBootstrapFiles(env)).toEqual([GOOD]);
  });

  it("omits a name that would corrupt the suggested config snippet", () => {
    // The rendered remedy is `{ "bootstrap": { "key": "<name>" } }`. A name
    // holding a quote or a brace produces JSON the operator cannot paste, and
    // one holding a newline forges an extra line of the message.
    put(GOOD, TOKEN);
    for (const hostile of ['has"quote', "has}brace", "has\nnewline"]) {
      try {
        put(hostile, TOKEN);
      } catch {
        // A filesystem that refuses the name outright is also a pass; the
        // property is that it never reaches the message.
      }
    }

    expect(listBootstrapFiles(env)).toEqual([GOOD]);
  });

  it("returns empty when the directory does not exist, rather than throwing", () => {
    // It runs on a path that is already failing. A diagnostic that throws
    // replaces the real message with its own.
    expect(
      listBootstrapFiles({ XDG_CONFIG_HOME: path.join(home, "nope") })
    ).toEqual([]);
  });

  // No sort-order case here, deliberately. `listBootstrapFiles` does sort, but
  // `readdirSync` already returns sorted entries on this filesystem, so a test
  // asserting the sorted result passes with the `.sort()` deleted — it cannot
  // fail, and a case that cannot fail is a green that means nothing. Ordering
  // is asserted in bootstrap-missing-diagnosis instead, where the inputs are
  // injected and can be handed over out of order.
});
