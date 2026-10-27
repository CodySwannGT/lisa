// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

import type { LisaUsageSectionIntegrityResult } from "./usage-ledger.mjs";
export declare function verifyLisaUsageSectionIntegrity(
  storedDocument: string,
  expected?: { entryIds?: readonly string[] }
): LisaUsageSectionIntegrityResult;
