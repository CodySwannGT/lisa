import type { LisaUsageSectionIntegrityResult } from "./usage-ledger.mjs";
export declare function verifyLisaUsageSectionIntegrity(
  storedDocument: string,
  expected?: { entryIds?: readonly string[] }
): LisaUsageSectionIntegrityResult;
