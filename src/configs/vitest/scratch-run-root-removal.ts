/** Token- and inode-bound removal for owned scratch run roots. */
import * as path from "node:path";

import {
  SCRATCH_QUARANTINE_PREFIX,
  removeAuthorizedScratchRoot,
} from "./scratch-authority.js";
import { readBoundedScratchNamespace } from "./scratch-namespace-reader.js";
import {
  readScratchOwnerRecord,
  scratchPathIdentity,
  type ScratchPathIdentity,
} from "./scratch-owner.js";
import {
  assertIntentOwner,
  openOwnedScratchRunRoot,
  type OwnedScratchRunRoot,
  type ScratchRunRootIntentV1,
} from "./scratch-run-root-intent.js";

/**
 * Find a matching interrupted quarantine by token and original inode.
 * @param intent - Precommitted root facts
 * @returns Matching quarantine identity, or undefined
 */
function interruptedQuarantine(
  intent: ScratchRunRootIntentV1
):
  | { readonly basename: string; readonly identity: ScratchPathIdentity }
  | undefined {
  for (const basename of readBoundedScratchNamespace(
    intent.authority.namespace.canonicalPath
  )) {
    if (!basename.startsWith(SCRATCH_QUARANTINE_PREFIX)) continue;
    const candidate = path.join(
      intent.authority.namespace.canonicalPath,
      basename
    );
    try {
      const owner = readScratchOwnerRecord(candidate);
      if (owner.token !== intent.token) continue;
      const identity = scratchPathIdentity(candidate);
      assertIntentOwner(intent, owner, identity);
      return { basename, identity };
    } catch {
      // Foreign and malformed quarantines never authorize this intent.
    }
  }
  return undefined;
}

/**
 * Remove a run root using the authority captured when it was made.
 * @param owned - Durable handle or precommitted intent
 */
export function removeOwnedScratchRunRoot(
  owned: OwnedScratchRunRoot | ScratchRunRootIntentV1
): void {
  if ("rootPath" in owned) {
    const opened = openOwnedScratchRunRoot(owned);
    if (opened !== undefined) {
      removeOwnedScratchRunRoot(opened);
      return;
    }
    const quarantine = interruptedQuarantine(owned);
    if (quarantine === undefined) return;
    removeAuthorizedScratchRoot({
      authority: owned.authority,
      basename: quarantine.basename,
      expectedToken: owned.token,
      expectedIdentity: quarantine.identity,
    });
    return;
  }
  removeAuthorizedScratchRoot({
    authority: owned.authority,
    basename: owned.basename,
    expectedToken: owned.owner.token,
    expectedIdentity: owned.owner.root,
  });
}
