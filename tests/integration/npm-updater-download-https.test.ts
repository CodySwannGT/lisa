/** Real curl controls for the five downloads in the shared updater recipe. */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { ioLatencyBudgetMs } from "../helpers/io-latency-budget.js";

const execute = promisify(execFile);
const recipe = readFileSync(
  new URL(
    "../../all/copy-overwrite/scripts/npm-updater-gate.Dockerfile",
    import.meta.url
  ),
  "utf8"
);
const downloads = recipe
  .split("\n")
  .map(line => line.trim())
  .filter(line => line.startsWith("curl --fail --location "));

/**
 * Extract only actual protocol option/value pairs, without evaluating shell.
 * @param line One download command from the owned recipe
 * @returns Literal curl protocol arguments
 */
function protocolPolicy(line: string): readonly string[] {
  return [...line.matchAll(/(--proto(?:-redir)?)\s+'([^']+)'/gu)].flatMap(
    match => [match[1]!, match[2]!]
  );
}

/**
 * Keep real refusal exits observable rather than converting them to success.
 * @param args Literal arguments for the owned curl control
 * @returns The actual process exit and captured output
 */
async function curl(args: readonly string[]) {
  try {
    const result = await execute("curl", ["-q", ...args], {
      timeout: ioLatencyBudgetMs(15_000),
      env: { ...process.env, LC_ALL: "C" },
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as {
      readonly code?: number | string;
      readonly stdout?: string;
      readonly stderr?: string;
    };
    if (typeof failure.code !== "number") throw error;
    return {
      code: failure.code,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

describe("updater download HTTPS policy", () => {
  it("restricts both initial and redirected protocols on all five downloads", () => {
    expect(downloads).toHaveLength(5);
    for (const command of downloads) {
      expect(protocolPolicy(command)).toEqual([
        "--proto",
        "=https",
        "--proto-redir",
        "=https",
      ]);
    }
  });

  it("accepts trusted HTTPS and refuses each real HTTPS-to-HTTP redirect before HTTP is reached", async () => {
    const root = await mkdtemp(join(tmpdir(), "lisa-updater-https-"));
    const insecureRequests: string[] = [];
    const plain = createHttpServer((request, response) => {
      insecureRequests.push(request.url ?? "");
      response.end("owned HTTP control");
    });
    let secure: ReturnType<typeof createHttpsServer> | undefined;
    try {
      const config = join(root, "certificate.cnf");
      const key = join(root, "key.pem");
      const cert = join(root, "certificate.pem");
      await writeFile(
        config,
        "[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ext\n" +
          "[dn]\nCN=localhost\n[ext]\n" +
          "subjectAltName=DNS:localhost,IP:127.0.0.1\n" +
          "basicConstraints=critical,CA:TRUE\n" +
          "keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\n" +
          "extendedKeyUsage=serverAuth\n"
      );
      await execute(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-days",
          "1",
          "-config",
          config,
          "-keyout",
          key,
          "-out",
          cert,
        ],
        { timeout: ioLatencyBudgetMs(15_000) }
      );
      await new Promise<void>(resolve => plain.listen(0, "127.0.0.1", resolve));
      const plainAddress = plain.address();
      if (plainAddress === null || typeof plainAddress === "string") {
        throw new Error("Owned HTTP listener has no TCP address");
      }
      secure = createHttpsServer(
        { key: await readFile(key), cert: await readFile(cert) },
        (request, response) => {
          if (request.url === "/ok") {
            response.end("owned HTTPS success");
            return;
          }
          response.writeHead(302, {
            Location: `http://127.0.0.1:${plainAddress.port}${request.url}`,
          });
          response.end();
        }
      );
      await new Promise<void>(resolve =>
        secure!.listen(0, "127.0.0.1", resolve)
      );
      const address = secure.address();
      if (address === null || typeof address === "string") {
        throw new Error("Owned HTTPS listener has no TCP address");
      }
      const origin = `https://127.0.0.1:${address.port}`;
      const base = [
        "--fail",
        "--location",
        "--silent",
        "--show-error",
        "--noproxy",
        "*",
        "--cacert",
        cert,
        "--connect-timeout",
        "5",
        "--max-time",
        "10",
      ];
      // A real unrestricted redirect proves the trusted TLS and HTTP fixtures work.
      const control = await curl([...base, `${origin}/control`]);
      expect(control.code).toBe(0);
      expect(control.stdout).toBe("owned HTTP control");
      expect(insecureRequests).toEqual(["/control"]);
      expect(downloads).toHaveLength(5);
      for (const [index, command] of downloads.entries()) {
        const policy = protocolPolicy(command);
        const success = await curl([...base, ...policy, `${origin}/ok`]);
        expect(success.code).toBe(0);
        expect(success.stdout).toBe("owned HTTPS success");
        const refused = await curl([
          ...base,
          ...policy,
          `${origin}/forbidden-${index}`,
        ]);
        expect(refused.code).toBe(1);
        expect(refused.stderr).toMatch(/http.*(?:disabled|not supported)/iu);
        expect(insecureRequests).toEqual(["/control"]);
      }
    } finally {
      for (const server of [secure, plain]) {
        if (server?.listening) {
          server.closeAllConnections();
          await new Promise<void>((resolve, reject) =>
            server.close(error => (error ? reject(error) : resolve()))
          );
        }
      }
      await rm(root, { recursive: true, force: true });
    }
  });
});
