/**
 * Freeing the packed-host journey's checkout without reaching through its
 * `node_modules` link (CodySwannGT/lisa#4636).
 *
 * The candidate's checkout links the repository's own `node_modules`, and
 * packing now frees the checkout as soon as the tarball is proven instead of
 * leaving its 17,053 entries to the teardown. A removal that followed that link
 * would delete the repository's dependencies, so both the removal and the
 * entry count the cache records are proven here against a sentinel that must
 * survive.
 * @module tests/unit/fixtures/shared-runtime-checkout
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  countTreeEntries,
  freeCheckout,
} from "../../fixtures/shared-runtime-hosts/teardown.js";

const scratch: string[] = [];

afterEach(() => {
  for (const area of scratch.splice(0))
    fs.rmSync(area, { force: true, recursive: true });
});

/**
 * Make a scratch directory this file removes afterwards.
 * @param prefix - Name prefix under the temp root
 * @returns The directory
 */
function scratchArea(prefix: string): string {
  const area = fs.mkdtempSync(path.join(tmpdir(), prefix));
  scratch.push(area);
  return area;
}

/**
 * Seed a directory outside the tree under test, holding one sentinel file.
 * @returns The sentinel directory and file
 */
function seedSentinel(): { readonly directory: string; readonly file: string } {
  const directory = path.join(scratchArea("lisa-sentinel-"), "node_modules");
  const file = path.join(directory, "keep.js");
  fs.mkdirSync(directory);
  fs.writeFileSync(file, "keep");
  return { directory, file };
}

/**
 * A not-yet-created checkout path inside a fresh scratch directory.
 * @returns The checkout path
 */
function scratchCheckoutPath(): string {
  return path.join(scratchArea("lisa-checkout-"), "checkout");
}

describe("freeCheckout", () => {
  it("removes the checkout without following its node_modules link", async () => {
    // The checkout links the repository's own node_modules. Freeing it must
    // remove the link, never what the link points at.
    const sentinel = seedSentinel();
    const checkout = scratchCheckoutPath();
    fs.mkdirSync(path.join(checkout, "src"), { recursive: true });
    fs.writeFileSync(path.join(checkout, "src", "index.ts"), "x");
    fs.symlinkSync(
      sentinel.directory,
      path.join(checkout, "node_modules"),
      "dir"
    );

    await freeCheckout(checkout);

    expect(fs.existsSync(checkout)).toBe(false);
    expect(fs.readFileSync(sentinel.file, "utf8")).toBe("keep");
  });

  it("unlinks the link before the removal runs", async () => {
    const sentinel = seedSentinel();
    const checkout = scratchCheckoutPath();
    const link = path.join(checkout, "node_modules");
    const seen: boolean[] = [];
    fs.mkdirSync(checkout);
    fs.symlinkSync(sentinel.directory, link, "dir");

    await freeCheckout(checkout, async directory => {
      seen.push(fs.existsSync(link));
      fs.rmSync(directory, { force: true, recursive: true });
    });

    expect(seen).toEqual([false]);
    expect(fs.existsSync(sentinel.file)).toBe(true);
  });

  it("removes a checkout whose node_modules is a real directory", async () => {
    const checkout = scratchCheckoutPath();
    fs.mkdirSync(path.join(checkout, "node_modules", "pkg"), {
      recursive: true,
    });

    await freeCheckout(checkout);

    expect(fs.existsSync(checkout)).toBe(false);
  });
});

describe("countTreeEntries", () => {
  it("counts a symbolic link as one entry and never follows it", () => {
    const sentinel = seedSentinel();
    const area = scratchArea("lisa-count-");
    fs.mkdirSync(path.join(area, "package"));
    fs.writeFileSync(path.join(area, "package", "index.js"), "x");
    fs.symlinkSync(sentinel.directory, path.join(area, "linked"), "dir");

    expect(countTreeEntries(area)).toBe(3);
  });
});
