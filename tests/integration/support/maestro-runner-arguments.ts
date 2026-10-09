/** Decode the caller runner's argc-framed NUL trace without losing argument boundaries. */
/**
 * Read actual argument lists recorded by the fixture shell before shifting.
 * @param trace - Count and argument fields, each terminated with a NUL byte.
 * @returns One exact argument array for each runner invocation.
 */
export function runnerCalls(trace: string): string[][] {
  const fields = trace.split("\0");
  if (fields.pop() !== "")
    throw new Error("Unterminated runner argument trace");
  const calls: string[][] = [];
  while (fields.length > 0) {
    const countField = fields.shift() ?? "";
    const count = Number(countField);
    if (
      !/^\d+$/.test(countField) ||
      !Number.isSafeInteger(count) ||
      fields.length < count
    ) {
      throw new Error("Invalid runner argument count");
    }
    calls.push(fields.splice(0, count));
  }
  return calls;
}
