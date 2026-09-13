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
  it.each([
    { npm_lifecycle_event: "postinstall" },
    { LISA_POSTINSTALL: "1" },
    { npm_config_user_agent: "bun/1.3.11 npm/? node/v24.3.0" },
  ])("skips install writes even with the old bootstrap opt-in: %j", markers => {
    expect(
      getBootstrapApplySkipNotice({
        validateOnly: false,
        environment: {
          env: { ...markers, LISA_BOOTSTRAP: "1" },
          stdinIsTTY: true,
        },
      })
    ).toContain("lisa apply");
  });

  it("skips an explicitly declared install unless full apply is requested", () => {
    const options = {
      validateOnly: false,
      postinstall: true,
      environment: interactive,
    };
    expect(getBootstrapApplySkipNotice(options)).toContain("lisa apply");
    expect(
      getBootstrapApplySkipNotice({ ...options, fullApply: true })
    ).toBeUndefined();
  });

  it("allows a deliberate full apply from an install hook", () => {
    expect(
      getBootstrapApplySkipNotice({
        validateOnly: false,
        fullApply: true,
        environment: {
          env: { npm_lifecycle_event: "postinstall", LISA_BOOTSTRAP: "1" },
          stdinIsTTY: false,
        },
      })
    ).toBeUndefined();
  });

  it("does not mistake an explicit npm apply script for an install", () => {
    expect(
      getBootstrapApplySkipNotice({
        validateOnly: false,
        environment: {
          env: {
            npm_lifecycle_event: "apply",
            npm_config_user_agent: "bun/1.3.11 npm/? node/v24.3.0",
            LISA_BOOTSTRAP: "1",
          },
          stdinIsTTY: false,
        },
      })
    ).toBeUndefined();
  });

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
