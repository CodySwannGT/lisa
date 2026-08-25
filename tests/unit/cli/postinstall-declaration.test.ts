/**
 * The two spellings of the postinstall declaration, and the notice that stops
 * the change of meaning being silent (CodySwannGT/lisa#3066).
 *
 * Two spellings exist because the two writers have different constraints:
 *
 * - The hook text in a consumer's `package.json` can only reach a child
 *   process as an ENVIRONMENT PREFIX, and prefixing an assignment leaves the
 *   command tail byte-identical — which is what lets the recogniser in
 *   `ensure-lisa-postinstall` keep matching every already-installed hook.
 * - The trampoline's detached child has its environment SANITISED of
 *   package-manager variables before it is spawned, so it declares itself with
 *   a FLAG. A declaration that can be stripped is one that can be lost
 *   silently, which is the whole failure class this ticket is about.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 * @module tests/unit/cli/postinstall-declaration
 */
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { resolvePostinstallDeclaration } from "../../../src/core/apply-mode.js";
import { getRetiredSkipGitCheckNotice } from "../../../src/cli/apply.js";
import { addSharedOptions } from "../../../src/cli/shared-options.js";

describe("resolvePostinstallDeclaration", () => {
  it("accepts the flag spelling", () => {
    expect(resolvePostinstallDeclaration(true, {})).toBe(true);
  });

  it("accepts the environment spelling", () => {
    expect(
      resolvePostinstallDeclaration(undefined, { LISA_POSTINSTALL: "1" })
    ).toBe(true);
  });

  it("declares nothing when neither is present", () => {
    expect(resolvePostinstallDeclaration(undefined, {})).toBe(false);
    expect(resolvePostinstallDeclaration(false, {})).toBe(false);
  });

  it("ignores an environment value that is not the declaration", () => {
    // A stray `LISA_POSTINSTALL=0` or an empty assignment left in a shell
    // profile must not silently reduce an operator's apply.
    expect(
      resolvePostinstallDeclaration(undefined, { LISA_POSTINSTALL: "" })
    ).toBe(false);
    expect(
      resolvePostinstallDeclaration(undefined, { LISA_POSTINSTALL: "0" })
    ).toBe(false);
    expect(
      resolvePostinstallDeclaration(undefined, { LISA_POSTINSTALL: "true" })
    ).toBe(false);
  });
});

describe("--postinstall-safe is registered on the apply surface", () => {
  it("parses into the option every entry point reads", () => {
    const command = addSharedOptions(new Command()).exitOverride();
    command.parse(["--skip-git-check", "--postinstall-safe"], { from: "user" });

    expect(command.opts()["postinstallSafe"]).toBe(true);
    expect(command.opts()["skipGitCheck"]).toBe(true);
  });

  it("leaves the declaration absent when it is not passed", () => {
    const command = addSharedOptions(new Command()).exitOverride();
    command.parse(["--skip-git-check"], { from: "user" });

    expect(command.opts()["postinstallSafe"]).toBeUndefined();
  });
});

describe("getRetiredSkipGitCheckNotice", () => {
  it("warns the caller whose apply just changed shape", () => {
    // The only caller class whose behaviour this ticket changes: a hand-written
    // or copied command that waives the git check and nothing else. It used to
    // get the reduced subset; it now gets the full apply, and a change of
    // meaning delivered silently would be the defect restated rather than
    // fixed.
    const notice = getRetiredSkipGitCheckNotice({
      skipGitCheck: true,
      postinstall: false,
      fullApply: false,
    });

    expect(notice).toBeDefined();
    expect(notice).toContain("--postinstall-safe");
    expect(notice).toContain("LISA_POSTINSTALL=1");
  });

  it("stays silent for a hook that declares its own context", () => {
    // Every Lisa-written postinstall invocation. Nothing changed for it, so
    // there is nothing to say — and saying it on every install in the fleet is
    // how a warning gets trained away.
    expect(
      getRetiredSkipGitCheckNotice({
        skipGitCheck: true,
        postinstall: true,
        fullApply: false,
      })
    ).toBeUndefined();
  });

  it("stays silent for a caller that asked for the full apply explicitly", () => {
    expect(
      getRetiredSkipGitCheckNotice({
        skipGitCheck: true,
        postinstall: false,
        fullApply: true,
      })
    ).toBeUndefined();
  });

  it("stays silent for an apply that never waived the git check", () => {
    expect(
      getRetiredSkipGitCheckNotice({
        skipGitCheck: false,
        postinstall: false,
        fullApply: false,
      })
    ).toBeUndefined();
  });
});
