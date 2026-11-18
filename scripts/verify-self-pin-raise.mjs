#!/usr/bin/env node
/**
 * Prove a self-pin raise changes the one line it claims to, and nothing else
 * (CodySwannGT/lisa#4951).
 *
 * The deploy workflow raises Lisa's own `@codyswann/lisa` pin in a job with
 * no secrets: that job runs `bun install`, the build and the checks, all of
 * which execute dependency code, the just-published Lisa included. A SEPARATE
 * job then pushes the result with the ruleset-bypassing deploy key. That job
 * installs nothing and runs no dependency code. This script is the only code it
 * runs before it pushes: it takes main's `package.json` and the candidate the
 * unprivileged job produced, and accepts the candidate only when it is main's
 * text with exactly the self-pin value replaced by `^<published version>`.
 *
 * Deliberately dependency-free (no `semver`, no repository imports), because
 * the privileged job has no `node_modules` and must not need any.
 * @module scripts/verify-self-pin-raise
 */
import { readFileSync } from "node:fs";
import process from "node:process";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/** The package whose pin is raised. */
const SELF_PACKAGE = "@codyswann/lisa";

/** A plain release version: no range operators, no prerelease, no build. */
const RELEASE_VERSION = /^\d+\.\d+\.\d+$/;

/** The line a caller greps for. */
const VERDICT_PREFIX = "verify-self-pin-raise:";

/**
 * Decide whether the candidate manifest is the base with only the pin raised.
 * @param {string} baseText - main's package.json, as text.
 * @param {string} candidateText - The raised package.json, as text.
 * @param {string} version - The version the release published.
 * @returns {{ok: boolean, detail: string}} The verdict.
 */
export function verifySelfPinRaise(baseText, candidateText, version) {
  if (!RELEASE_VERSION.test(version)) {
    return { ok: false, detail: `"${version}" is not a release version` };
  }
  const base = JSON.parse(baseText);
  const spec = base?.devDependencies?.[SELF_PACKAGE];
  if (typeof spec !== "string") {
    return {
      ok: false,
      detail: `main's package.json declares no devDependencies["${SELF_PACKAGE}"]`,
    };
  }
  const expected = JSON.stringify(
    {
      ...base,
      devDependencies: {
        ...base.devDependencies,
        [SELF_PACKAGE]: `^${version}`,
      },
    },
    null,
    2
  );
  if (`${expected}\n` !== candidateText) {
    return {
      ok: false,
      detail: `the candidate is not main's package.json with only "${SELF_PACKAGE}" set to ^${version}`,
    };
  }
  if (spec === `^${version}`) {
    return { ok: false, detail: `main already pins ^${version}` };
  }
  return {
    ok: true,
    detail: `only ${SELF_PACKAGE} changes: ${spec} → ^${version}`,
  };
}

/**
 * Return a required CLI option.
 * @param {string[]} argv - Arguments after the script path.
 * @param {string} name - Option name, `--` included.
 * @returns {string | undefined} The option's value.
 */
function option(argv, name) {
  const index = argv.indexOf(name);
  const value = index === -1 ? undefined : argv[index + 1];
  return value === undefined || value.startsWith("--") ? undefined : value;
}

/**
 * Run the verification for a workflow step.
 * @param {string[]} argv - `--base <file> --candidate <file> --version <v>`.
 * @returns {number} Process exit code: 0 only for a proven one-line raise.
 */
export function main(argv) {
  const base = option(argv, "--base");
  const candidate = option(argv, "--candidate");
  const version = option(argv, "--version");
  if (base === undefined || candidate === undefined || version === undefined) {
    process.stderr.write(
      "❌ usage: verify-self-pin-raise.mjs --base <file> --candidate <file> --version <version>\n"
    );
    return 1;
  }
  const verdict = verifySelfPinRaise(
    readFileSync(base, "utf8"),
    readFileSync(candidate, "utf8"),
    version
  );
  process.stdout.write(
    `${VERDICT_PREFIX} ${verdict.ok ? "ok" : "refused"} — ${verdict.detail}\n`
  );
  return verdict.ok ? 0 : 1;
}

/* c8 ignore start -- CLI wiring, exercised through main() in tests */
if (invokedAsScript(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`❌ ${error.message}\n`);
    process.exitCode = 1;
  }
}
/* c8 ignore stop */
