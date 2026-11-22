/** A real second checkout for an installed edit-time carrier. @module */
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { commitInstalled, operatorGit } from "./carrier-install.js";

/**
 * Commit the fixture's installed carriers and create a second checkout of them.
 * @param root - Disposable checkout with its agents already installed
 * @returns The peer's physical path and cleanup
 */
export function linkedCarrierCheckout(root: string): {
  readonly peer: string;
  readonly cleanup: () => void;
} {
  const folder = realpathSync(
    mkdtempSync(path.join(tmpdir(), "lisa-edit-linked-"))
  );
  const peer = path.join(folder, "worktree");
  const cleanup = () => rmSync(folder, { force: true, recursive: true });
  try {
    commitInstalled(root);
    const added = operatorGit(root, ["worktree", "add", "--detach", peer]);
    if (added.status !== 0) throw new Error(added.stderr);
  } catch (error) {
    cleanup();
    throw error;
  }
  return { peer, cleanup };
}
