export const KNOWN_SURVIVOR_BOUNDARY = 10;

/**
 * Classify one generic score around the measurement boundary.
 * @param value - Score to classify
 * @returns The generic high or low classification
 */
export function grade(value: number): "high" | "low" {
  return value > KNOWN_SURVIVOR_BOUNDARY ? "high" : "low";
}
