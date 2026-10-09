/** Synthetic native HTTP controls test transport/privacy/teardown, never genuine Chrome qualification. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  browserDriverControl,
  driverDiagnostic,
} from "../../fixtures/npm-update-hosted-runtime/driver-diagnostic.mjs";
import { nativeRecorder } from "../../fixtures/npm-update-hosted-runtime/observations.mjs";
import { createSupervisedUnixFixture } from "../../helpers/supervised-unix-fixture.js";
import { SCRATCH_SUPERVISION_LEASE_ENV } from "../../../src/configs/vitest/scratch-supervision.js";

const PRIVATE_VALUE = "synthetic-private-driver-material";
const TRACE = "driver-trace.json";
const DRIVER_STAGE = "browser-driver";
const DRIVER_START = "driver-start";
const SESSION_CREATE = "session-create";
const RESULT = {
  diagnosticOnly: true,
  driverLaunchVerified: true,
  driverSessionVerified: true,
  nativeSandboxVerified: true,
  suidSandboxActive: true,
  sessionDeleted: true,
  driverClosed: true,
  failureStage: null,
  failureSha256: null,
};

function fixture(operation: (root: string) => Promise<void>) {
  const owned = createSupervisedUnixFixture(
    "hook-reader.sock",
    process.env[SCRATCH_SUPERVISION_LEASE_ENV]
  );
  return operation(owned.root).finally(() => owned.close());
}

function nativeDriver(root: string, mode: string) {
  const command = join(root, "synthetic-driver-control");
  // A finite source-owned protocol consumer replaces browser behavior only in these unit controls.
  writeFileSync(
    command,
    `#!${process.execPath}
import {createServer} from 'node:http';
import {writeFileSync} from 'node:fs';
const trace = {pid:process.pid,requests:[],closed:false};
const record=()=>writeFileSync(${JSON.stringify(join(root, TRACE))},JSON.stringify(trace),{mode:0o600});
const server=createServer(async(req,res)=>{
  const chunks=[];for await(const b of req)chunks.push(b);
  const body=Buffer.concat(chunks).toString();
  trace.requests.push({method:req.method,url:req.url});record();
  let value=null;
  if(req.url==='/session'){
    const options=JSON.parse(body).capabilities.alwaysMatch['goog:chromeOptions'];
    if(options.detach!==false || options.binary!==${JSON.stringify(process.execPath)} || !options.args.includes('--headless=new') || !options.args.includes('--allow-chrome-scheme-url') || options.args.includes('--no-sandbox'))process.exit(23);
    value=${JSON.stringify(mode)}==='refuse'?{error:'session not created',message:${JSON.stringify(PRIVATE_VALUE)}}:{sessionId:${JSON.stringify(mode)}==='array-session'?['a'.repeat(32)]:'a'.repeat(32),capabilities:{}};
  }else if(req.url.endsWith('/url')){
    if(JSON.parse(body).url!=='chrome://sandbox')process.exit(24);
  }else if(req.url.endsWith('/source')){
    value='You are adequately sandboxed.<td>SUID Sandbox</td><td>Yes</td>';
  }
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({value}));
});
server.listen(0,'127.0.0.1',()=>{
  record();
  if(${JSON.stringify(mode)}==='unready') console.log('untrusted endpoint '+${JSON.stringify(PRIVATE_VALUE)});
  else console.log('ChromeDriver was started successfully on port '+server.address().port+'.');
});
process.on('SIGTERM',()=>server.close(()=>{trace.closed=true;record();}));
`,
    { flag: "wx", mode: 0o700 }
  );
  return command;
}

describe("bounded native driver diagnostics", () => {
  it("retains real phase progress without treating a missing final report as success", () => {
    expect(
      driverDiagnostic(
        Buffer.from(
          `${JSON.stringify({ phase: DRIVER_START })}\n${JSON.stringify({ phase: SESSION_CREATE })}\n`
        )
      )
    ).toEqual({
      diagnosticOnly: true,
      phases: [DRIVER_START, SESSION_CREATE],
      refusal: null,
      reportReceived: false,
      report: null,
    });
  });

  it.each([
    "null",
    "[]",
    `not-json ${PRIVATE_VALUE}`,
    JSON.stringify({ phase: PRIVATE_VALUE }),
    JSON.stringify({ phase: "source", private: PRIVATE_VALUE }),
    JSON.stringify({ result: { ...RESULT, private: PRIVATE_VALUE } }),
    JSON.stringify({ result: { ...RESULT, failureStage: PRIVATE_VALUE } }),
    JSON.stringify({ result: { ...RESULT, driverClosed: PRIVATE_VALUE } }),
    JSON.stringify({
      refusalStage: SESSION_CREATE,
      messageSha256: ["f".repeat(64)],
    }),
    JSON.stringify({ result: { ...RESULT, failureSha256: ["f".repeat(64)] } }),
    `${JSON.stringify({ result: RESULT })}\n${JSON.stringify({ phase: "source" })}`,
  ])(
    "refuses malformed or private structured output without returning its text",
    input => {
      expect(() => driverDiagnostic(Buffer.from(input))).toThrow();
      try {
        driverDiagnostic(Buffer.from(input));
      } catch (error) {
        expect(String(error)).not.toContain(PRIVATE_VALUE);
        expect((error as Error).cause).toBeUndefined();
      }
    }
  );

  it("reaches the native protocol consumer and waits for owned driver closure", async () => {
    await fixture(async root => {
      const records: object[] = [];
      const result = await browserDriverControl(
        root,
        {
          cwd: root,
          env: {
            CHROME_BINARY: process.execPath,
            CHROMEDRIVER: nativeDriver(root, "accept"),
          },
        },
        nativeRecorder(root, Date.now() + 60000, records)
      );
      expect(result.report).toEqual(RESULT);
      const trace = JSON.parse(readFileSync(join(root, TRACE), "utf8"));
      expect(
        trace.requests.map(
          (row: { method: string; url: string }) => `${row.method} ${row.url}`
        )
      ).toEqual([
        "POST /session",
        `POST /session/${"a".repeat(32)}/url`,
        `GET /session/${"a".repeat(32)}/source`,
        `DELETE /session/${"a".repeat(32)}`,
      ]);
      expect(trace.closed).toBe(true);
      expect(() => process.kill(trace.pid, 0)).toThrow(
        expect.objectContaining({ code: "ESRCH" })
      );
      expect(records).toEqual([
        expect.objectContaining({ stage: DRIVER_STAGE, status: 0 }),
      ]);
    });
  });

  it("retains failed native status and private streams when diagnostic output is malformed", async () => {
    await fixture(async root => {
      const records: object[] = [];
      await expect(
        nativeRecorder(root, Date.now() + 60000, records)(
          DRIVER_STAGE,
          root,
          {},
          process.execPath,
          [
            "-e",
            `process.stdout.write(${JSON.stringify(PRIVATE_VALUE)});process.exitCode=23`,
          ]
        )
      ).rejects.toMatchObject({ code: 23 });
      expect(records).toEqual([
        expect.objectContaining({ stage: DRIVER_STAGE, status: 23 }),
      ]);
      expect(JSON.stringify(records)).not.toContain(PRIVATE_VALUE);
      expect(readFileSync(join(root, "capture-0-stdout"), "utf8")).toBe(
        PRIVATE_VALUE
      );
    });
  });

  it("keeps the native refusal and withholds the consumer's sensitive message", async () => {
    await fixture(async root => {
      const records: object[] = [];
      const result = await browserDriverControl(
        root,
        {
          cwd: root,
          env: {
            CHROME_BINARY: process.execPath,
            CHROMEDRIVER: nativeDriver(root, "refuse"),
          },
        },
        nativeRecorder(root, Date.now() + 60000, records)
      );
      expect(result.report).toMatchObject({
        driverLaunchVerified: true,
        driverSessionVerified: false,
        driverClosed: true,
        failureStage: SESSION_CREATE,
      });
      expect(result.report?.failureSha256).toBe(
        createHash("sha256")
          .update(
            JSON.stringify({
              error: "session not created",
              message: PRIVATE_VALUE,
            })
          )
          .digest("hex")
      );
      expect(JSON.stringify(result)).not.toContain(PRIVATE_VALUE);
      expect(JSON.stringify(records)).not.toContain(PRIVATE_VALUE);
      expect(records).toEqual([
        expect.objectContaining({ stage: DRIVER_STAGE, status: 1 }),
      ]);
    });
  });

  it("rejects coerced session identifiers before navigation", async () => {
    await fixture(async root => {
      const result = await browserDriverControl(
        root,
        {
          cwd: root,
          env: {
            CHROME_BINARY: process.execPath,
            CHROMEDRIVER: nativeDriver(root, "array-session"),
          },
        },
        nativeRecorder(root, Date.now() + 60000, [])
      );
      expect(result.report).toMatchObject({
        driverLaunchVerified: true,
        driverSessionVerified: false,
        failureStage: SESSION_CREATE,
        driverClosed: true,
      });
      const trace = JSON.parse(readFileSync(join(root, TRACE), "utf8"));
      expect(trace.requests).toEqual([{ method: "POST", url: "/session" }]);
      expect(trace.closed).toBe(true);
    });
  });

  it("never requests an endpoint from unrelated readiness prose", async () => {
    await fixture(async root => {
      const records: object[] = [];
      const result = await browserDriverControl(
        root,
        {
          cwd: root,
          env: {
            CHROME_BINARY: process.execPath,
            CHROMEDRIVER: nativeDriver(root, "unready"),
          },
        },
        nativeRecorder(root, Date.now() + 60000, records)
      );
      expect(result.report).toMatchObject({
        driverLaunchVerified: false,
        driverSessionVerified: false,
        driverClosed: true,
        failureStage: DRIVER_START,
      });
      const trace = JSON.parse(readFileSync(join(root, TRACE), "utf8"));
      expect(trace.requests).toEqual([]);
      expect(trace.closed).toBe(true);
      expect(records).toEqual([
        expect.objectContaining({ stage: DRIVER_STAGE, status: 1 }),
      ]);
    });
  });
});
