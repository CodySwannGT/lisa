/**
 * Render a finite number in plain decimal notation for BigInt scaling.
 *
 * @param value Finite number to normalize.
 * @returns A plain decimal string without exponent notation.
 */
function renderPlainDecimal(value: number): string {
  const rendered = String(value);
  if (!rendered.includes("e") && !rendered.includes("E")) {
    return rendered;
  }

  const [mantissa = "0", exponentPart = "0"] = rendered
    .toLowerCase()
    .split("e");
  const exponent = Number(exponentPart);
  const negative = mantissa.startsWith("-");
  const unsigned = negative ? mantissa.slice(1) : mantissa;
  const [whole = "0", fractional = ""] = unsigned.split(".");
  const digits = `${whole}${fractional}`;
  const decimalIndex = whole.length + exponent;
  const plain =
    decimalIndex <= 0
      ? `0.${"0".repeat(Math.abs(decimalIndex))}${digits}`
      : decimalIndex >= digits.length
        ? `${digits}${"0".repeat(decimalIndex - digits.length)}`
        : `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;

  return negative ? `-${plain}` : plain;
}

/**
 * Remove insignificant trailing zeros from a fractional decimal string.
 *
 * @param value Fractional decimal digits.
 * @returns Fractional digits with redundant right-side zeros removed.
 */
function trimTrailingZeros(value: string): string {
  const end = [...value].reduce(
    (lastNonZero, digit, index) => (digit === "0" ? lastNonZero : index + 1),
    0
  );
  return value.slice(0, end);
}

/**
 * Sum nullable decimal amounts using scaled integer math.
 *
 * @param values Decimal values to aggregate.
 * @returns The decimal sum of present values, or null when all are missing.
 */
export function sumNullableDecimals(
  values: readonly (number | null)[]
): number | null {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) {
    return null;
  }

  const decimals = present.map(value => renderPlainDecimal(value));
  const scale = Math.max(
    ...decimals.map(decimal => decimal.split(".")[1]?.length ?? 0)
  );
  const factor = 10n ** BigInt(scale);
  const total = decimals.reduce((sum, decimal) => {
    const negative = decimal.startsWith("-");
    const unsigned = negative ? decimal.slice(1) : decimal;
    const [whole = "0", fractional = ""] = unsigned.split(".");
    const units = BigInt(`${whole}${fractional.padEnd(scale, "0")}` || "0");
    return negative ? sum - units : sum + units;
  }, 0n);
  const negative = total < 0n;
  const absolute = negative ? -total : total;
  const whole = absolute / factor;
  const fractional =
    scale === 0 ? "" : String(absolute % factor).padStart(scale, "0");
  const rendered =
    scale === 0
      ? String(whole)
      : `${whole}.${trimTrailingZeros(fractional) || "0"}`;

  return Number(negative ? `-${rendered}` : rendered);
}
