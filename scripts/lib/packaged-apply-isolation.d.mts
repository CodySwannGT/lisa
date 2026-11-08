export declare function refuseHostApply(
  harness: string,
  agyDestination: string
): never;
export declare function assertDisposableContainer(
  row: Record<string, unknown>,
  id: string
): void;
export declare function snapshotFiles(
  files: readonly string[],
  evidenceDirectory?: string,
  options?: { phase?: "before" | "after" }
): Promise<Record<string, object>>;
export declare function compareSnapshots(
  before: Record<string, object>,
  after: Record<string, object>
): string[];
export declare function preserveUnexpectedWrite(
  file: string,
  evidenceDirectory: string
): Promise<{
  copy: string;
  prior_content: "unknown";
  restored: false;
}>;
