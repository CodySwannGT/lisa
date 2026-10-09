/** Synthetic pinned-page and protocol controls never stand for native Ubuntu acceptance. */
import { describe, expect, it } from "vitest";
import {
  driverDiagnostic,
  driverQualification,
} from "../../fixtures/npm-update-hosted-runtime/driver-diagnostic.mjs";
import { DRIVER_PHASES } from "../../fixtures/npm-update-hosted-runtime/driver-probe.mjs";
import { sandboxStatus } from "../../fixtures/npm-update-hosted-runtime/sandbox-status.mjs";

const ADEQUATE = "You are adequately sandboxed.";
const REPORT = {
  diagnosticOnly: false,
  driverLaunchVerified: true,
  driverSessionVerified: true,
  nativeSandboxVerified: true,
  suidSandboxActive: true,
  layer1Sandbox: "SUID",
  sessionDeleted: true,
  driverClosed: true,
  failureStage: null,
  failureSha256: null,
};

function source(value: string) {
  // Chrome 154 sandbox_internals.ts uses textContent in two cells of one native row.
  return `<tr><td class="medium">Layer 1 Sandbox</td><td class="medium">${value}</td></tr>`;
}

function bytes(
  report: object = REPORT,
  phases: readonly string[] = DRIVER_PHASES
) {
  return Buffer.from(
    [
      ...phases.map(phase => JSON.stringify({ phase })),
      JSON.stringify({ result: report }),
    ].join("\n")
  );
}

describe("current native sandbox status", () => {
  it("reads the pinned vendor's current SUID representation", () => {
    expect(sandboxStatus(ADEQUATE + source("SUID"))).toEqual({
      nativeSandboxVerified: true,
      layer1Sandbox: "SUID",
      suidSandboxActive: true,
    });
  });

  it.each(["Namespace", "None"])(
    "retains %s without claiming an active SUID sandbox",
    value => {
      expect(sandboxStatus(ADEQUATE + source(value))).toEqual({
        nativeSandboxVerified: true,
        layer1Sandbox: value,
        suidSandboxActive: false,
      });
    }
  );

  it.each([
    "<td>SUID Sandbox</td><td>Yes</td>",
    source("Unknown"),
    source("SUID") + source("Namespace"),
    source("SUID") + source("Unknown"),
    "",
  ])("does not accept stale, missing, unknown or ambiguous rows", html => {
    expect(sandboxStatus(ADEQUATE + html)).toMatchObject({
      layer1Sandbox: "unreported",
      suidSandboxActive: false,
    });
  });

  it("does not turn an inactive or contradictory overall sandbox into success", () => {
    expect(sandboxStatus(source("SUID"))).toMatchObject({
      nativeSandboxVerified: false,
    });
    expect(
      sandboxStatus(
        `${ADEQUATE}You are NOT adequately sandboxed.${source("SUID")}`
      )
    ).toMatchObject({ nativeSandboxVerified: false });
  });
});

describe("separate driver qualification", () => {
  it("requires the native qualification purpose and complete ordered witnesses", () => {
    expect(driverQualification(bytes())).toMatchObject({
      diagnosticOnly: false,
      reportReceived: true,
      report: REPORT,
    });
  });

  it("never promotes a successful diagnostic into qualification", () => {
    expect(() =>
      driverQualification(bytes({ ...REPORT, diagnosticOnly: true }))
    ).toThrow();
    expect(() => driverDiagnostic(bytes())).toThrow();
  });

  it.each([
    { driverLaunchVerified: false },
    { driverSessionVerified: false },
    { nativeSandboxVerified: false },
    { suidSandboxActive: false, layer1Sandbox: "Namespace" },
    { sessionDeleted: false },
    { driverClosed: false },
    { failureStage: "source", failureSha256: "f".repeat(64) },
    { layer1Sandbox: "Namespace" },
    { layer1Sandbox: ["SUID"] },
  ])("refuses incomplete, contradictory or coerced witnesses", change => {
    expect(() =>
      driverQualification(bytes({ ...REPORT, ...change }))
    ).toThrow();
  });

  it.each([
    { phases: [] },
    { phases: DRIVER_PHASES.slice(0, -1) },
    { phases: [...DRIVER_PHASES].reverse() },
    { phases: [...DRIVER_PHASES, "source"] },
  ])("refuses missing, reordered or repeated native phases", ({ phases }) => {
    expect(() => driverQualification(bytes(REPORT, phases))).toThrow();
  });

  it("refuses a missing final report and retained native refusal", () => {
    expect(() => driverQualification(Buffer.alloc(0))).toThrow();
    const refusal = JSON.stringify({
      refusalStage: "source",
      messageSha256: "f".repeat(64),
    });
    expect(() =>
      driverQualification(Buffer.concat([Buffer.from(`${refusal}\n`), bytes()]))
    ).toThrow();
  });
});
