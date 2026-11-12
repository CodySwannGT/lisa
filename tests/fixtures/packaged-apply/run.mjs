/** Native CLI/filesystem regression; requires genuine Docker and runtime image. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { qualifySymlinkChange } from "./symlink-control.mjs";

const { values } = parseArgs({
  options: {
    archive: { type: "string" },
    image: { type: "string" },
    output: { type: "string" },
    controller: {
      type: "string",
      default: path.resolve(
        import.meta.dirname,
        "../../../scripts/verify-packaged-apply.mjs"
      ),
    },
  },
});
for (const key of ["archive", "image", "output"])
  assert.ok(values[key], `Missing --${key}`);
const output = path.resolve(values.output);
// The actual controller and every child must work with private agent defaults.
// A permissive caller umask otherwise hides unreadable copied-container inputs.
process.umask(0o077);
mkdirSync(output, { mode: 0o700 });
const sentinel = path.join(output, "outside.json");
const absent = path.join(output, "outside-absent.json");
const sentinelBytes = Buffer.from(
  JSON.stringify({
    mcpServers: {
      operator: { command: "human-sentinel" },
      lisa: { command: "managed-sentinel", _lisaManaged: true },
    },
  })
);
writeFileSync(sentinel, sentinelBytes, { mode: 0o600 });
const summary = {
  scenarios: [],
  archive_sha256: createHash("sha256")
    .update(readFileSync(values.archive))
    .digest("hex"),
  controller: Object.fromEntries(
    [
      ["controller", values.controller],
      [
        "isolation",
        path.join(
          path.dirname(values.controller),
          "lib/packaged-apply-isolation.mjs"
        ),
      ],
      [
        "driver",
        path.join(
          path.dirname(values.controller),
          "lib/packaged-apply-driver.mjs"
        ),
      ],
      [
        "guard_cases",
        path.join(
          path.dirname(values.controller),
          "fixtures/packaged-apply/guard-cases.json"
        ),
      ],
    ].map(([name, file]) => [
      name,
      createHash("sha256").update(readFileSync(file)).digest("hex"),
    ])
  ),
  identity_limit:
    "Controller source/module hashes and actual CLI archive digest are distinct. Their source/release relationship requires separate native readback; no release stamp is fabricated.",
};
const read = file => JSON.parse(readFileSync(file, "utf8"));
for (const [name, harness, failed] of [
  ["scoped-codex", "codex", false],
  ["fleet-success", "fleet", false],
  ["fleet-failed-child", "fleet", true],
]) {
  const directory = path.join(output, name);
  const args = [
    values.controller,
    "--backend",
    "docker",
    "--archive",
    path.resolve(values.archive),
    "--image",
    values.image,
    "--harness",
    harness,
    "--output",
    directory,
    "--preserve",
    sentinel,
    "--preserve",
    absent,
    ...(failed ? ["--failure-control"] : []),
  ];
  const child = spawnSync(process.execPath, args, {
    encoding: "utf8",
    timeout: 25 * 60_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  const preservation = read(path.join(directory, "preservation.json"));
  const native = read(path.join(directory, "native-proof.json"));
  assert.equal(preservation.preserved, true);
  assert.deepEqual(preservation.changed, []);
  assert.equal(preservation.container_removed, true);
  assert.deepEqual(readFileSync(sentinel), sentinelBytes);
  assert.equal(preservation.after[absent].present, false);
  assert.equal(native.apply.error, null);
  assert.equal(native.apply.signal, null);
  if (failed) {
    assert.notEqual(child.status, 0);
    assert.notEqual(native.apply.status, 0);
    assert.equal(native.failure_control.kind, "agy-config-is-directory");
    assert.match(native.apply.stdout + native.apply.stderr, /EISDIR/u);
  } else {
    assert.equal(child.status, 0, child.stderr);
    assert.equal(native.apply.status, 0);
    assert.equal(native.apply_receipt.apply_mode, "full");
    assert.equal(native.passed, true);
    assert.equal(native.guard_cases.length, 14);
    assert.equal(native.retired_safety_net.present, false);
    for (const row of native.guard_cases)
      assert.equal(row.status, row.expected);
    if (harness === "fleet")
      assert.equal(native.agy_config_after.present, true);
  }
  const row = {
    name,
    passed: true,
    controller_status: child.status,
    apply_status: native.apply.status,
    full_apply: native.apply_receipt?.apply_mode ?? null,
    guard_cases: native.guard_cases?.length ?? 0,
    outside_files: Object.keys(preservation.before).length,
    preserved: true,
    native_agent_activation: "not established",
  };
  summary.scenarios.push(row);
  console.log(JSON.stringify(row));
}
const symlinkControl = await qualifySymlinkChange({
  controller: values.controller,
  archive: path.resolve(values.archive),
  image: values.image,
  output: path.join(output, "owned-symlink-control"),
});
summary.scenarios.push(symlinkControl);
console.log(JSON.stringify(symlinkControl));
assert.equal(summary.scenarios.length, 4);
summary.passed = true;
writeFileSync(
  path.join(output, "summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  { mode: 0o600 }
);
