import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runUi } from "../../../src/cli/ui-cmd.js";

/** Mutable resources owned by each malformed-request test. */
interface TestResources {
  dir: string;
  server: Server | undefined;
}

const resources: TestResources = { dir: "", server: undefined };

beforeEach(async () => {
  resources.dir = await mkdtemp(path.join(tmpdir(), "lisa-ui-status-http-"));
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (resources.server !== undefined) {
    await new Promise(resolve => resources.server?.close(resolve));
    resources.server = undefined;
  }
  await rm(resources.dir, { recursive: true, force: true });
});

/**
 * Send a request target that fetch deliberately refuses to construct.
 * @param port - Bound loopback server port
 * @param request - Complete raw HTTP request
 * @returns Raw HTTP response
 */
async function sendRawRequest(port: number, request: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: string[] = [];
    const socket = createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(request);
    });
    socket.setEncoding("utf8");
    socket.on("data", chunk => chunks.push(chunk));
    socket.on("end", () => resolve(chunks.join("")));
    socket.on("error", reject);
  });
}

describe("lisa ui malformed request handling", () => {
  it("returns 400 when the request target is not a valid URL", async () => {
    resources.server = await runUi(
      resources.dir,
      { port: "0", sync: false },
      { probes: [] }
    );
    const address = resources.server.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;

    const response = await sendRawRequest(
      port,
      "GET //[ HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    );

    expect(response).toMatch(/^HTTP\/1\.1 400 Bad Request\r\n/u);
    expect(response).toContain("Bad request");
  });

  it("rejects a non-loopback Host header before routing", async () => {
    resources.server = await runUi(
      resources.dir,
      { port: "0", sync: false },
      { probes: [] }
    );
    const address = resources.server.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;

    const response = await sendRawRequest(
      port,
      "GET /api/status HTTP/1.1\r\nHost: attacker.example\r\nConnection: close\r\n\r\n"
    );

    expect(response).toMatch(/^HTTP\/1\.1 400 Bad Request\r\n/u);
    expect(response).toContain("Bad request");
  });
});
