import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runStandardsProofCli } from "../../src/cli/standards-proof-cmd.js";
import { standardsProofFinding } from "../../src/standards/readiness.js";
import { readStandardsProof } from "../../src/standards/storage.js";
import {
  RAILS_CHECKS_WITH_MUTATION,
  commitAll,
  createRailsExecutables,
  createRailsRepository,
  proofResidue,
  snapshotProof,
} from "./standards-proof-fixture.js";

let root: string | undefined;
let toolsRoot: string | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(
    [root, toolsRoot]
      .filter((value): value is string => value !== undefined)
      .map(async value => await rm(value, { recursive: true, force: true }))
  );
  root = undefined;
  toolsRoot = undefined;
});

describe("real Rails standards-proof journey", () => {
  it("executes the exact managed Rails inventory and fails closed when tooling disappears", async () => {
    root = await createRailsRepository();
    const tools = await createRailsExecutables();
    toolsRoot = tools.directory;
    vi.stubEnv(
      "PATH",
      `${tools.directory}${path.delimiter}${process.env.PATH ?? ""}`
    );
    vi.stubEnv("LISA_STANDARDS_COMMAND_LOG", tools.log);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runStandardsProofCli(root);
    const stored = await readStandardsProof(root);
    expect(stored.status).toBe("available");
    if (stored.status !== "available") throw new Error("proof unavailable");
    expect(stored.proof.projectTypes).toEqual(["rails"]);
    expect(stored.proof.applicableChecks).toEqual(RAILS_CHECKS_WITH_MUTATION);
    expect(stored.proof.results.map(result => result.check)).toEqual(
      RAILS_CHECKS_WITH_MUTATION
    );
    expect(await standardsProofFinding(root)).toMatchObject({ status: "pass" });

    const log = await readFile(tools.log, "utf8");
    expect(log).toContain("bundle exec rubocop");
    expect(log).toContain("bundle exec rspec");
    expect(log).toContain("bundle exec reek app/ lib/");
    expect(log).toContain("bundle exec flog --all --group app/ lib/");
    expect(log).toContain("bundle exec flay app/ lib/");
    expect(log).toContain("bundle exec brakeman --no-pager --quiet");
    expect(log).toContain("bundle exec bundler-audit check --update");
    expect(log).toContain("sg scan");

    const prior = await snapshotProof(root);
    await rm(path.join(root, "scripts/check-threshold-ratchet.mjs"));
    commitAll(root, "remove required threshold command");
    expect(await standardsProofFinding(root)).toMatchObject({
      status: "warn",
      reason: expect.stringContaining("HEAD changed"),
    });
    await expect(runStandardsProofCli(root)).rejects.toThrow(
      "Required threshold command is missing"
    );
    expect(await snapshotProof(root)).toEqual(prior);
    expect(await proofResidue(root)).toEqual([]);
  }, 30_000);
});
