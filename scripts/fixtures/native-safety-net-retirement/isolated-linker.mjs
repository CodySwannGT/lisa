/** Genuine Bun isolated dependency update with an old executable host fallback. */
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { ok, repositoryProbe, sha } from "./probes.mjs";

assert.equal(process.platform, "linux");
assert.ok(existsSync("/.dockerenv"));
assert.equal(homedir(), "/root");
const [parentRoot, preview] = process.argv.slice(2);
const root = "/isolated-linker-project";
const pkg = path.join(root, "node_modules/@codyswann/lisa");
const hooks = path.join(root, "scripts/lisa-hooks");
const target = path.join(hooks, "parity-safety-net.sh");
const settings = path.join(root, ".claude/settings.json");
const receipt = path.join(root, ".lisa/apply-receipt.json");
const config = path.join(root, "bunfig.toml");
const proof = { root, commands: [], started_at: new Date().toISOString() };
mkdirSync(root);
writeFileSync(
  path.join(root, "package.json"),
  '{"name":"isolated-retirement-proof","private":true,"trustedDependencies":["@codyswann/lisa","@ast-grep/cli","@sentry/cli","esbuild"]}\n'
);
writeFileSync(config, '[install]\nlinker = "isolated"\n');
ok(proof, "bun", ["add", "/baseline.tgz"]);
proof.baseline_package_realpath = realpathSync(pkg);
assert.ok(proof.baseline_package_realpath.includes("/node_modules/.bun/"));

// Seed supported old state from genuine released handlers and the actual
// baseline-emitted configuration/receipt preserved by the parent journey.
mkdirSync(path.dirname(hooks), { recursive: true });
cpSync(path.join(pkg, "all/copy-overwrite/scripts/lisa-hooks"), hooks, {
  recursive: true,
});
for (const name of [
  "lisa-enforcement-fallback.sh",
  "lisa-enforcement-freshness.mjs",
])
  cpSync(
    path.join(pkg, "all/copy-overwrite/scripts", name),
    path.join(root, "scripts", name)
  );
mkdirSync(path.dirname(settings), { recursive: true });
mkdirSync(path.dirname(receipt), { recursive: true });
cpSync(path.join(parentRoot, ".claude/settings.json"), settings);
cpSync(path.join(parentRoot, ".lisa/apply-receipt.json"), receipt);
const preserved = [
  config,
  settings,
  receipt,
  path.join(hooks, "block-no-verify.sh"),
];
const snapshot = () => preserved.map(file => sha(readFileSync(file)));
const before = snapshot();
proof.target_before_sha256 = sha(readFileSync(target));
proof.before = repositoryProbe(proof, "claude", settings, false);
proof.update = ok(proof, "bun", ["add", "/candidate.tgz"]);
proof.candidate_package_realpath = realpathSync(pkg);
assert.ok(proof.candidate_package_realpath.includes("/node_modules/.bun/"));
proof.candidate_bytes = [];
for (const name of [
  "scripts/retire-native-safety-net.mjs",
  "plugins/lisa/hooks/parity-safety-net.sh",
  "dist/core/native-safety-net-retirement.js",
]) {
  const installed = sha(readFileSync(path.join(pkg, name)));
  const archived = sha(readFileSync(path.join(preview, name)));
  assert.equal(installed, archived, name);
  proof.candidate_bytes.push({ file: name, installed, archived });
}
proof.target_after_sha256 = sha(readFileSync(target));
assert.equal(
  proof.target_after_sha256,
  sha(
    readFileSync(
      path.join(
        preview,
        "all/copy-overwrite/scripts/lisa-hooks",
        path.basename(target)
      )
    )
  )
);
proof.after = repositoryProbe(proof, "claude", settings, true);
assert.deepEqual(snapshot(), before);
proof.preservation = { files: preserved, before, after: snapshot() };
proof.completed_at = new Date().toISOString();
proof.outcome = "PASS: isolated Bun update retires the real host target";
writeFileSync(
  "/evidence/isolated-linker-proof.json",
  `${JSON.stringify(proof, null, 2)}\n`
);
console.log(JSON.stringify(proof));
