/** A timed-out tool probe must stay a timeout, not become false presence. */
import { expect, it } from "vitest";

import { probe } from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs";

it("propagates a bounded probe timeout instead of reporting presence", () => {
  const timeout = Object.assign(new Error("command failed"), {
    code: "ETIMEDOUT",
    stdout: "",
    stderr: "",
  });
  expect(() =>
    probe("stuck", () => {
      throw timeout;
    })
  ).toThrow(/command failed/);
});
