/** Compression fixtures model serial transport cost, never provider or signing authority. */
import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { sha256 } from "../../../all/copy-overwrite/scripts/lib/github-attestation-verifier.mjs";
import { canonicalJson } from "../../../all/copy-overwrite/scripts/lisa-automation-provenance.mjs";
import {
  checkpointComments,
  decodeCheckpoint,
  persistCheckpoint,
  recoverPartialCheckpoint,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-checkpoint.mjs";
import {
  completeCheckpoints,
  assertOriginTransport,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-cancel-origin.mjs";

const digest = "a".repeat(64);
const ISSUE_URL = "https://api.github.com/repos/acme/widgets/issues/42";
const empty = {
  version: 1,
  proposal: { files: { "package-lock.json": "" } },
  allocation: {},
  preview: {},
  bundle: "{}",
};
const lock = Array.from(
  { length: 30_000 },
  (_, i) =>
    `node_modules/package-${i % 128}:version=1.2.3:integrity=sha512-${i % 128}|`
).join("");
const payload = {
  ...empty,
  proposal: {
    files: {
      "package-lock.json": lock.slice(
        0,
        1_061_422 - Buffer.byteLength(`${canonicalJson(empty)}\n`)
      ),
    },
  },
};

/** This token-free in-memory provider preserves exact immediate readback behavior. */
function transport() {
  const comments: Array<{ body: string; id: number; issue_url: string }> = [];
  return {
    policy: { repository: "acme/widgets" },
    comments,
    list: async () => [...comments],
    request: async (
      endpoint: string,
      method = "GET",
      input?: { body: string }
    ) => {
      if (method === "POST") {
        const comment = {
          body: input!.body,
          id: comments.length + 1,
          issue_url: ISSUE_URL,
        };
        comments.push(comment);
        return comment;
      }
      return comments.find(comment => endpoint.endsWith(`/${comment.id}`));
    },
  };
}

/** Independent wire fixtures let hostile bytes reach stream and payload validation. */
function wire(
  bytes: Buffer,
  version: number = 2,
  encoded = deflateSync(bytes, { level: 6 })
) {
  const material = version === 1 ? bytes : encoded;
  const count = Math.ceil(material.length / 16_384);
  const chunks = Array.from({ length: count }, (_, index) =>
    material.subarray(index * 16_384, (index + 1) * 16_384)
  );
  const manifest = {
    version,
    originDescriptorSha256: digest,
    payloadSha256: sha256(bytes),
    bytes: bytes.length,
    chunks: chunks.map((chunk, index) => ({ index, sha256: sha256(chunk) })),
    ...(version === 2
      ? {
          encoding: "deflate",
          transportSha256: sha256(material),
          transportBytes: material.length,
        }
      : {}),
  };
  return [
    ...chunks.map((chunk, index) => ({
      body: `[lisa-npm-checkpoint] v${version} ${digest} chunk ${index}/${count} ${sha256(chunk)}\n${chunk.toString("base64")}`,
    })),
    {
      body: `[lisa-npm-checkpoint] v${version} ${digest} complete\n${canonicalJson(manifest)}`,
    },
  ];
}

/** Edit a canonical manifest so integrity failures reach the relevant declared boundary. */
function changedManifest(comments: Array<{ body: string }>, change: object) {
  const last = comments.at(-1)!;
  const [header, text] = last.body.split("\n");
  return [
    ...comments.slice(0, -1),
    {
      body: `${header}\n${canonicalJson({ ...JSON.parse(text!), ...change })}`,
    },
  ];
}

describe("bounded compressed checkpoint transport", () => {
  it("completes a 65-chunk-sized record within the unchanged modeled freshness window", async () => {
    expect(Buffer.byteLength(`${canonicalJson(payload)}\n`)).toBe(1_061_422);
    expect(
      Math.ceil(Buffer.byteLength(`${canonicalJson(payload)}\n`) / 16_384)
    ).toBe(65);
    const api = transport();
    let authorized = 0;
    await persistCheckpoint(api, 42, payload, digest, async () => {
      authorized++;
      // Observed setup and per-comment cadence, without sleeping or changing production time.
      if (108 + authorized * 54 > 3600)
        throw Error("proposal authorization expired");
    });
    expect(api.comments.length).toBeLessThanOrEqual(20);
    expect(authorized).toBe(api.comments.length + 1);
    expect(
      api.comments.every(comment =>
        comment.body.startsWith(`[lisa-npm-checkpoint] v2 ${digest} `)
      )
    ).toBe(true);
    expect(decodeCheckpoint(api.comments, digest)).toEqual(payload);
    expect(checkpointComments(payload, digest)).toHaveLength(
      api.comments.length
    );
  });

  it.each([1, 2])(
    "decodes complete and missing-marker v%i transport without changing the canonical signing bytes",
    version => {
      const bytes = Buffer.from(`${canonicalJson(payload)}\n`);
      const comments = wire(bytes, version);
      expect(decodeCheckpoint([...comments].reverse(), digest)).toEqual(
        payload
      );
      expect(recoverPartialCheckpoint(comments.slice(0, -1), digest)).toEqual(
        payload
      );
      expect(
        sha256(`${canonicalJson(decodeCheckpoint(comments, digest))}\n`)
      ).toBe(sha256(bytes));
      expect(completeCheckpoints(comments)).toEqual([{ digest, payload }]);
    }
  );

  it.each([1, 2])(
    "resumes exact v%i chunks and a completed retry without mixing transport versions",
    async version => {
      const api = transport();
      const original = wire(
        Buffer.from(`${canonicalJson(payload)}\n`),
        version
      );
      for (const comment of original.slice(0, 1))
        api.comments.push({
          ...comment,
          id: api.comments.length + 1,
          issue_url: ISSUE_URL,
        });
      await persistCheckpoint(api, 42, payload, digest, async () => {});
      expect(api.comments.map(comment => comment.body)).toEqual(
        original.map(comment => comment.body)
      );
      await persistCheckpoint(api, 42, payload, digest, async () => {});
      expect(api.comments.map(comment => comment.body)).toEqual(
        original.map(comment => comment.body)
      );
    }
  );

  it("retains a valid alternate compressed stream during all-chunk recovery and completion", async () => {
    const bytes = Buffer.from(`${canonicalJson(payload)}\n`);
    const original = wire(bytes, 2, deflateSync(bytes, { level: 1 }));
    const api = transport();
    for (const comment of original.slice(0, -1))
      api.comments.push({
        ...comment,
        id: api.comments.length + 1,
        issue_url: ISSUE_URL,
      });
    expect(recoverPartialCheckpoint(api.comments, digest)).toEqual(payload);
    await persistCheckpoint(api, 42, payload, digest, async () => {});
    expect(api.comments.map(comment => comment.body)).toEqual(
      original.map(comment => comment.body)
    );
  });

  it("completes 65 existing legacy chunks with fresh authority only for the one missing mutation", async () => {
    const api = transport();
    const original = wire(Buffer.from(`${canonicalJson(payload)}\n`), 1);
    for (const comment of original.slice(0, -1))
      api.comments.push({
        ...comment,
        id: api.comments.length + 1,
        issue_url: ISSUE_URL,
      });
    let authorized = 0;
    await persistCheckpoint(api, 42, payload, digest, async () => {
      authorized++;
      if (108 + authorized * 54 > 3600)
        throw Error("proposal authorization expired");
    });
    expect(authorized).toBe(2);
    expect(api.comments.map(comment => comment.body)).toEqual(
      original.map(comment => comment.body)
    );
    await persistCheckpoint(api, 42, payload, digest, async () => {
      authorized++;
    });
    expect(authorized).toBe(3);
    expect(api.comments).toHaveLength(66);
  });

  it("rechecks changed live authority before every missing write, including completion", async () => {
    const api = transport();
    let authorized = 0;
    await expect(
      persistCheckpoint(api, 42, empty, digest, async () => {
        authorized++;
        if (authorized === 3) throw Error("current main/claim/hold changed");
      })
    ).rejects.toThrow(/changed/);
    expect(authorized).toBe(3);
    expect(api.comments).toHaveLength(1);
    expect(api.comments[0]!.body).toContain(" chunk ");
  });

  it.each(["edited", "duplicate", "mixed", "missing"])(
    "rereads %s chunk state after fresh authorization before completion",
    async fault => {
      const api = transport();
      let authorized = 0;
      await expect(
        persistCheckpoint(api, 42, empty, digest, async () => {
          authorized++;
          if (authorized !== 3) return;
          if (fault === "edited") api.comments[0]!.body += "edited";
          if (fault === "duplicate") api.comments.push({ ...api.comments[0]! });
          if (fault === "mixed")
            api.comments.push({
              ...api.comments[0]!,
              body: api.comments[0]!.body.replace(" v2 ", " v1 "),
            });
          if (fault === "missing") api.comments.splice(0, 1);
        })
      ).rejects.toThrow();
      expect(
        api.comments.every(comment => !comment.body.includes(" complete\n"))
      ).toBe(true);
    }
  );

  it("applies the same immutable Bot transport chronology to compressed comments", () => {
    const posted = "2026-10-07T00:01:00Z";
    const comments = checkpointComments(payload, digest).map(body => ({
      body,
      user: { type: "Bot", id: 99 },
      created_at: posted,
      updated_at: posted,
    }));
    const run = {
      status: "completed",
      run_started_at: "2026-10-07T00:00:00Z",
      updated_at: "2026-10-07T00:05:00Z",
    };
    expect(() =>
      assertOriginTransport(comments, digest, { claimActorId: "99" }, run)
    ).not.toThrow();
    expect(() =>
      assertOriginTransport(
        [
          { ...comments[0], user: { type: "User", id: 99 } },
          ...comments.slice(1),
        ],
        digest,
        { claimActorId: "99" },
        run
      )
    ).toThrow(/foreign actor/);
  });

  it("rejects bombs, appended bytes, concatenated streams and invalid UTF-8 before returning any payload", () => {
    const bytes = Buffer.from(`${canonicalJson(empty)}\n`);
    const encoded = deflateSync(bytes);
    for (const comments of [
      wire(Buffer.alloc(4_194_305, 120)),
      wire(bytes, 2, Buffer.concat([encoded, Buffer.from("tail")])),
      wire(bytes, 2, Buffer.concat([encoded, encoded])),
      wire(Buffer.from([0xff, 0xfe])),
      wire(Buffer.from(`{ "version":1}\n`)),
      wire(
        Buffer.from(
          `${canonicalJson(empty).replace('"version":1', '"version":1,"version":1')}\n`
        )
      ),
    ])
      expect(() => decodeCheckpoint(comments, digest)).toThrow();
    expect(() =>
      decodeCheckpoint(
        wire(bytes, 2, Buffer.concat([encoded, encoded])),
        digest
      )
    ).toThrow(/trailing/);
    const bomb = changedManifest(wire(Buffer.alloc(4_194_305, 120)), {
      bytes: 4_194_304,
    });
    try {
      decodeCheckpoint(bomb, digest);
      throw Error("compressed bomb unexpectedly decoded");
    } catch (error) {
      expect(error).toHaveProperty("code", "ERR_BUFFER_TOO_LARGE");
    }
  });

  it("rejects contradictory codec, payload or compressed declarations and unexpected fields", () => {
    const comments = wire(Buffer.from(`${canonicalJson(empty)}\n`));
    for (const change of [
      { encoding: "gzip" },
      { version: 1 },
      { bytes: 4_194_305 },
      { bytes: 0 },
      { bytes: 0.5 },
      { transportBytes: 4_194_305 },
      { transportBytes: 0 },
      { transportBytes: 1 },
      { payloadSha256: "b".repeat(64) },
      { transportSha256: "b".repeat(64) },
      { originDescriptorSha256: "b".repeat(64) },
      { extra: "untrusted" },
    ])
      expect(() =>
        decodeCheckpoint(changedManifest(comments, change), digest)
      ).toThrow();
  });

  it("rejects mixed, unknown, missing, conflicting or noncanonical chunk transport", async () => {
    const bytes = Buffer.from(`${canonicalJson(empty)}\n`);
    const comments = wire(bytes);
    const legacy = wire(bytes, 1);
    for (const values of [
      [...comments, legacy[0]!],
      comments.map(comment => ({ body: comment.body.replace(" v2 ", " v3 ") })),
      comments.slice(1),
      comments.slice(0, -1),
      [...comments, comments.at(-1)!],
      [...comments, { body: comments[0]!.body.replace(/.$/, "!") }],
      [
        { body: comments[0]!.body.replace("chunk 0/1", "chunk 00/1") },
        comments[1]!,
      ],
    ]) {
      expect(() => decodeCheckpoint(values, digest)).toThrow();
      const api = transport();
      for (const comment of values)
        api.comments.push({
          ...comment,
          id: api.comments.length + 1,
          issue_url: ISSUE_URL,
        });
      if (values.length !== 1 || values[0]?.body.includes(" complete\n"))
        await expect(
          persistCheckpoint(api, 42, empty, digest, async () => {})
        ).rejects.toThrow();
    }
    expect(() =>
      recoverPartialCheckpoint(
        [...comments.slice(0, -1), ...legacy.slice(0, -1)],
        digest
      )
    ).toThrow(/mixed/);
  });
});
