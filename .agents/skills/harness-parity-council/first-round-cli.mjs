/**
 * Command-line argument parsing for the first-round council entrypoint.
 */

/**
 * Parse the documented council CLI flags into a normalized argument object.
 * @param {string[]} argv CLI args excluding `node` and script path.
 * @returns {{
 *   topic: string;
 *   runtime: string | null;
 *   secondRound: boolean;
 *   dryRun: boolean;
 *   writeMode: string | null;
 *   sanitizedSummary: string | null;
 * }} Parsed council args.
 */
export function parseCouncilCliArgs(argv) {
  const readFlagValue = (flag, values, index, description) => {
    const value = values[index + 1] ?? "";
    if (!value.trim() || value.trim().startsWith("--")) {
      throw new Error(`The ${flag} flag requires ${description}.`);
    }
    return value;
  };

  const parsed = argv.reduce(
    (state, current, index, values) => {
      if (state.skipIndices.has(index)) {
        return state;
      }

      if (current === "--runtime") {
        const nextValue = readFlagValue(
          "--runtime",
          values,
          index,
          "a runtime name"
        );
        state.skipIndices.add(index + 1);
        return { ...state, runtime: nextValue };
      }

      if (current === "--write-mode") {
        const nextValue = readFlagValue(
          "--write-mode",
          values,
          index,
          "a mode value"
        );
        state.skipIndices.add(index + 1);
        return { ...state, writeMode: nextValue };
      }

      if (current === "--summary") {
        const nextValue = readFlagValue(
          "--summary",
          values,
          index,
          "sanitized summary text"
        );
        state.skipIndices.add(index + 1);
        return { ...state, sanitizedSummary: nextValue };
      }

      if (current === "--second-round") {
        return { ...state, secondRound: true };
      }

      if (current === "--dry-run") {
        return { ...state, dryRun: true };
      }

      return {
        ...state,
        topicParts: [...state.topicParts, current],
      };
    },
    {
      topicParts: [],
      runtime: null,
      writeMode: null,
      sanitizedSummary: null,
      secondRound: false,
      dryRun: false,
      skipIndices: new Set(),
    }
  );

  const topic = parsed.topicParts.join(" ").trim();
  if (!topic) {
    throw new Error(
      "Usage: node first-round.mjs <topic> [--runtime <name>] [--second-round] [--dry-run] [--write-mode <mode>] [--summary <text>]"
    );
  }

  return {
    topic,
    runtime: parsed.runtime?.trim().toLowerCase() ?? null,
    secondRound: parsed.secondRound,
    dryRun: parsed.dryRun,
    writeMode: parsed.writeMode?.trim() ?? null,
    sanitizedSummary: parsed.sanitizedSummary?.trim() ?? null,
  };
}
