/**
 * A patch header is only a claim: the audit runs the named regression test
 * against the installed copy and against the package with the patch
 * reversed, and checks that every hashed path is a file the patch changes
 * inside the package and that the patch is for the advisory's package and
 * range. Each way a self-attested patch can fall short fails the audit.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  EMPTY_TEST,
  FAILING_TEST,
  GHSA,
  PATCH_FILE,
  PATCHED,
  PRISTINE,
  README_DIFF,
  TEST_FILE,
  auditFixture as audit,
  fixture,
  removeFixtures,
  sha256,
} from "../../helpers/audit-patch-fixture.js";

afterEach(removeFixtures);

describe("advisory patch proof in the audit gate", () => {
  it("fails a regression test that passes on the unpatched package too", async () => {
    const result = await audit(fixture({ regressionTest: EMPTY_TEST }));
    expect(result.passed).toBe(false);
    expect(result.text).toContain(
      `regression test ${TEST_FILE} also passes against the unpatched package, so it does not detect the advisory`
    );
  });

  it("fails a regression test that fails on the installed copy", async () => {
    const result = await audit(fixture({ regressionTest: FAILING_TEST }));
    expect(result.passed).toBe(false);
    expect(result.text).toContain(
      `regression test ${TEST_FILE} fails against the installed copies`
    );
  });

  it("fails a patch that changes only the README", async () => {
    const result = await audit(
      fixture({
        installed: PRISTINE,
        diff: README_DIFF,
        header: [
          `Lisa-Advisory: ${GHSA}`,
          `Lisa-Regression-Test: ${TEST_FILE}`,
          `Lisa-Patched-File: README.md sha256:${sha256("# glob, patched\n")}`,
        ],
      })
    );
    expect(result.passed).toBe(false);
    expect(result.text).toContain(
      `regression test ${TEST_FILE} fails against the installed copies`
    );
  });

  it("fails a hash of a file the patch does not change", async () => {
    const result = await audit(fixture({ diff: README_DIFF }));
    expect(result.passed).toBe(false);
    expect(result.text).toContain(
      'Lisa-Patched-File "lib/index.js" is not a file the patch changes'
    );
  });

  it("fails a hashed path that escapes the package directory", async () => {
    const result = await audit(
      fixture({
        header: [
          `Lisa-Advisory: ${GHSA}`,
          `Lisa-Regression-Test: ${TEST_FILE}`,
          `Lisa-Patched-File: ../../../package.json sha256:${sha256(PATCHED)}`,
        ],
      })
    );
    expect(result.passed).toBe(false);
    expect(result.text).toContain(
      'Lisa-Patched-File "../../../package.json" is not a relative path inside the package directory'
    );
  });

  it("fails a regression test path that escapes the project", async () => {
    const result = await audit(
      fixture({
        header: [
          `Lisa-Advisory: ${GHSA}`,
          "Lisa-Regression-Test: ../outside.mjs",
          `Lisa-Patched-File: lib/index.js sha256:${sha256(PATCHED)}`,
        ],
      })
    );
    expect(result.passed).toBe(false);
    expect(result.text).toContain(
      'Lisa-Regression-Test "../outside.mjs" is not a relative path inside the package directory'
    );
  });

  it("fails a patch that names the advisory for a different package", async () => {
    const result = await audit(fixture({ spec: "minimatch@1.0.0" }));
    expect(result.passed).toBe(false);
    expect(result.text).toContain(
      `${PATCH_FILE} names ${GHSA}, an advisory for glob, but patches minimatch`
    );
  });

  it("fails a patch for a version outside the advisory's range", async () => {
    const result = await audit(fixture(), "<1.0.0");
    expect(result.passed).toBe(false);
    expect(result.text).toContain(
      `${PATCH_FILE} names ${GHSA} for glob@1.0.0, which is outside the advisory's vulnerable range <1.0.0`
    );
  });

  it("fails when no locked or installed copy is in the vulnerable range", async () => {
    const result = await audit(fixture(), "<1.0.0");
    expect(result.passed).toBe(false);
    expect(result.text).toContain(
      `no locked or installed glob is in the vulnerable range <1.0.0`
    );
  });
});
