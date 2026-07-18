/**
 * Live-status probe for the console Stacks section.
 *
 * Mirrors doctor's detection chain exactly so the console and `lisa doctor`
 * can never disagree. An empty match is the honest empty value (`[]`), never
 * unknown; the runner maps a thrown detector error to unknown.
 * @module cli/ui-detected-stacks
 */
import {
  createDetectorRegistry,
  type DetectorRegistry,
} from "../detection/index.js";
import type { StatusProbe } from "./ui-status.js";

/** Probe id for the detected-stacks live-status entry. */
export const DETECTED_STACKS_PROBE_ID = "detected-stacks";

/**
 * Create the probe that reports the project's detected stacks.
 * @param destDir - Project root scanned by the detector registry
 * @param registry - Injectable detector registry used by focused tests
 * @returns Probe emitting the expanded, ordered project types
 */
export function createDetectedStacksProbe(
  destDir: string,
  registry: DetectorRegistry = createDetectorRegistry()
): StatusProbe<string[]> {
  return {
    id: DETECTED_STACKS_PROBE_ID,
    timeoutMs: 5_000,
    run: async () => {
      const types = registry.expandAndOrderTypes(
        await registry.detectAll(destDir)
      );
      return { state: "value", value: [...types] };
    },
  };
}
