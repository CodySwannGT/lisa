/**
 * Where admission's switch, thresholds and wait bounds come from
 * (CodySwannGT/lisa#4596): environment over `.lisa.config.local.json` over
 * code defaults, and the switch only from `.lisa.config.json`.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  admissionSwitchOn,
  DEFAULT_MAX_WAIT_MS,
  DEFAULT_PUSH_MAX_WAIT_MS,
  parseDuration,
  resolveAdmissionSettings,
} from "../../../src/core/admission-settings.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/**
 * A project root holding the given config files.
 * @param files - File name to JSON value
 * @returns Root path
 */
const project = (files: Record<string, unknown> = {}): string => {
  const root = mkdtempSync(join(tmpdir(), "lisa-test-"));
  roots.push(root);
  for (const [name, value] of Object.entries(files)) {
    writeFileSync(join(root, name), JSON.stringify(value), "utf8");
  }
  return root;
};

describe("parseDuration", () => {
  it("reads bare seconds and unit suffixes", () => {
    expect(parseDuration("300", "x")).toBe(300_000);
    expect(parseDuration("90s", "x")).toBe(90_000);
    expect(parseDuration("5m", "x")).toBe(300_000);
    expect(parseDuration("1h", "x")).toBe(3_600_000);
    expect(parseDuration("250ms", "x")).toBe(250);
  });

  it("refuses anything else", () => {
    expect(() => parseDuration("soon", "LISA_ADMISSION_MAX_WAIT")).toThrow(
      /LISA_ADMISSION_MAX_WAIT is "soon"/u
    );
  });
});

describe("admissionSwitchOn", () => {
  it("is off without the key, and off without a config", () => {
    expect(admissionSwitchOn(project())).toBe(false);
    expect(admissionSwitchOn(project({ ".lisa.config.json": {} }))).toBe(false);
    expect(
      admissionSwitchOn(
        project({ ".lisa.config.json": { pushGate: { buildOnce: true } } })
      )
    ).toBe(false);
  });

  it("is on only for an explicit true", () => {
    expect(
      admissionSwitchOn(
        project({ ".lisa.config.json": { pushGate: { admission: true } } })
      )
    ).toBe(true);
  });

  it("refuses a malformed value", () => {
    expect(() =>
      admissionSwitchOn(
        project({ ".lisa.config.json": { pushGate: { admission: 1 } } })
      )
    ).toThrow(/pushGate\.admission/u);
  });
});

describe("resolveAdmissionSettings", () => {
  it("defaults to 30 minutes standalone and 5 minutes inside a push", () => {
    const cwd = project();
    expect(resolveAdmissionSettings({ environment: {}, cwd }).maxWaitMs).toBe(
      DEFAULT_MAX_WAIT_MS
    );
    const push = resolveAdmissionSettings({
      environment: { LISA_ADMISSION_CONTEXT: "push" },
      cwd,
    });
    expect(push.push).toBe(true);
    expect(push.maxWaitMs).toBe(DEFAULT_PUSH_MAX_WAIT_MS);
  });

  it("lets --max-wait, then LISA_ADMISSION_MAX_WAIT, then the push variable win", () => {
    const cwd = project({
      ".lisa.config.local.json": {
        admission: { maxWaitSeconds: 60, pushMaxWaitSeconds: 30 },
      },
    });
    const push = { LISA_ADMISSION_CONTEXT: "push" };
    expect(resolveAdmissionSettings({ environment: push, cwd }).maxWaitMs).toBe(
      30_000
    );
    expect(
      resolveAdmissionSettings({
        environment: { ...push, LISA_ADMISSION_PUSH_MAX_WAIT: "2m" },
        cwd,
      }).maxWaitMs
    ).toBe(120_000);
    expect(
      resolveAdmissionSettings({
        environment: {
          ...push,
          LISA_ADMISSION_PUSH_MAX_WAIT: "2m",
          LISA_ADMISSION_MAX_WAIT: "10m",
        },
        cwd,
      }).maxWaitMs
    ).toBe(600_000);
    expect(
      resolveAdmissionSettings({
        environment: { LISA_ADMISSION_MAX_WAIT: "10m" },
        cwd,
        maxWaitOverride: "7s",
      }).maxWaitMs
    ).toBe(7_000);
    expect(resolveAdmissionSettings({ environment: {}, cwd }).maxWaitMs).toBe(
      60_000
    );
  });

  it("reads thresholds from the environment over the local config", () => {
    const cwd = project({
      ".lisa.config.local.json": {
        admission: { maxLoadPerCore: 0.8, minFreeMemoryMb: 1024 },
      },
    });
    expect(
      resolveAdmissionSettings({ environment: {}, cwd }).thresholds
    ).toMatchObject({
      maxLoadPerCore: 0.8,
      minFreeMemoryMb: 1024,
    });
    expect(
      resolveAdmissionSettings({
        environment: { LISA_ADMISSION_MAX_LOAD_PER_CORE: "0.01" },
        cwd,
      }).thresholds.maxLoadPerCore
    ).toBe(0.01);
  });

  it("refuses a malformed local block rather than defaulting it", () => {
    const cwd = project({
      ".lisa.config.local.json": { admission: { maxLoadPerCore: "high" } },
    });
    expect(() => resolveAdmissionSettings({ environment: {}, cwd })).toThrow(
      /admission\.maxLoadPerCore/u
    );
  });

  it("is skipped by LISA_ADMISSION=off and on CI, and forced on by LISA_ADMISSION=on", () => {
    const cwd = project();
    expect(
      resolveAdmissionSettings({ environment: { LISA_ADMISSION: "off" }, cwd })
        .skipped
    ).toMatch(/admission is off/u);
    expect(
      resolveAdmissionSettings({ environment: { CI: "true" }, cwd }).skipped
    ).toMatch(/CI/u);
    expect(
      resolveAdmissionSettings({
        environment: { CI: "true", LISA_ADMISSION: "on" },
        cwd,
      }).skipped
    ).toBeNull();
  });

  it("keeps machine-wide state under XDG_CACHE_HOME", () => {
    expect(
      resolveAdmissionSettings({
        environment: { XDG_CACHE_HOME: "/cache-root" },
        cwd: project(),
      }).stateDir
    ).toBe(join("/cache-root", "lisa", "admission"));
  });
});
