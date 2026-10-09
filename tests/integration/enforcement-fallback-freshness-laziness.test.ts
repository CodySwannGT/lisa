/**
 * Fresh command attribution without repeating diagnostic work on permitted
 * calls. Missing optional tooling affects reporting, never guard decisions.
 * @module tests/integration/enforcement-fallback-freshness-laziness
 */
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupScratchRoots,
  scratchRoot,
} from "../helpers/enforcement-fallback-fixtures.js";
import {
  currentHost,
  driveFreshness,
  SOURCE_FALLBACK,
  template,
} from "../helpers/host-guard-freshness-fixtures.js";

afterEach(cleanupScratchRoots);

const FALLBACK = "lisa-enforcement-fallback.sh";
const HELPER = "lisa-enforcement-freshness.mjs";
const MISSING_NODE = "missing-node";

describe("lazy bounded freshness diagnostics", () => {
  it("invokes no freshness helper or network command after the session notice on permitted calls", () => {
    const root = currentHost();
    const tmp = scratchRoot();
    const trace = path.join(tmp, "calls.txt");
    const startup = path.join(tmp, "trace.bash");
    writeFileSync(trace, "");
    writeFileSync(
      startup,
      [
        'node() { case "$1" in *lisa-enforcement-freshness.mjs) printf "comparison-helper\\n" >> "$LISA_FRESHNESS_TRACE" ;; esac; command node "$@"; }',
        'curl() { printf "network-curl\\n" >> "$LISA_FRESHNESS_TRACE"; return 99; }',
        'wget() { printf "network-wget\\n" >> "$LISA_FRESHNESS_TRACE"; return 99; }',
        "export -f node curl wget",
        "",
      ].join("\n")
    );
    const env = { BASH_ENV: startup, LISA_FRESHNESS_TRACE: trace };
    const first = driveFreshness(root, "pwd", {
      tmp,
      session: "lazy-content",
      env,
    });
    expect(first.status).toBe(0);
    expect(readFileSync(trace, "utf8")).toBe("comparison-helper\n");
    writeFileSync(trace, "");
    const next = driveFreshness(root, "pwd", {
      tmp,
      session: "lazy-content",
      env,
    });
    expect(next.status).toBe(0);
    expect(next.output).not.toContain("Lisa enforcement is running");
    expect(readFileSync(trace, "utf8")).toBe("");
  });

  it("re-evaluates changed host bytes on a later refusal in the already-noticed session", () => {
    const root = currentHost();
    const tmp = scratchRoot();
    expect(
      driveFreshness(root, "pwd", { tmp, session: "later-change" }).status
    ).toBe(0);
    const file = path.join(root, "scripts/lisa-hooks/block-no-verify.sh");
    writeFileSync(file, `${readFileSync(file, "utf8")}\n# later host change\n`);
    const result = driveFreshness(root, undefined, {
      tmp,
      session: "later-change",
    });
    expect(result.status).toBe(2);
    expect(result.output).not.toContain("Lisa enforcement is running");
    expect(result.output).toMatch(
      /Refused by .*block-no-verify\.sh \(DIFFERENT from installed template/u
    );
  });

  it.each(["missing-helper", "failed-helper", MISSING_NODE])(
    "retains the original refusal and explicit unknown with %s",
    kind => {
      const root = currentHost();
      const scripts = scratchRoot();
      const subject = path.join(scripts, FALLBACK);
      copyFileSync(SOURCE_FALLBACK, subject);
      const startup = path.join(scripts, "node-absent.bash");
      if (kind === "failed-helper")
        writeFileSync(
          path.join(scripts, HELPER),
          'throw new Error("unavailable diagnostic helper");\n'
        );
      if (kind === MISSING_NODE) {
        copyFileSync(
          path.join(path.dirname(SOURCE_FALLBACK), HELPER),
          path.join(scripts, HELPER)
        );
        writeFileSync(startup, "node() { return 127; }\nexport -f node\n");
      }
      const result = driveFreshness(root, undefined, {
        subject,
        ...(kind === MISSING_NODE ? { env: { BASH_ENV: startup } } : {}),
      });
      expect(result.status).toBe(2);
      expect(result.output).toContain("Blocked: this command bypasses");
      expect(result.output).toMatch(
        /Refused by .*block-no-verify\.sh \(host content unknown/u
      );
      expect(result.output).not.toContain("npx @codyswann/lisa apply");
    }
  );

  it("does not infer current from an oversized host guard even with matching template version", () => {
    const root = currentHost();
    const file = path.join(root, "scripts/lisa-hooks/block-no-verify.sh");
    writeFileSync(
      file,
      `${readFileSync(file, "utf8")}\n#${"x".repeat(1024 * 1024)}\n`
    );
    const result = driveFreshness(root);
    expect(result.status).toBe(2);
    expect(result.output).toMatch(
      /Refused by .*block-no-verify\.sh \(host content unknown/u
    );
    expect(readFileSync(template(root))).not.toEqual(readFileSync(file));
  });
});
