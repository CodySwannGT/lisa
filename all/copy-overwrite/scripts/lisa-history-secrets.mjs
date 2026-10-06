#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * @file lisa-history-secrets.mjs
 * @description Shared fail-closed actual-ref/event history scanner, offline after provisioning.
 * @module history-secrets
 */
import { readFileSync } from "node:fs";
const invocation = await import("./lib/invoked-as-script.mjs").catch(
  () => null
);
let bootstrapReady = typeof invocation?.invokedAsScript === "function";

/** Failures expose only authored guidance; untrusted inputs/errors never cross output. */
export const main = async (
  args = process.argv.slice(2),
  cwd = process.cwd(),
  input
) => {
  let AuthoredError;
  try {
    if (!bootstrapReady) throw new Error("Managed bootstrap unavailable");
    const {
      HistorySecretError,
      objectWidth,
      gitRead,
      parsePush,
      eventPairs,
      introducedCommits,
    } = await import("./lib/history-secret-git.mjs");
    AuthoredError = HistorySecretError;
    const { provisionScanner, scanCommits } =
      await import("./lib/history-secret-scanner.mjs");
    if (args[0] === "provision" && args.length === 2) {
      await provisionScanner(args[1]);
      console.log("Provisioned checksum/version-pinned Gitleaks 8.30.1.");
      return 0;
    }
    const scannerIndex = args.indexOf("--scanner");
    const scanner = scannerIndex < 0 ? undefined : args[scannerIndex + 1];
    const mode = args[0];
    const accepted =
      mode === "pre-push"
        ? ["pre-push", ...(scanner ? ["--scanner", scanner] : [])]
        : [
            "ci",
            ...(args[1] === "--event"
              ? ["--event", args[2], "--event-name", args[4]]
              : []),
            ...(scanner ? ["--scanner", scanner] : []),
          ];
    if (
      args.join("\0") !== accepted.join("\0") ||
      !["pre-push", "ci"].includes(mode)
    )
      throw new HistorySecretError(
        "Invalid scanner command. Use pre-push with actual stdin or ci --event <event-json> --event-name <push|pull_request>; optional --scanner <pinned-executable>."
      );
    const width = objectWidth(cwd);
    let pairs;
    if (mode === "pre-push")
      pairs = parsePush(
        input === undefined ? readFileSync(0, "utf8") : input.toString("utf8"),
        width,
        cwd
      );
    else {
      const explicitEvent = args[1] === "--event";
      let event;
      try {
        event = JSON.parse(
          readFileSync(
            explicitEvent ? args[2] : process.env.GITHUB_EVENT_PATH,
            "utf8"
          )
        );
      } catch {
        throw new HistorySecretError(
          "CI event JSON is missing or malformed. Supply the original actual GitHub event file and event name."
        );
      }
      pairs = eventPairs(
        event,
        explicitEvent ? args[4] : process.env.GITHUB_EVENT_NAME,
        width
      );
    }
    const commits = introducedCommits(pairs, cwd, width);
    if (commits.length === 0) {
      console.log("No introduced history. Scanner was not run.");
      return 0;
    }
    const heads = pairs
      .filter(pair => !/^0+$/u.test(pair.after))
      .map(pair =>
        gitRead(["rev-parse", "--verify", `${pair.after}^{commit}`], cwd)
      )
      .filter(head => commits.includes(head));
    const result = scanCommits(commits, cwd, scanner, heads);
    console.log(JSON.stringify(result));
    if (result.findings.length > 0) {
      console.error(
        "Introduced history contains scanner-detected credentials. Remove the synthetic or unintended credential from every introduced commit before publishing; findings are fully redacted."
      );
      return 42;
    }
    return 0;
  } catch (error) {
    console.error(
      AuthoredError && error instanceof AuthoredError
        ? error.message
        : "Required history scanning failed. Run full Lisa apply to repair managed tooling, supply actual Git input and retry; raw bootstrap/vendor errors are withheld."
    );
    return 1;
  }
};
try {
  if (!bootstrapReady) throw new Error("Managed bootstrap unavailable");
  if (invocation.invokedAsScript(import.meta.url))
    process.exitCode = await main();
} catch {
  bootstrapReady = false;
  console.error(
    "Required history scanner bootstrap is unavailable. Run full Lisa apply and retry; raw module errors are withheld."
  );
  process.exitCode = 1;
}
