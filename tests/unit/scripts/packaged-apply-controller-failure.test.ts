/** The packaged-apply job log must name the container's real failure (#4822). */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  describeControllerFailure,
  formatControllerFailure,
  tail,
} from "../../fixtures/packaged-apply/controller-failure.mjs";

const DOCKER_ONLY = "Command failed: docker start --attach abc\nSaved lockfile";
const NATIVE_CAUSE = "Expected values to be strictly equal:\n\ntrue !== false";
const SCENARIO = "scoped-codex";
const NATIVE_STACK =
  "AssertionError: x\n    at file:///lisa-driver.mjs:208:10\n    at main";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true })));
});

describe("tail", () => {
  it("keeps only the last lines and drops trailing newlines", () => {
    expect(tail("a\nb\nc\nd\n", 2)).toBe("c\nd");
  });

  it("renders missing output as empty", () => {
    expect(tail(null, 5)).toBe("");
    expect(tail("", 5)).toBe("");
  });
});

describe("formatControllerFailure", () => {
  it("puts the native assertion and its location ahead of the docker wrapper", () => {
    const message = formatControllerFailure({
      name: SCENARIO,
      status: 1,
      stderr: DOCKER_ONLY,
      native: {
        apply: { status: 0, stdout: "", stderr: "" },
        failure: { message: NATIVE_CAUSE, stack: NATIVE_STACK },
      },
      failureRecord: { message: DOCKER_ONLY },
    });

    expect(message).toContain('scenario "scoped-codex": controller exited 1');
    expect(message).toContain(`Native proof failure: ${NATIVE_CAUSE}`);
    expect(message).toContain("lisa-driver.mjs:208:10");
    expect(message.indexOf("true !== false")).toBeLessThan(
      message.indexOf("Controller stderr")
    );
    expect(message).not.toContain("Native lisa apply exited");
  });

  it("shows a failed native apply's own output", () => {
    const message = formatControllerFailure({
      name: "fleet-success",
      status: 1,
      native: { apply: { status: 2, stdout: "", stderr: "EISDIR: agy" } },
    });

    expect(message).toContain("Native lisa apply exited 2.");
    expect(message).toContain("EISDIR: agy");
  });

  it("says so when the container recorded nothing", () => {
    const message = formatControllerFailure({
      name: SCENARIO,
      status: 1,
      stderr: "docker: image not found",
    });

    expect(message).toContain("docker: image not found");
    expect(message).toContain("No native-proof.json or failure.json");
  });

  it("bounds each stream to the requested tail", () => {
    const stderr = Array.from({ length: 100 }, (_, i) => `line-${i}`).join(
      "\n"
    );
    const message = formatControllerFailure({
      name: SCENARIO,
      status: 1,
      stderr,
      lines: 3,
    });

    expect(message).toContain("line-99");
    expect(message).toContain("line-97");
    expect(message).not.toContain("line-96");
  });
});

describe("describeControllerFailure", () => {
  it("reads the proof files the controller left in the scenario directory", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "lisa-apply-diag-"));
    roots.push(directory);
    await writeFile(
      path.join(directory, "native-proof.json"),
      JSON.stringify({ failure: { message: NATIVE_CAUSE } })
    );
    await writeFile(path.join(directory, "failure.json"), "{not json");

    const message = describeControllerFailure({
      name: SCENARIO,
      directory,
      status: 1,
      stderr: DOCKER_ONLY,
    });

    expect(message).toContain(`Native proof failure: ${NATIVE_CAUSE}`);
    expect(message).not.toContain("Controller failure.json");
  });
});
