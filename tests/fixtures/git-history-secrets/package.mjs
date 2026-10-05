/**
 * @file package.mjs
 * @description Actual synthetic history journey boundary witnesses.
 * @module history-secrets-fixtures
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, cpSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
const CONFIG = ".lisa.config.json";
const HOOK = "lefthook.yml";
const CI = ".github/workflows/ci.yml";
/**
 * Resolve the installed archive's caller through the same authority as full apply.
 * Release stamps are bound to the version tag by the publish identity gate.
 * @param installed - Actual immutable archive installation directory
 * @param command - Bounded actual subprocess authority
 * @param requireFact - Failing assertion authority for this fixture
 * @returns Exact release ref, or explicitly qualified unstamped candidate ref
 */
export const resolvePackageCaller = (installed, command, requireFact) => {
  const result = command(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
const installed = process.argv[1];
const authority = await import(pathToFileURL(installed + "/dist/core/lisa-release-pin.js"));
const readers = await import(pathToFileURL(installed + "/dist/cli/version.js"));
const deps = {
  readVersion: readers.getPackageVersion,
  readStampedCommit: readers.getPackageReleaseCommit,
  readStampedTag: readers.getPackageReleaseTag,
  resolveTagCommit: authority.resolveTagCommitFromGit,
};
try {
  const pin = await authority.resolveReleasePin(installed, deps);
  console.log(JSON.stringify({ ref: pin.sha, version: pin.version, qualification: "release-pin" }));
} catch (error) {
  const declared = JSON.parse(readFileSync(installed + "/package.json", "utf8"));
  if (!(error instanceof authority.UnresolvableReleasePinError) ||
      error.reason !== "unreleased" || deps.readStampedCommit() !== null ||
      deps.readStampedTag() !== null || Object.hasOwn(declared, "lisaReleaseCommit") ||
      Object.hasOwn(declared, "lisaReleaseTag")) throw error;
  console.log(JSON.stringify({ ref: "main", version: deps.readVersion(), qualification: "unstamped-candidate" }));
}`,
      installed,
    ],
    installed
  );
  requireFact(
    result.status === 0,
    "Installed package release identity cannot be resolved."
  );
  return JSON.parse(String(result.stdout));
};
/**
 * Inspect actual applied caller and hook routes, never invented local workflow copies.
 * @param emitted - Real applied consumer directory
 * @param requireFact - Failing assertion authority for this fixture
 * @param expectedCaller - Exact identity resolved from the installed archive
 * @returns Observed concrete caller identity
 */
export const verifyAppliedRoutes = (emitted, requireFact, expectedCaller) => {
  const config = JSON.parse(readFileSync(join(emitted, CONFIG), "utf8"));
  const ci = load(readFileSync(join(emitted, CI), "utf8"));
  const callers = Object.entries(ci.jobs ?? {}).filter(([, job]) =>
    /(?:^|\/)quality-rails\.yml@/u.test(job.uses ?? "")
  );
  if (callers.length !== 1)
    requireFact(
      false,
      "Applied CI must have exactly one Rails quality caller."
    );
  const [id, job] = callers[0];
  const callerChain = [job.name ?? id, "History Secrets"];
  const declaration = config.gates["introduced-history-credential-leakage"];
  const hook = load(readFileSync(join(emitted, HOOK), "utf8"));
  const route = hook["pre-push"]?.commands?.["work-item"];
  requireFact(
    job.uses ===
      `CodySwannGT/lisa/.github/workflows/quality-rails.yml@${expectedCaller.ref}` &&
      job.with?.expected_workflow_contract_major === "1" &&
      declaration.push === "required" &&
      declaration["pull-request"].level === "required" &&
      JSON.stringify(declaration["pull-request"].caller_chain) ===
        JSON.stringify(callerChain),
    "Applied CI caller, contract major and required declaration disagree."
  );
  requireFact(
    route?.use_stdin === true &&
      route.run.includes('await import("./scripts/lisa-rails-prepush.mjs")') &&
      route.run.includes("await main(process.argv.slice(1))"),
    "Applied Rails hook is not bound to the managed stdin scanner facade."
  );
  return {
    id,
    name: job.name ?? id,
    uses: job.uses,
    expectedWorkflowContractMajor: job.with.expected_workflow_contract_major,
    callerChain,
  };
};
export const emitArtifacts = harness => {
  const {
    SCANNER_ENTRY,
    archive,
    upstream,
    scratch,
    observations,
    command,
    requireFact,
    git,
    write,
    emitted,
  } = harness;
  try {
    mkdirSync(emitted, { mode: 0o700 });
    if (archive) {
      const installation = join(scratch, "installation");
      mkdirSync(installation, { mode: 0o700 });
      write(
        installation,
        "package.json",
        JSON.stringify({
          name: "anonymous-history-package-proof",
          private: true,
        })
      );
      const install = command(
        "bun",
        [
          "add",
          "--ignore-scripts",
          "--no-save",
          "--cache-dir",
          join(scratch, "bun-cache"),
          archive,
        ],
        installation
      );
      requireFact(
        install.status === 0,
        "Immutable package dependency installation failed."
      );
      const installed = join(installation, "node_modules/@codyswann/lisa");
      const expectedCaller = resolvePackageCaller(
        installed,
        command,
        requireFact
      );
      write(emitted, "Gemfile", "source 'https://rubygems.org'\ngem 'rails'\n");
      write(emitted, "config/application.rb", "require 'rails/all'\n");
      write(
        emitted,
        CONFIG,
        JSON.stringify({
          gates: {
            runner: "just",
            "credential-leakage": { "pull-request": "optional" },
          },
        })
      );
      git(emitted, "init", "-q");
      git(emitted, "config", "user.name", "Fixture");
      git(emitted, "config", "user.email", "fixture@example.invalid");
      git(emitted, "add", ".");
      git(emitted, "commit", "-qm", "fixture bootstrap");
      const artifacts = [
        SCANNER_ENTRY,
        "scripts/lisa-rails-prepush.mjs",
        "scripts/lisa-gates.mjs",
        "scripts/lib/history-secret-git.mjs",
        "scripts/lib/history-secret-policy.mjs",
        "scripts/lib/history-secret-scanner.mjs",
        HOOK,
        CI,
      ];
      const applyHashes = [];
      const applyRoutes = [];
      for (const _attempt of [0, 1]) {
        const apply = command(
          "env",
          [
            "LISA_BOOTSTRAP=1",
            process.execPath,
            join(installed, "dist/index.js"),
            "apply",
            emitted,
            "--yes",
            "--full-apply",
            "--no-update-check",
            "--harness=cursor",
          ],
          emitted
        );
        requireFact(
          apply.status === 0,
          "Actual immutable package apply/reapply failed."
        );
        const config = JSON.parse(
          readFileSync(join(emitted, ".lisa.config.json"), "utf8")
        );
        requireFact(
          config.gates.runner === "just" &&
            config.gates["credential-leakage"]["pull-request"] === "optional" &&
            config.gates["introduced-history-credential-leakage"].push ===
              "required",
          "Package policy preservation failed."
        );
        const declaration =
          config.gates["introduced-history-credential-leakage"];
        requireFact(
          declaration["pull-request"].level === "required" &&
            declaration["pull-request"].caller_chain.at(-1) ===
              "History Secrets",
          "Actual caller chain is not declared as required."
        );
        applyRoutes.push(
          verifyAppliedRoutes(emitted, requireFact, expectedCaller)
        );
        for (const file of artifacts.filter(file => file !== CI)) {
          const owner =
            file === HOOK ? "rails/copy-overwrite" : "all/copy-overwrite";
          requireFact(
            readFileSync(join(emitted, file)).equals(
              readFileSync(join(installed, owner, file))
            ),
            "Applied history helper or hook differs from immutable archive bytes."
          );
        }
        const hashes = artifacts.map(file =>
          createHash("sha256")
            .update(readFileSync(join(emitted, file)))
            .digest("hex")
        );
        if (applyHashes.length)
          requireFact(
            JSON.stringify(hashes) === JSON.stringify(applyHashes[0]),
            "Owned emitted artifacts drifted on actual reapply."
          );
        applyHashes.push(hashes);
        if (_attempt === 0) {
          git(emitted, "add", ".");
          git(emitted, "commit", "-qm", "fixture package adoption");
        }
      }
      observations.push({
        name: "immutable-package-apply-reapply",
        sha256: createHash("sha256")
          .update(readFileSync(archive))
          .digest("hex"),
        version: JSON.parse(
          readFileSync(join(installed, "package.json"), "utf8")
        ).version,
        artifactHashes: Object.fromEntries(
          artifacts.map((file, index) => [file, applyHashes[0][index]])
        ),
        ciCallers: applyRoutes,
        callerIdentity: expectedCaller,
        hostedWorkflowScope:
          "The emitted caller exactly matches the installed release pin, or is explicitly qualified as an unstamped candidate; hosted workflow bytes are verified separately against actual released gitHead.",
      });
    } else {
      cpSync(
        join(upstream, "all/copy-overwrite/scripts"),
        join(emitted, "scripts"),
        { recursive: true }
      );
      cpSync(
        join(upstream, "rails/copy-overwrite/lefthook.yml"),
        join(emitted, HOOK)
      );
    }
  } catch {
    throw new Error(
      "package.mjs: actual fixture boundary failed; raw vendor metadata is withheld."
    );
  }
};
