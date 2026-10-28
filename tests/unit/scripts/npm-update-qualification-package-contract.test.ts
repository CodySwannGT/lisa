/** Reject unexpected privileged operations before granting fixture-only downgrade consent. */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeQualificationPackages } from "../../fixtures/npm-update-hosted-runtime/packages.mjs";

const mutation = vi.hoisted(() => ({ kind: "" }));
vi.mock(
  "../../../all/copy-overwrite/scripts/lib/npm-update-rails-tools.mjs",
  async importOriginal => {
    const actual =
      await importOriginal<
        typeof import("../../../all/copy-overwrite/scripts/lib/npm-update-rails-tools.mjs")
      >();
    return {
      ...actual,
      installRailsPackages: (
        step: (command: string, args: string[]) => Promise<unknown>,
        browser: boolean
      ) =>
        actual.installRailsPackages((command: string, args: string[]) => {
          if (mutation.kind === "command") return step("/foreign/sudo", args);
          if (mutation.kind === "snapshot")
            return step(
              command,
              args.map(value =>
                value.startsWith("--snapshot=")
                  ? "--snapshot=20261014T000000Z"
                  : value
              )
            );
          if (mutation.kind === "extra-option")
            return step(command, [...args, "--allow-unauthenticated"]);
          if (mutation.kind === "roster" && args.includes("install"))
            return step(
              command,
              args.filter(value => !value.startsWith("libglib2.0-0t64="))
            );
          return step(command, args);
        }, browser),
    };
  }
);

describe("qualification normalization privilege boundary", () => {
  it("binds fixture normalization to clean native qualification before unchanged component verification", () => {
    const qualifier = readFileSync(
      new URL(
        "../../fixtures/npm-update-hosted-runtime/qualify.mjs",
        import.meta.url
      ),
      "utf8"
    );
    expect(qualifier).toContain(
      '"tests/fixtures/npm-update-hosted-runtime/packages.mjs"'
    );
    const nativeIdentity = qualifier.indexOf(
      "summary.actualUbuntuAmd64 = true"
    );
    const cleanSource = qualifier.indexOf('"--exit-code"');
    const sourceDigests = qualifier.indexOf("summary.sourceSha256 =");
    const normalize = qualifier.indexOf(
      "await normalizeQualificationPackages("
    );
    const components = qualifier.indexOf("await qualifyComponents(");
    expect(nativeIdentity).toBeGreaterThan(0);
    expect(cleanSource).toBeGreaterThan(nativeIdentity);
    expect(sourceDigests).toBeGreaterThan(cleanSource);
    expect(normalize).toBeGreaterThan(sourceDigests);
    expect(components).toBeGreaterThan(normalize);
    // This is a source wiring control, not a substitute for native Ubuntu qualification.
    const verifier = readFileSync(
      new URL(
        "../../fixtures/npm-update-hosted-runtime/components.mjs",
        import.meta.url
      ),
      "utf8"
    );
    expect(verifier).toContain("await prepareRailsTools(");
    expect(verifier).not.toContain("normalizeQualificationPackages");
    expect(verifier).not.toContain("--allow-downgrades");
  });

  it.each(["command", "snapshot", "extra-option", "roster"])(
    "refuses unexpected %s before that operation executes",
    async kind => {
      mutation.kind = kind;
      const calls: string[][] = [];
      try {
        await expect(
          normalizeQualificationPackages(
            async (_command: string, args: string[]) => {
              calls.push(args);
              return {
                code: 0,
                stdout: Buffer.alloc(0),
                stderr: Buffer.alloc(0),
              };
            }
          )
        ).rejects.toThrow("qualification package operation differs");
        expect(calls).toHaveLength(kind === "roster" ? 1 : 0);
        expect(calls.flat()).not.toContain("--allow-downgrades");
      } finally {
        mutation.kind = "";
      }
    }
  );
});
