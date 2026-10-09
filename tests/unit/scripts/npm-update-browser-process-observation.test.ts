/** Closed kernel fields cannot publish browser arguments, paths or process identities. */
import { describe, expect, it } from "vitest";
import {
  browserKernelFields,
  startBrowserObservation,
} from "../../fixtures/npm-update-hosted-runtime/browser-process-observation.mjs";

describe("browser process diagnostic redaction", () => {
  it("cancels synchronously even when executable discovery is unavailable", () => {
    const observer = startBrowserObservation(
      "/absent-browser-diagnostic-executable"
    );
    expect(observer).not.toBeInstanceOf(Promise);
    const result = observer.stop();
    expect(result).not.toBeInstanceOf(Promise);
    expect(result).toMatchObject({ diagnosticOnly: true, samples: [] });
    expect(observer.stop()).toEqual(result);
  });

  it("retains sandbox and wait-state facts while discarding private arguments", () => {
    const result = browserKernelFields({
      state: "S",
      status: "Uid:\t1000\t1000\t1000\t1000\nNoNewPrivs:\t1\nSeccomp:\t2\n",
      args: "private/browser\0--type=renderer\0--user-data-dir=private/path\0",
      wait: "futex_wait_queue\n",
    });
    expect(result).toEqual({
      state: "S",
      role: "renderer",
      noNewPrivileges: 1,
      seccomp: 2,
      wait: "futex_wait_queue",
    });
    expect(JSON.stringify(result)).not.toMatch(/private|1000/);
  });

  it("refuses to infer missing sandbox fields or export arbitrary kernel names", () => {
    expect(
      browserKernelFields({
        state: "private",
        status: "Seccomp:\t9\n",
        args: "--type=private\0",
        wait: "private/path",
      })
    ).toEqual({
      state: "unknown",
      role: "other",
      noNewPrivileges: null,
      seccomp: null,
      wait: "other",
    });
  });
});
