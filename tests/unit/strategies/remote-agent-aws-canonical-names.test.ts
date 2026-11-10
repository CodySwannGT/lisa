/**
 * Both Lisa AWS writers emit one canonical set of names per tenant.
 *
 * `remote-agent-aws-setup.sh` and lisa-secrets-access both write the shared
 * `~/.aws` files. Prefixing `<namespace>-agent-` onto a bundle key that already
 * began with `agent-` produced `acme-agent-agent-production`, and the two
 * writers spelled the same tenant's source profile differently. These cases
 * pin the one scheme — `<ns>-agent-<stage>` assuming from
 * `<ns>-agent-bootstrap` — across both writers (CodySwannGT/lisa#4768).
 * @module tests/unit/strategies/remote-agent-aws-canonical-names
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { installAwsProfiles } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/materialize-secrets.mjs";
import {
  removeTemporaryDirectories,
  runBootstrap,
  workstation,
} from "./support/remote-agent-aws-harness.js";

const ACME = "acme";
const ACME_DEV_SECTION = "profile acme-agent-dev";
const AGENT_KEYS = ["agent-dev", "agent-production"] as const;
const CONFIG = path.join(".aws", "config");
const CREDENTIALS = path.join(".aws", "credentials");

/** Scratch homes for the lisa-secrets-access writer. */
const homes: string[] = [];

afterEach(() => {
  removeTemporaryDirectories();
  while (homes.length > 0) {
    rmSync(homes.pop() as string, { recursive: true, force: true });
  }
});

/**
 * A bundle with the given profile keys.
 * @param keys - Profile keys, e.g. `agent-dev` or `dev`
 * @returns The bundle object
 */
function bundle(keys: readonly string[]): Record<string, unknown> {
  return {
    accessKeyId: "AKIATEST",
    secretAccessKey: "test-secret",
    externalId: "external-id",
    profiles: JSON.stringify(
      Object.fromEntries(
        keys.map(key => [
          key,
          {
            roleArn: "arn:aws:iam::111111111111:role/RemoteAgent",
            region: "us-east-1",
          },
        ])
      )
    ),
  };
}

/**
 * Section headers in one `~/.aws` file.
 * @param home - Home directory
 * @param file - Relative path
 * @returns Section names, sorted
 */
function sections(home: string, file: string): string[] {
  return [
    ...readFileSync(path.join(home, file), "utf8").matchAll(
      /^\[([^\]\n]+)\]/gm
    ),
  ]
    .map(found => (found[1] ?? "").trim())
    .filter(name => name !== "default")
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Run the remote-agent writer for acme against a fresh workstation.
 * @param keys - Bundle keys
 * @param seed - Optional pre-existing config contents
 * @returns The workstation home and the process result
 */
function remote(
  keys: readonly string[],
  seed?: string
): { home: string; result: ReturnType<typeof runBootstrap> } {
  const ws = workstation();
  if (seed !== undefined) {
    mkdirSync(path.join(ws.home, ".aws"), { recursive: true });
    writeFileSync(path.join(ws.home, CONFIG), seed);
  }
  const result = runBootstrap({
    workstation: ws,
    environment: {
      LISA_AWS_BOOTSTRAP_JSON: JSON.stringify(bundle(keys)),
      LISA_AWS_PROFILE_NAMESPACE: ACME,
    },
  });
  return { home: ws.home, result };
}

/**
 * Run the lisa-secrets-access writer for acme against a fresh home.
 * @param keys - Bundle keys
 * @returns The home directory
 */
function secretsWriter(keys: readonly string[]): string {
  const home = mkdtempSync(path.join(tmpdir(), "lisa-canonical-names-"));
  homes.push(home);
  installAwsProfiles(bundle(keys), { home, owner: ACME });
  return home;
}

describe("the remote-agent writer", () => {
  it.each([[AGENT_KEYS], [["dev", "production"]]])(
    "maps keys %j to <ns>-agent-<stage> exactly once",
    keys => {
      const { home, result } = remote(keys);

      expect(result.status).toBe(0);
      expect(sections(home, CONFIG)).toEqual([
        ACME_DEV_SECTION,
        "profile acme-agent-production",
      ]);
      expect(readFileSync(path.join(home, CONFIG), "utf8")).not.toContain(
        "-agent-agent-"
      );
      expect(result.stdout).toContain("default=acme-agent-dev");
    }
  );

  it("refuses keys that name one stage twice", () => {
    const { result } = remote(["dev", "agent-dev"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must name distinct stages");
  });

  it("removes its own doubled names and keeps other tenants' sections", () => {
    const seed = [
      "[profile acme-agent-agent-dev]",
      "role_arn = arn:aws:iam::111111111111:role/RemoteAgent",
      "source_profile = acme-agent-bootstrap",
      "",
      "[profile globex-agent-agent-staging]",
      "role_arn = arn:aws:iam::222222222222:role/RemoteAgent",
      "source_profile = globex-agent-bootstrap",
      "",
      "[profile acme-agent-agent-mine]",
      "sso_session = mine",
      "",
      "# >>> managed by lisa-secrets-access v3 owner=acme >>>",
      "[profile acme-agent-agent-kept]",
      "role_arn = arn:aws:iam::111111111111:role/RemoteAgent",
      "source_profile = acme-agent-bootstrap",
      "# <<< managed by lisa-secrets-access v3 owner=acme <<<",
      "",
    ].join("\n");

    const { home, result } = remote(AGENT_KEYS, seed);

    expect(result.status).toBe(0);
    const config = sections(home, CONFIG);
    expect(config).not.toContain("profile acme-agent-agent-dev");
    expect(config).toContain(ACME_DEV_SECTION);
    // Another tenant's doubled name is theirs to fix; an operator section that
    // does not assume from acme's bootstrap profile is not Lisa's at all.
    expect(config).toContain("profile globex-agent-agent-staging");
    expect(config).toContain("profile acme-agent-agent-mine");
    // Inside a lisa-secrets-access managed block: that writer's to regenerate.
    expect(config).toContain("profile acme-agent-agent-kept");
    expect(result.stderr).toContain(
      "removed doubled profile names left by an earlier bootstrap: acme-agent-agent-dev"
    );
  });
});

describe("both writers", () => {
  it.each([
    [["agent-dev", "agent-staging", "agent-production"]],
    [["dev", "staging", "production"]],
  ])("emit the same profile and source names for keys %j", keys => {
    const { home: remoteHome, result } = remote(keys);
    const secretsHome = secretsWriter(keys);

    expect(result.status).toBe(0);
    expect(sections(secretsHome, CONFIG)).toEqual(sections(remoteHome, CONFIG));
    expect(sections(secretsHome, CREDENTIALS)).toEqual(
      sections(remoteHome, CREDENTIALS)
    );
    expect(sections(secretsHome, CREDENTIALS)).toEqual([
      "acme-agent-bootstrap",
    ]);
  });
});
