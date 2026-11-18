/**
 * The three results `lisa controls enforce-report` is handed, as far as the
 * report reads them. Each command may print more than is listed here; only
 * these keys are checked and used. See `./enforce-inputs.ts`.
 * @module controls/enforce-input-types
 */
import type {
  CarrierChange,
  CarrierKind,
  CarrierPointOutcome,
} from "./carrier-types.js";
import type {
  HandoverOutcome,
  ProtectMode,
  ProtectOutcome,
  SentRequest,
} from "./protect-types.js";
import type { EnforcementLocation } from "./register-types.js";

/** The format version every handed document carries. */
export const HANDED_SCHEMA_VERSION = 1;

/** The states a ticket the flow reports can be in. */
export const TICKET_STATES = ["created", "existing", "declined"] as const;

/** One enforcement point of the carriers result, as far as it is read. */
export interface HandedCarrierPoint {
  readonly kind: CarrierKind;
  readonly location: EnforcementLocation;
  readonly moment: string;
  readonly outcome: CarrierPointOutcome;
  readonly reason: string | null;
  /** The coding agent the point belongs to; only an agent point has it. */
  readonly agent?: string;
}

/**
 * The carriers result, as far as it is read. It is what an installing run
 * printed: the output of a `--check` run is refused before it gets here.
 * What it says of a point is set beside a fresh read of the checkout
 * (`./enforce-carriers.ts`), and the read is what the report believes.
 */
export interface HandedCarriers {
  readonly mode: "install";
  readonly enforcement_points: readonly HandedCarrierPoint[];
  readonly changes: readonly CarrierChange[];
}

/** One register entry of the merge-protection result, as far as it is read. */
export interface HandedProtectEntry {
  readonly id: string;
  readonly outcome: ProtectOutcome;
  readonly reason: string;
}

/** The merge-protection result, as far as it is read. */
export interface HandedProtect {
  readonly mode: ProtectMode;
  /** The branch whose protection was compared, when the platform named one. */
  readonly branch: string | null;
  readonly platform: { readonly name: string };
  readonly entries: readonly HandedProtectEntry[];
  readonly handover: HandoverOutcome;
  readonly requests: readonly SentRequest[];
}

/** One result of the missing-capability ticket flow. */
export interface HandedTicket {
  readonly criterion: string;
  readonly scope: string;
  /** The key `lisa controls gaps` gave the requirement. */
  readonly key: string;
  readonly outcome: "ticketed" | "blocked";
  readonly ticket: string | null;
  readonly ticket_state: (typeof TICKET_STATES)[number] | null;
  readonly reason: string | null;
  readonly question: string | null;
}

/** The three results, shape-checked. */
export interface EnforceInputs {
  readonly carriers: HandedCarriers;
  readonly tickets: readonly HandedTicket[];
  readonly protect: HandedProtect;
}

/** Where each result was saved; a key left out is reported as missing. */
export interface EnforceInputPaths {
  readonly carriers?: string | undefined;
  readonly tickets?: string | undefined;
  readonly protect?: string | undefined;
}

/** The results, or one line per reason they cannot be used. */
export type EnforceInputsRead =
  | { readonly problems: null; readonly inputs: EnforceInputs }
  | { readonly problems: readonly string[] };
