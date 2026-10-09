/** Real child-process controls for overlap and failure drainage of evidence scans. */
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  statSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nativeCommands } from "../fixtures/git-history-secrets/harness.mjs";
import { runTwoWorkers } from "../fixtures/git-history-secrets/errors.mjs";
import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";

useIoLatencyBudget();
const roots: string[] = [];
const root = () => {
  const directory = mkdtempSync(join(tmpdir(), "history-native-queue-"));
  roots.push(directory);
  return directory;
};
afterEach(() => {
  for (const directory of roots.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const child = `
import {existsSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
const [directory,index,mode]=process.argv.slice(1);
const marker=name=>join(directory,name);
const input=[];for await(const chunk of process.stdin)input.push(chunk);
writeFileSync(marker(index+'.start'),Buffer.concat(input));
const partner=String(Number(index)^1),deadline=Date.now()+5000;
while(!existsSync(marker(partner+'.start'))){
 if(Date.now()>=deadline)process.exit(19);
 await pause(10);
}
if(mode==='fail'&&index==='0')process.exit(17);
if(mode==='fail'){
 while(!existsSync(marker('failure-observed'))){
  if(Date.now()>=deadline)process.exit(20);
  await pause(10);
 }
}
writeFileSync(marker(index+'.end'),'complete');
process.stdout.write(index);
`;

describe("native evidence queue", () => {
  it("overlaps each real pair, forwards stdin and retains every ordered result", async () => {
    const directory = root();
    const outputs: string[] = [];
    const proof = join(directory, "proof");
    mkdirSync(proof, { mode: 0o700 });
    const commands = nativeCommands(outputs, proof);
    const active = { current: 0, maximum: 0 };
    const results = await runTwoWorkers(
      Array.from({ length: 6 }, (_, index) => async () => {
        active.current++;
        active.maximum = Math.max(active.maximum, active.current);
        try {
          const result = await commands.commandAsync(
            process.execPath,
            [
              "--input-type=module",
              "-e",
              child,
              directory,
              String(index),
              "pair",
            ],
            directory,
            `input-${index}`
          );
          expect(result.status).toBe(0);
          return result.stdout;
        } finally {
          active.current--;
        }
      })
    );
    expect(results).toEqual(["0", "1", "2", "3", "4", "5"]);
    expect(outputs).toHaveLength(6);
    expect(active).toEqual({ current: 0, maximum: 2 });
    expect(statSync(proof).mode & 0o777).toBe(0o700);
    const records = readdirSync(proof).map(file => {
      const path = join(proof, file);
      expect(statSync(path).mode & 0o777).toBe(0o600);
      return JSON.parse(readFileSync(path, "utf8"));
    });
    expect(records).toHaveLength(6);
    expect(
      records.every(record => record.status === 0 && record.signal === null)
    ).toBe(true);
    expect(
      records
        .map(record => record.input)
        .sort((left, right) => left.localeCompare(right))
    ).toEqual(Array.from({ length: 6 }, (_, index) => `input-${index}`));
    for (let index = 0; index < 6; index++) {
      expect(readFileSync(join(directory, `${index}.start`), "utf8")).toBe(
        `input-${index}`
      );
      expect(existsSync(join(directory, `${index}.end`))).toBe(true);
    }
  });

  it("retains the actual failed exit and drains its running partner before refusing", async () => {
    const directory = root();
    const outputs: string[] = [];
    const commands = nativeCommands(outputs, null);
    const run = (index: number) => async () => {
      const result = await commands.commandAsync(
        process.execPath,
        ["--input-type=module", "-e", child, directory, String(index), "fail"],
        directory,
        ""
      );
      if (index === 0) {
        expect(result.status).toBe(17);
        writeFileSync(join(directory, "failure-observed"), "observed");
        throw new Error("Actual evidence verdict refused.");
      }
      expect(result.status).toBe(0);
    };
    await expect(runTwoWorkers([run(0), run(1), run(2)])).rejects.toThrow(
      "Actual evidence verdict refused."
    );
    expect(existsSync(join(directory, "1.end"))).toBe(true);
    expect(existsSync(join(directory, "2.start"))).toBe(false);
    expect(outputs).toHaveLength(2);
  });
});
