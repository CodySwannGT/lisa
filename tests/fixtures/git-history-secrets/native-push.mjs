/**
 * @file native-push.mjs
 * @description Real disposable bare pushes qualify Git's actual source labels and hook environment.
 * @module history-secrets-fixtures
 */
import { chmodSync, cpSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { validPreimageTuples } from "./errors.mjs";
const CREDENTIAL_FILE = "credential.txt";
export const nativePushCases = harness => {
  const {
    initialize,
    scratch,
    git,
    command,
    write,
    commit,
    secret,
    emitted,
    scanner,
    SCANNER_ENTRY,
    requireFact,
    observations,
  } = harness;
  try {
    const { cwd, base } = initialize("native-push");
    const remote = join(scratch, "disposable-remote.git");
    git(scratch, "init", "--bare", "-q", remote);
    const head = commit(cwd, "clean.txt", "clean second\n");
    const receipt = join(cwd, "hook-input");
    write(
      cwd,
      ".git/hooks/pre-push",
      `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const input = readFileSync(0);
writeFileSync(${JSON.stringify(receipt)}, input, { mode: 0o600 });
const result = spawnSync(process.execPath, ${JSON.stringify([join(emitted, SCANNER_ENTRY), "pre-push", "--scanner", scanner])}, { input, stdio: ['pipe', 'inherit', 'inherit'] });
process.exitCode = result.status === 0 ? 0 : 1;
`
    );
    chmodSync(join(cwd, ".git/hooks/pre-push"), 0o700);
    for (const [source, destination] of [
      ["HEAD", "head"],
      ["HEAD~1", "ancestor"],
      [head, "object"],
    ]) {
      const result = command(
        "git",
        ["push", remote, `${source}:refs/heads/${destination}`],
        cwd
      );
      if (harness.proof)
        write(
          harness.proof,
          `native-${destination}-input`,
          readFileSync(receipt)
        );
      requireFact(
        result.status === 0,
        "Actual clean source-expression push failed."
      );
      const input = readFileSync(receipt, "utf8");
      requireFact(
        input.startsWith(`${source} `),
        "Git source-expression receipt differs."
      );
      observations.push({
        name: `native-clean-${destination}`,
        exit: result.status,
      });
    }
    git(cwd, "checkout", "-qb", "first");
    const first = commit(cwd, "first.txt", "clean first\n");
    git(cwd, "checkout", "-qb", "second", base);
    commit(cwd, CREDENTIAL_FILE, secret());
    git(cwd, "rm", "-q", CREDENTIAL_FILE);
    git(cwd, "commit", "-qm", "clean tip");
    git(cwd, "checkout", "-q", "--detach", first);
    const result = command(
      "git",
      [
        "push",
        remote,
        "refs/heads/first:refs/heads/first",
        "refs/heads/second:refs/heads/second",
      ],
      cwd
    );
    requireFact(
      result.status === 1 && result.stdout.includes("generic-api-key"),
      "Actual native multiref push did not block with scanner attribution."
    );
    requireFact(
      readFileSync(receipt, "utf8").trim().split("\n").length === 2,
      "Actual native push did not supply both records."
    );
    observations.push({
      name: "native-two-ref-earlier-secret-block",
      exit: result.status,
    });
  } catch {
    throw new Error(
      "Native disposable push witness failed; private receipt retained."
    );
  }
};

export const graphCases = harness => {
  const {
    args,
    option,
    observations,
    command,
    requireFact,
    git,
    write,
    commit,
    secret,
    initialize,
    emitted,
    scan,
  } = harness;
  try {
    const zero = "0".repeat(40);
    const fixture = initialize("multiref");
    const { cwd, base } = fixture;
    git(cwd, "checkout", "-qb", "first");
    const first = commit(cwd, "first.txt", "clean first\n");
    git(cwd, "checkout", "-qb", "second", base);
    const earlier = commit(cwd, CREDENTIAL_FILE, secret());
    git(cwd, "rm", "-q", CREDENTIAL_FILE);
    git(cwd, "commit", "-qm", "clean tip");
    const second = git(cwd, "rev-parse", "HEAD");
    git(cwd, "checkout", "-q", "--detach", base);
    const multi = scan(
      cwd,
      "two-ref-neither-HEAD",
      [
        { before: base, after: first },
        { before: base, after: second },
      ],
      42
    );
    scan(
      cwd,
      "new-ref-earlier-secret-clean-tip",
      [{ before: zero, after: second }],
      42
    );
    scan(
      cwd,
      "cross-ref-exclusion",
      [
        { before: base, after: second },
        { before: earlier, after: first },
      ],
      42
    );
    scan(
      cwd,
      "already-reachable-excluded",
      [{ before: earlier, after: second }],
      0
    );
    scan(
      cwd,
      "unrelated-dirty-ref-clean-update",
      [{ before: base, after: first }],
      0
    );
    scan(cwd, "deleted-only", [{ before: second, after: zero }], 0);
    scan(
      cwd,
      "mixed-deletion-update",
      [
        { before: second, after: zero },
        { before: base, after: second },
      ],
      42
    );
    scan(cwd, "empty", [], 0);
    write(
      cwd,
      ".lisa.config.json",
      JSON.stringify({
        gates: {
          "introduced-history-credential-leakage": { push: "required" },
        },
      })
    );
    const trace = join(cwd, "scripts");
    cpSync(join(emitted, "scripts"), trace, { recursive: true });
    write(
      cwd,
      "scripts/lisa-work-item.mjs",
      `import{readFileSync,writeFileSync}from'node:fs';writeFileSync('trace-input',readFileSync(0),{mode:0o600});console.error(${JSON.stringify(harness.values[0])});process.exitCode=1;\n`
    );
    const wrapper = command(
      process.execPath,
      [join(trace, "lisa-rails-prepush.mjs"), "origin"],
      cwd,
      multi.input
    );
    requireFact(
      wrapper.status === 1 &&
        readFileSync(join(cwd, "trace-input"), "utf8") === multi.input,
      "Traceability fan-out on finding failed."
    );
    observations.push({
      name: "buffered-stdin-fan-out-even-on-finding",
      exit: wrapper.status,
    });
    const lefthook = args.includes("--lefthook")
      ? resolve(option("--lefthook"))
      : "lefthook";
    cpSync(join(emitted, "lefthook.yml"), join(cwd, "lefthook.yml"));
    const hook = command(
      lefthook,
      [
        "run",
        "pre-push",
        "origin",
        "--command",
        "work-item",
        "--no-auto-install",
        "--no-tty",
        "--colors",
        "off",
      ],
      cwd,
      multi.input
    );
    requireFact(
      hook.status === 1 &&
        readFileSync(join(cwd, "trace-input"), "utf8") === multi.input &&
        hook.stdout.includes("generic-api-key"),
      "Actual emitted Lefthook stdin route failed."
    );
    observations.push({
      name: "actual-emitted-lefthook-multiref",
      exit: hook.status,
    });
    git(cwd, "checkout", "-q", "first");
    git(cwd, "merge", "--no-ff", "second", "-m", "merge fixture");
    const merged = git(cwd, "rev-parse", "HEAD");
    scan(cwd, "merge-side-history", [{ before: first, after: merged }], 42);
    const resolution = initialize("merge-resolution");
    git(resolution.cwd, "checkout", "-qb", "side");
    commit(resolution.cwd, "side.txt", "clean side\n");
    git(resolution.cwd, "checkout", "-q", "main");
    const main = commit(resolution.cwd, "main.txt", "clean main\n");
    git(resolution.cwd, "merge", "--no-ff", "--no-commit", "side");
    const mergeSecret = commit(resolution.cwd, "resolution.txt", secret());
    scan(
      resolution.cwd,
      "merge-resolution-secret",
      [{ before: main, after: mergeSecret }],
      42
    );
    git(cwd, "checkout", "-qb", "divergent", base);
    commit(cwd, "force.txt", secret());
    const force = commit(cwd, "force.txt", "clean force tip\n");
    scan(cwd, "force-update", [{ before: first, after: force }], 42);

    return { zero, cwd, base, first, earlier, second, multi };
  } catch {
    throw new Error(
      "graphs.mjs: actual fixture boundary failed; raw vendor metadata is withheld."
    );
  }
};

/**
 * Independently prove every batch member and return authenticated Git identities/sizes.
 * @param harness - Original bounded private fixture operations
 * @param cwd - Owned Git repository
 * @param tuples - At most256 closed native proof records
 * @returns Raw identity inventory for private closure metrics
 */
export const provePreimageBatch = (harness, cwd, tuples) => {
  const script = String.raw`import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const git=(...args)=>execFileSync('git',['--no-replace-objects',...args],{maxBuffer:1024*1024});
const records=JSON.parse(process.argv[1]);
const inventory=records.map(([commit,path,expected])=>{
 const row=git('--literal-pathspecs','ls-tree','-z',commit,'--',path).toString().match(/^(100644|100755) blob ([a-f0-9]{40}|[a-f0-9]{64})\t([^\0]*)\0$/u);
 if(!row||row[3]!==path||row[2].length!==commit.length)throw Error('Unproved blob');
 const bytes=git('show',commit+':'+path);
 const oid=createHash(commit.length===40?'sha1':'sha256').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
 if(oid!==row[2]||(expected!==null&&createHash('sha256').update(bytes).digest('hex')!==expected))throw Error('Unproved preimage');
 return {commit,path,oid,size:bytes.length};
});
console.log(JSON.stringify(inventory));`;
  if (!validPreimageTuples(tuples))
    throw new Error("Invalid native preimage proof batch.");
  const proof = harness.command(
    process.execPath,
    ["--input-type=module", "-e", script, JSON.stringify(tuples)],
    cwd
  );
  harness.requireFact(
    proof.status === 0,
    "Actual Git byte preimage witness failed."
  );
  return JSON.parse(proof.stdout);
};

/**
 * Preserve the original credential-field bytes as an actual emitted parser refusal.
 * @param harness - Original bounded child and assertion authority
 * @param text - Original synthetic credential paragraph, never a vendor finding claim
 */
export const proveCredentialParagraphRefusal = (harness, text) => {
  const { command: run, requireFact: check, emitted, scratch } = harness;
  const script = `import {pathToFileURL} from 'node:url'; const {paragraphNarrativeSpan}=await import(pathToFileURL(process.argv[1]+'/scripts/lib/history-secret-evidence-shape.mjs')); const bytes=Buffer.from(process.argv[2]); if(paragraphNarrativeSpan(bytes,0,bytes.length)!==null)throw Error('Credential paragraph accepted');`;
  const args = ["--input-type=module", "-e", script, emitted, text];
  check(run(process.execPath, args, scratch).status === 0, "Parser refusal.");
};
