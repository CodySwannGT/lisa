import { describe, expect, it } from "vitest";
import {
  BOOTSTRAP_SKIP_NOTICE,
  BUILD_ENV_FINGERPRINTS,
  getBootstrapApplySkipNotice,
} from "../../../src/core/bootstrap-environment.js";

const interactive = {
  env: {},
  stdinIsTTY: true,
};

describe("getBootstrapApplySkipNotice", () => {
  it("refuses to run apply without a TTY unless explicitly opted in", () => {
    expect(
      getBootstrapApplySkipNotice({
        validateOnly: false,
        environment: { env: {}, stdinIsTTY: false },
      })
    ).toBe(BOOTSTRAP_SKIP_NOTICE);
  });

  it.each(BUILD_ENV_FINGERPRINTS)(
    "refuses to run apply when %s is present",
    fingerprint => {
      expect(
        getBootstrapApplySkipNotice({
          validateOnly: false,
          environment: {
            env: { [fingerprint]: "1" },
            stdinIsTTY: true,
          },
        })
      ).toBe(BOOTSTRAP_SKIP_NOTICE);
    }
  );

  it("allows explicit bootstrap opt-in in non-interactive contexts", () => {
    expect(
      getBootstrapApplySkipNotice({
        validateOnly: false,
        environment: {
          env: { LISA_BOOTSTRAP: "1", CI: "true" },
          stdinIsTTY: false,
        },
      })
    ).toBeUndefined();
  });

  it("keeps interactive apply behavior unchanged", () => {
    expect(
      getBootstrapApplySkipNotice({
        validateOnly: false,
        environment: interactive,
      })
    ).toBeUndefined();
  });

  it("keeps validate mode available in build contexts", () => {
    expect(
      getBootstrapApplySkipNotice({
        validateOnly: true,
        environment: {
          env: { CI: "true" },
          stdinIsTTY: false,
        },
      })
    ).toBeUndefined();
  });
});
