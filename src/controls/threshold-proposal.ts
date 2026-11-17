/**
 * Proposing a threshold from what a repository measures today.
 *
 * On a stack Lisa ships no checks for, a number such as a minimum coverage
 * percentage is the host's to declare. The configure step measures the
 * current value by running the host's own tool, proposes exactly that value
 * as the starting point, and writes what the operator confirms. Lisa has
 * thresholds of its own for the project types it supports, and none of them
 * may leak into a repository that never chose them.
 *
 * So the proposal is built here, by code, from two things only: the measured
 * value and the direction. There is no default in this module to fall back
 * on, and the value proposed is the value measured: not rounded, not raised
 * to a target. A measurement that cannot be read as a number is refused
 * rather than replaced.
 * @module controls/threshold-proposal
 */
import {
  PARAMETER_DIRECTIONS,
  type ControlParameter,
  type ParameterDirection,
} from "./register-types.js";

/** The direction proposed when none is named: a lowest allowed value. */
export const DEFAULT_THRESHOLD_DIRECTION: ParameterDirection = "floor";

/** A threshold as a part of a gate declares it. */
export interface ThresholdParameter extends ControlParameter {
  readonly value: number;
  readonly direction: ParameterDirection;
}

/** What is proposed to the operator for one threshold. */
export interface ThresholdProposal {
  /** The parameter's name on the part, for example `minimum-coverage`. */
  readonly name: string;
  /** The value the host's own tool reported. */
  readonly measured: number;
  /**
   * What to merge into the part's `parameters` once the operator says yes.
   * When they name another number, that number replaces `value`.
   */
  readonly parameters: Readonly<Record<string, ThresholdParameter>>;
  /** The one decision put to the operator, with the measured value in it. */
  readonly question: string;
  /** What saying yes means, in plain words. */
  readonly yes_means: string;
}

/**
 * Read a measured value as a number.
 *
 * Accepts what a tool prints for one number: `41`, `41.5`, `-3`, and any of
 * them followed by a percent sign. Anything else, including an empty string,
 * a range and a word, is not a measurement.
 * @param text - The value as the tool printed it
 * @returns The number, or `null` when the text is not one number
 */
export function parseMeasuredValue(text: string): number | null {
  const match = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*%?$/u.exec(text.trim());
  if (match === null) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * Tell whether a word is one of the two directions a threshold can have.
 * @param value - The candidate
 * @returns Whether it is `floor` or `ceiling`
 */
export function isThresholdDirection(
  value: unknown
): value is ParameterDirection {
  return (PARAMETER_DIRECTIONS as readonly unknown[]).includes(value);
}

/**
 * Propose a threshold at exactly the value measured today.
 * @param input - What was measured
 * @param input.name - The parameter's name on the part
 * @param input.measured - The value the host's own tool reported
 * @param input.direction - `floor` for a lowest allowed value, `ceiling` for
 *   a highest
 * @returns The proposal: the parameter to write, and the decision in words
 */
export function proposeThreshold(input: {
  readonly name: string;
  readonly measured: number;
  readonly direction: ParameterDirection;
}): ThresholdProposal {
  const { name, measured, direction } = input;
  const floor = direction === "floor";
  return {
    name,
    measured,
    parameters: { [name]: { value: measured, direction } },
    question: floor
      ? `It measures ${measured} today. Shall ${measured} be the lowest it may go from now on?`
      : `It measures ${measured} today. Shall ${measured} be the highest it may go from now on?`,
    yes_means: floor
      ? `A change that takes it below ${measured} is refused. The number may be raised later and may not be lowered.`
      : `A change that takes it above ${measured} is refused. The number may be lowered later and may not be raised.`,
  };
}
