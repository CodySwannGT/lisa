/** Real controller control; only this test's own outside sentinels are changed. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  describeControllerFailure,
  readOptionalJson,
} from "./controller-failure.mjs";

const CAPTURE_LIMIT = 256 * 1024;
const SCENARIO = "owned-post-run-symlink";

/**
 * Keep a bounded tail of a child stream for failure diagnostics.
 * @param {import("node:stream").Readable} stream - Child output stream.
 * @returns {{text: string}} Live holder of the captured tail.
 */
function captureTail(stream) {
  const holder = { text: "" };
  stream.setEncoding("utf8");
  stream.on("data", chunk => {
    holder.text = (holder.text + chunk).slice(-CAPTURE_LIMIT);
  });
  return holder;
}

/**
 * Stage only new sentinels owned by this test, never real operator settings.
 * @param {string} output - New owned directory.
 * @returns {object} Literal fixture paths and expected bytes.
 */
function createSentinels(output) {
  const link = path.join(output, "owned-config.json");
  const other = path.join(output, "owned-other.json");
  const targetName = "owned-link-target.json";
  const target = path.join(output, targetName);
  const initial = JSON.stringify({ host: {}, lisa: { _lisaManaged: true } });
  const changed = JSON.stringify({
    host: {},
    lisa: { _lisaManaged: true },
    changed: true,
  });
  const directory = path.join(output, "controller-evidence");
  mkdirSync(output, { mode: 0o700 });
  writeFileSync(link, initial, { mode: 0o600 });
  writeFileSync(other, initial, { mode: 0o600 });
  writeFileSync(target, "synthetic private target", { mode: 0o600 });
  return { link, other, targetName, changed, directory };
}

/**
 * Observe the genuine controller rejecting two deliberate, owned outside changes.
 * @param {{controller:string, archive:string, image:string, output:string}} input - Qualified native inputs and a new owned directory.
 * @returns {Promise<object>} Reaching CLI/data observation, never a simulated apply.
 */
export async function qualifySymlinkChange(input) {
  const { link, other, targetName, changed, directory } = createSentinels(
    input.output
  );
  const child = spawn(
    process.execPath,
    [
      input.controller,
      "--backend",
      "docker",
      "--archive",
      input.archive,
      "--image",
      input.image,
      "--harness",
      "codex",
      "--output",
      directory,
      "--preserve",
      link,
      "--preserve",
      other,
    ],
    { timeout: 25 * 60_000, stdio: ["ignore", "pipe", "pipe"] }
  );
  const state = { finished: false, containerId: null, spawnError: null };
  const closed = new Promise(resolve => {
    child.once("error", error => {
      state.spawnError = error;
      resolve({ status: null, signal: null, error });
    });
    child.once("close", (status, signal) => resolve({ status, signal }));
  });
  const stdout = captureTail(child.stdout);
  const stderr = captureTail(child.stderr);
  try {
    // A completed preflight proves both that before-images are finished and
    // that any cleanup target below belongs to this exact controller run.
    const deadline = Date.now() + 30_000;
    const preflightFile = path.join(directory, "preflight.json");
    while (!state.containerId) {
      if (state.spawnError) throw state.spawnError;
      if (existsSync(preflightFile)) {
        try {
          const preflight = JSON.parse(readFileSync(preflightFile, "utf8"));
          assert.match(preflight.container_id, /^[a-f0-9]{64}$/u);
          state.containerId = preflight.container_id;
          break;
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
        }
      }
      assert.equal(
        child.exitCode,
        null,
        "Controller stopped before its preflight"
      );
      assert.ok(
        Date.now() < deadline,
        "Controller did not produce its bounded preflight"
      );
      await delay(25);
    }
    const before = JSON.parse(
      readFileSync(path.join(directory, "before.json"), "utf8")
    );
    assert.equal(before[link].present, true);
    assert.equal(before[other].present, true);
    rmSync(link);
    symlinkSync(targetName, link);
    writeFileSync(other, changed);
    const result = await closed;
    state.finished = true;
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    // Exit 1 is this control's expected outcome (owned outside changes), so it
    // cannot reveal a container failure; the native proof's verdict does.
    const nativePassed =
      readOptionalJson(path.join(directory, "native-proof.json"))?.passed ===
      true;
    if (result.status !== 1 || !nativePassed)
      console.error(
        describeControllerFailure({
          name: SCENARIO,
          directory,
          status: result.status,
          stdout: stdout.text,
          stderr: stderr.text,
        })
      );
    assert.equal(result.status, 1);
    const report = JSON.parse(
      readFileSync(path.join(directory, "preservation.json"), "utf8")
    );
    const native = JSON.parse(
      readFileSync(path.join(directory, "native-proof.json"), "utf8")
    );
    assert.equal(native.apply.status, 0);
    assert.equal(native.apply_receipt.apply_mode, "full");
    assert.equal(native.guard_cases.length, 14);
    assert.equal(native.retired_safety_net.present, false);
    assert.equal(report.preserved, false);
    assert.deepEqual(report.changed, [link, other]);
    assert.equal(report.after[link].kind, "symlink");
    assert.equal(report.container_removed, true);
    assert.equal(report.recovery.length, 2);
    const recovered = report.recovery.map(row =>
      readFileSync(row.copy, "utf8")
    );
    assert.ok(recovered.includes(targetName));
    assert.ok(recovered.includes(changed));
    assert.ok(lstatSync(link).isSymbolicLink());
    for (const file of Object.keys(report.before).filter(
      file => file !== link && file !== other
    )) {
      assert.deepEqual(report.after[file], report.before[file]);
    }
    return {
      name: SCENARIO,
      passed: true,
      controller_status: result.status,
      apply_status: native.apply.status,
      full_apply: "full",
      guard_cases: 14,
      outside_files: Object.keys(report.before).length,
      preserved: false,
      expected_owned_changes: 2,
      operator_files_preserved: true,
      native_agent_activation: "not established",
    };
  } finally {
    if (!state.finished) {
      child.kill("SIGTERM");
      const early = await closed.catch(() => ({ status: null }));
      // A controller that stopped before (or during) preflight never reaches
      // the diagnostic above; print what it said once it has closed.
      console.error(
        describeControllerFailure({
          name: SCENARIO,
          directory,
          status: early.status,
          stdout: stdout.text,
          stderr: stderr.text,
        })
      );
      if (state.containerId)
        execFileSync(
          // eslint-disable-next-line sonarjs/no-os-command-from-path -- fixed user-installed Docker executable, qualified by the controller
          "docker",
          ["rm", "--force", "--volumes", state.containerId],
          {
            timeout: 30_000,
            stdio: "ignore",
          }
        );
    }
  }
}
