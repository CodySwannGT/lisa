/**
 * @file package.mjs
 * @description Actual synthetic history journey boundary witnesses.
 * @module history-secrets-fixtures
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, cpSync } from "node:fs";
import { join } from "node:path";
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
      write(emitted, "Gemfile", "source 'https://rubygems.org'\ngem 'rails'\n");
      write(emitted, "config/application.rb", "require 'rails/all'\n");
      write(
        emitted,
        ".lisa.config.json",
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
        "lefthook.yml",
      ];
      const applyHashes = [];
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
        const bytes = readFileSync(join(emitted, SCANNER_ENTRY));
        requireFact(
          bytes.equals(
            readFileSync(
              join(
                installed,
                "all/copy-overwrite/scripts/lisa-history-secrets.mjs"
              )
            )
          ),
          "Applied scanner differs from immutable archive bytes."
        );
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
      });
    } else {
      cpSync(
        join(upstream, "all/copy-overwrite/scripts"),
        join(emitted, "scripts"),
        { recursive: true }
      );
      cpSync(
        join(upstream, "rails/copy-overwrite/lefthook.yml"),
        join(emitted, "lefthook.yml")
      );
    }
  } catch {
    throw new Error(
      "package.mjs: actual fixture boundary failed; raw vendor metadata is withheld."
    );
  }
};
