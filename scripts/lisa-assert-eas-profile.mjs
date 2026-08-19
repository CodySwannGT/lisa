#!/usr/bin/env node
/**
 * Refuse an EAS build profile that cannot produce a testable E2E binary.
 *
 * Two profile mistakes waste a full native build and then fail the suite in a
 * way that reads as a product bug rather than a configuration one:
 *
 * 1. `developmentClient: true` builds a **dev client**, which is a shell that
 *    loads JavaScript from a Metro server at runtime. CI has no Metro server,
 *    so the app opens its "development servers" launcher instead of the
 *    product. Every flow then fails on a screen that appears nowhere in the
 *    app, and the failure looks like a broken selector.
 * 2. A profile with no `channel` takes the default one, so the binary can
 *    receive an over-the-air update published for unrelated work while the
 *    suite is running. The build under test stops being the build that was
 *    made, and the run is no longer reproducible.
 *
 * Both are cheap to detect and expensive to discover late, so this runs before
 * the build rather than after it.
 *
 * ## Why this does not use `JSON.parse`, and does not read one profile
 *
 * `eas.json` is not required to be strict JSON — trailing commas are common
 * and EAS accepts them. A real consumer file (`acmeorgb/frontend-v2`)
 * has one on line 16, so a strict parse would crash this guard on the very
 * repository the standard was extracted from.
 *
 * And a profile's effective settings are inherited: `dev-e2e` extends
 * `dev-base` extends `base`, and `developmentClient` may be set on any of
 * them. Reading only the named profile would pass a profile that inherits
 * `developmentClient: true` from a parent.
 * @module scripts/lisa-assert-eas-profile
 */

import { existsSync, readFileSync } from "node:fs";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/** Channel values that mean "no dedicated channel was chosen". */
const DEFAULT_CHANNELS = new Set(["default"]);

/** How deep an `extends` chain may go before it is treated as a cycle. */
const MAX_DEPTH = 20;

/**
 * Parse `eas.json` the way EAS does rather than the way `JSON.parse` does.
 *
 * Strips `//` and block comments, then trailing commas. Deliberately tolerant:
 * the guard's job is to judge the profile, and refusing to read a file EAS
 * itself accepts would fail builds over punctuation.
 * @param {string} text Raw file contents.
 * @returns {Record<string, any>} The parsed document.
 */
export function parseEasJson(text) {
  const withoutComments = text
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const withoutTrailingCommas = withoutComments.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(withoutTrailingCommas);
}

/**
 * Flatten a build profile through its `extends` chain.
 *
 * Ancestors are applied first so the named profile wins, which is EAS's own
 * precedence. `env` is merged key-by-key for the same reason.
 * @param {Record<string, any>} profiles The `build` block.
 * @param {string} name Profile to resolve.
 * @returns {Record<string, any>} The effective profile.
 */
export function resolveProfile(profiles, name) {
  const chain = [];
  const seen = new Set();
  let current = name;

  while (current) {
    if (seen.has(current)) {
      throw new Error(
        `The build profile "${name}" extends itself through "${current}", so its settings cannot be worked out. Break the loop in eas.json.`
      );
    }
    if (chain.length >= MAX_DEPTH) {
      throw new Error(
        `The build profile "${name}" extends more than ${MAX_DEPTH} profiles deep, which almost certainly means a loop in eas.json.`
      );
    }
    const profile = profiles?.[current];
    if (!profile) {
      const known = Object.keys(profiles ?? {});
      throw new Error(
        `eas.json has no build profile called "${current}"${
          current === name ? "" : ` (reached by extending from "${name}")`
        }. It defines: ${known.length ? known.join(", ") : "none"}.`
      );
    }
    seen.add(current);
    chain.unshift(profile);
    current = profile.extends;
  }

  const effective = {};
  for (const link of chain) {
    Object.assign(effective, link, {
      env: { ...effective.env, ...link.env },
    });
  }
  delete effective.extends;
  return effective;
}

/**
 * Judge a resolved profile, returning every problem rather than the first.
 * @param {Record<string, any>} profile Effective profile.
 * @param {string} name Its name, for the messages.
 * @returns {string[]} Operator-readable problems; empty means usable.
 */
export function problemsWith(profile, name) {
  const problems = [];

  if (profile.developmentClient === true) {
    problems.push(
      `"${name}" builds a development client (developmentClient: true). A development client loads the app's JavaScript from a Metro server at runtime, and there is no Metro server in CI, so the app opens its "development servers" screen instead of the product and every flow fails on a screen that is not part of the app. Set developmentClient: false on the profile used for end-to-end runs.`
    );
  }

  const channel = profile.channel;
  if (!channel) {
    problems.push(
      `"${name}" sets no channel, so the build takes the default one and can receive an over-the-air update published for unrelated work while the suite is running — meaning the build being tested is no longer the build that was made. Give the profile its own channel, conventionally "e2e".`
    );
  } else if (DEFAULT_CHANNELS.has(channel)) {
    problems.push(
      `"${name}" uses the "${channel}" channel, which is shared with everything else that does not choose one, so an unrelated over-the-air update can replace the build mid-suite. Give the profile its own channel, conventionally "e2e".`
    );
  }

  return problems;
}

/**
 * CLI entry point.
 * @param {string[]} argv Arguments after the script path.
 * @returns {number} Process exit code.
 */
export function main(argv) {
  const flag = name => {
    const hit = argv.find(arg => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const file = flag("file") ?? "eas.json";
  const name = flag("profile");

  if (!name) {
    console.error(
      "usage: lisa-assert-eas-profile.mjs --profile=<name> [--file=eas.json]"
    );
    return 1;
  }

  if (!existsSync(file)) {
    // Not every project builds with EAS. One that does not has no profile to
    // judge, and inventing a failure here would block suites that never had
    // this class of problem.
    console.log(
      `No ${file} in this project, so there is no EAS build profile to check.`
    );
    return 0;
  }

  let document;
  try {
    document = parseEasJson(readFileSync(file, "utf8"));
  } catch (error) {
    console.error(
      `::error title=Unreadable eas.json::${file} could not be read: ${error.message}`
    );
    return 1;
  }

  let profile;
  try {
    profile = resolveProfile(document.build, name);
  } catch (error) {
    console.error(`::error title=EAS profile not usable::${error.message}`);
    return 1;
  }

  const problems = problemsWith(profile, name);
  for (const problem of problems) {
    console.error(`::error title=EAS profile not usable for E2E::${problem}`);
  }
  if (problems.length) {
    console.error(
      `\nThe "${name}" profile would build an app the suite cannot drive, so the build was stopped before it started rather than after ninety minutes.`
    );
    return 1;
  }

  console.log(
    `EAS profile "${name}" is usable for end-to-end runs: developmentClient=${profile.developmentClient === true}, channel=${profile.channel}.`
  );
  return 0;
}

// Realpath both sides rather than comparing URL strings: agents in this repo
// run from git worktrees and /tmp on macOS, both symlinked, where a raw
// comparison silently answers "no" and the CLI body never runs.
if (invokedAsScript(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
