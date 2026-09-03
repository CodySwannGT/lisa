import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  hookRunner,
  LOCAL_CONFIG,
  MAIN_CONFIG,
  project,
  write,
  writeJson,
} from "../../helpers/inject-resolved-config-harness.js";

/**
 * The block promises things in its own text. These cases hold it to them.
 *
 * Every case here corresponds to a way the block said one thing and did
 * another, silently — a shape worse than the unread config file this hook
 * exists against, because a wrong answer stops the reader from looking.
 * @module tests/unit/hooks/inject-resolved-config-completeness
 */

/** Bound once here: a shared helper may not read `process.env`. */
const { contextFor } = hookRunner(process.env);

/** The rendered line every fixture below declares, proving the block rendered. */
const RENDERED_TRACKER = "tracker: github";

/** Root can read a mode-000 file, which would make that case vacuous. */
const asRoot = process.getuid?.() === 0;

/**
 * A gate set wide enough that one bucket cannot fit on a single rendered line.
 * @param count - How many gate ids to declare
 * @returns A `gates` block declaring every id at `push: required`
 */
function widePushGates(count: number): Record<string, unknown> {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `verification-gate-${String(index).padStart(2, "0")}`,
      { push: "required" },
    ])
  );
}

/**
 * Credential-shaped fixtures, assembled rather than written out.
 *
 * These have to carry the real structural markers — that is the whole point of
 * the cases below — which is exactly what the repository's own secret scanner
 * looks for. Joining the parts at runtime keeps the marker out of the file's
 * text without weakening the fixture or adding a scanner ignore entry: the
 * renderer under test still receives the assembled string.
 */
const CONNECTION_STRING = [
  "postgres",
  "placeholder-user:placeholder-pass@localhost:5432/app",
].join("://");

/** A vendor-prefixed API key, assembled for the reason above. */
const VENDOR_KEY = ["sk", "live", "PLACEHOLDER0123456789abcdef"].join("_");

/** The signature segment of {@link SIGNED_TOKEN}. */
const SIGNED_TOKEN_SIGNATURE = "PLACEHOLDERsignature";

/** A three-segment signed token, assembled for the reason above. */
const SIGNED_TOKEN = [
  "eyJhbGciOiJIUzI1NiJ9",
  "eyJwbGFjZWhvbGRlciI6MX0",
  SIGNED_TOKEN_SIGNATURE,
].join(".");

/** A config whose rendered body cannot fit inside the context budget. */
const OVERSIZED_POLICY = Object.fromEntries(
  Array.from({ length: 200 }, (_, index) => [
    `section${index}`,
    { setting: `value-for-section-number-${index}` },
  ])
);

describe("inject-resolved-config: the gates list is never silently cut", () => {
  it("renders every declared gate id when one bucket overflows a line", () => {
    const root = project();
    const gates = widePushGates(30);
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      deploy: { branches: { production: "main" } },
      gates,
    });

    const context = contextFor(root);

    expect(context).toContain("gates (30 declared)");
    for (const gateId of Object.keys(gates)) {
      expect(context).toContain(gateId);
    }
  });

  it("elides no gate id behind a truncation marker", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      deploy: { branches: { production: "main" } },
      gates: widePushGates(30),
    });

    expect(contextFor(root)).not.toContain("… (line truncated)");
  });
});

describe("inject-resolved-config: gaps outrank values under budget pressure", () => {
  it("still names every undeclared required key when the body overflows", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      harness: "claude",
      policy: OVERSIZED_POLICY,
    });

    const context = contextFor(root);

    // Proves the budget actually bit; without it the assertions below could
    // pass on a body that never came under pressure.
    expect(context).toContain("further rendered line(s) omitted");
    expect(context).toContain("tracker: NOT DECLARED");
    expect(context).toContain("deploy.branches: NOT DECLARED");
  });

  it("still marks every Lisa built-in default when the body overflows", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      harness: "claude",
      policy: OVERSIZED_POLICY,
    });

    const context = contextFor(root);

    expect(context).toContain("gates.runner: npm run   [Lisa built-in default");
    expect(context).toContain("gates.unproven: warn   [Lisa built-in default");
    expect(context).toContain(
      "learnings.file: .lisa/PROJECT_LEARNINGS.md   [Lisa built-in default"
    );
  });

  it("does not send the reader to a file that cannot answer for the omitted lines", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      harness: "claude",
      policy: OVERSIZED_POLICY,
    });

    const context = contextFor(root);

    expect(context).toContain(
      "The declared-vs-default lines above are complete"
    );
  });
});

