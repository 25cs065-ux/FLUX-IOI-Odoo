const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?$/;

export function decimalToMinorUnits(value: string | number): bigint {
  const match = DECIMAL_PATTERN.exec(String(value).trim());
  if (!match) {
    throw new Error(`Invalid monetary amount: ${String(value)}`);
  }

  const [, sign, whole, fraction = ""] = match;
  const paddedFraction = fraction.padEnd(3, "0");
  let minorUnits = BigInt(whole) * 100n + BigInt(paddedFraction.slice(0, 2));
  if (paddedFraction[2] >= "5") minorUnits += 1n;
  return sign === "-" ? -minorUnits : minorUnits;
}

export function multiplyMinorUnits(
  amount: bigint,
  numerator: bigint,
  denominator: bigint
): bigint {
  if (denominator <= 0n) throw new Error("The divisor must be positive.");
  const product = amount * numerator;
  const quotient = product / denominator;
  const remainder = product % denominator;
  return quotient + (remainder * 2n >= denominator ? 1n : 0n);
}

export function formatMinorUnits(
  minorUnits: bigint,
  currency = "INR",
  locale = "en-IN"
): string {
  const negative = minorUnits < 0n;
  const absolute = negative ? -minorUnits : minorUnits;
  const majorUnits = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(2, "0");
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const parts = formatter.formatToParts(negative ? -majorUnits : majorUnits);
  return parts
    .map((part) => (part.type === "fraction" ? fraction : part.value))
    .join("");
}
