/** Literal launcher regressions driven through the actual canonical wrapper. */
import { describe, expect, it } from "vitest";
import {
  EXIT_BLOCKED,
  EXIT_ALLOWED,
  FIXTURE_NAME,
  runHook,
} from "../../support/host-name-guard-fixture.js";

describe("it inspects only one literal shell executable-script operand (#4540)", () => {
  it.each(["sh", "bash"])(
    "refuses a protected %s script without executing it",
    launcher => {
      const result = runHook(
        `${launcher} -c 'gh issue create --repo CodySwannGT/lisa --body ${FIXTURE_NAME}'`
      );
      expect(result.status).toBe(EXIT_BLOCKED);
      expect(result.output).toContain(FIXTURE_NAME);
      expect(result.output).not.toContain("NOT active");
    }
  );

  it.each(["sh", "bash"])(
    "preserves a literal explicit host in a %s script",
    launcher => {
      expect(
        runHook(
          `${launcher} -c 'gh issue create --repo acme/${FIXTURE_NAME} --body ${FIXTURE_NAME}'`
        ).status
      ).toBe(EXIT_ALLOWED);
    }
  );

  it.each(["sh", "bash"])(
    "does not interpret later %s argv words as scripts",
    launcher => {
      expect(
        runHook(
          `${launcher} -c 'printf clean' 'gh issue create --repo CodySwannGT/lisa --body ${FIXTURE_NAME}'`
        ).status
      ).toBe(EXIT_ALLOWED);
    }
  );

  it.each(["sh", "bash"])(
    "refuses unread relative files inside an unknown %s directory",
    launcher => {
      const result = runHook(
        `${launcher} -c 'cd "$D"; gh issue create --repo CodySwannGT/lisa --body-file body.md'`
      );
      expect(result.status).toBe(EXIT_BLOCKED);
      expect(result.output).toContain("BLOCKED: the working directory");
    }
  );
});