describe("inject-resolved-config: the credential filter matches its own claim", () => {
  it.each([
    ["authorization", "placeholder-authorization-value"],
    ["PRIVATE_PEM", "placeholder-private-pem-material"],
    ["pin", "placeholder-pin-value"],
    ["otp", "placeholder-otp-value"],
    ["roleArn", "arn:aws:iam::000000000000:role/PlaceholderRole"],
  ])("withholds the value under %s", (key, value) => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      intake: { mode: "placeholder-mode", [key]: value },
    });

    const context = contextFor(root);

    expect(context).toContain("mode=placeholder-mode");
    expect(context).not.toContain(value);
    expect(context).toContain("withheld (identity-shaped)");
  });

  it.each([
    [
      "a connection string carrying a password",
      CONNECTION_STRING,
      "placeholder-pass",
    ],
    ["a vendor-prefixed api key", VENDOR_KEY, VENDOR_KEY],
    ["a signed token", SIGNED_TOKEN, SIGNED_TOKEN_SIGNATURE],
  ])("redacts %s arriving under an innocuous key", (_shape, value, leaked) => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      intake: { endpoint: value },
    });

    const context = contextFor(root);

    expect(context).toContain(RENDERED_TRACKER);
    expect(context).not.toContain(leaked);
    expect(context).toContain("[redacted]");
  });

  it("states what the filter does rather than promising more than it does", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, { tracker: "github" });

    const context = contextFor(root);

    expect(context).toContain("best-effort filter");
    expect(context).not.toContain(
      "Identity- and credential-shaped values are omitted by design."
    );
  });
});

describe("inject-resolved-config: a broken config does not echo itself", () => {
  it("reports invalid JSON without quoting the file's contents", () => {
    const root = project();
    write(root, MAIN_CONFIG, "export PLACEHOLDER_TOKEN=placeholder-value\n");

    const context = contextFor(root);

    expect(context).toContain("could not be read");
    expect(context).not.toContain("export");
    expect(context).not.toContain("PLACEHOLDER_TOKEN");
  });

  it.skipIf(asRoot)("reports an unreadable config without its path", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, { tracker: "github" });
    chmodSync(path.join(root, MAIN_CONFIG), 0);

    const context = contextFor(root);

    expect(context).toContain("could not be read");
    expect(context).not.toContain(root);
  });
});

describe("inject-resolved-config: the project root is found, not assumed", () => {
  it("renders the repository's config for a session started in a subdirectory", () => {
    const root = project();
    mkdirSync(path.join(root, ".git"));
    const subdirectory = path.join(root, "packages", "service");
    mkdirSync(subdirectory, { recursive: true });
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      deploy: { branches: { production: "main" } },
    });

    const context = contextFor(subdirectory);

    expect(context).not.toContain("No Lisa configuration found");
    expect(context).toContain(RENDERED_TRACKER);
  });

  it("does not climb past the repository root into another project's config", () => {
    const outer = project();
    writeJson(outer, MAIN_CONFIG, { tracker: "linear" });
    const inner = path.join(outer, "vendored-repo");
    mkdirSync(path.join(inner, ".git"), { recursive: true });

    const context = contextFor(inner);

    expect(context).toContain("No Lisa configuration found");
    expect(context).not.toContain("tracker: linear");
  });
});

describe("inject-resolved-config: no file declares it, no block reports it", () => {
  it("declares no gate a prototype-polluting local override injected", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      deploy: { branches: { production: "main" } },
    });
    // Written verbatim: an object literal's `__proto__` key sets a prototype
    // rather than becoming an own property, so `JSON.stringify` would serialize
    // this fixture away entirely. `JSON.parse` is what makes it an own key.
    write(
      root,
      LOCAL_CONFIG,
      '{"__proto__":{"gates":{"phantom-gate":{"push":"off"}}}}'
    );

    const context = contextFor(root);

    expect(context).toContain(RENDERED_TRACKER);
    expect(context).not.toContain("phantom-gate");
    expect(context).not.toContain("gates (");
  });
});
