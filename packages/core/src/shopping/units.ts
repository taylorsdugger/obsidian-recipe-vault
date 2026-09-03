/** Convert an amount+unit to a base value for a unit family, enabling cross-unit addition. */
export function toBaseAmount(
  amount: number,
  unit: string,
): { base: number; family: string } | null {
  const volToTsp: Record<string, number> = {
    tsp: 1,
    tbsp: 3,
    cup: 48,
    ml: 0.2029,
    l: 202.9,
  };
  if (unit in volToTsp)
    return { base: amount * volToTsp[unit], family: "volume" };

  const weightToG: Record<string, number> = {
    g: 1,
    kg: 1000,
    oz: 28.35,
    lb: 453.6,
  };
  if (unit in weightToG)
    return { base: amount * weightToG[unit], family: "weight" };

  return null;
}

/** Convert a base amount back to the most readable unit in its family. */
export function fromBaseAmount(
  base: number,
  family: string,
): { amount: number; unit: string } {
  if (family === "volume") {
    if (base >= 48) return { amount: base / 48, unit: "cup" };
    if (base >= 3) return { amount: base / 3, unit: "tbsp" };
    return { amount: base, unit: "tsp" };
  }
  if (family === "weight") {
    if (base >= 1000) return { amount: base / 1000, unit: "kg" };
    if (base >= 453.6) return { amount: base / 453.6, unit: "lb" };
    if (base >= 28.35) return { amount: base / 28.35, unit: "oz" };
    return { amount: base, unit: "g" };
  }
  return { amount: base, unit: "" };
}

/** Format a numeric amount as a readable string with unicode fractions. */
export function formatIngredientAmount(amount: number, unit: string): string {
  if (amount === 0) return unit || "";
  const whole = Math.floor(amount);
  const frac = amount - whole;
  const knownFracs: [number, string][] = [
    [1 / 8, "⅛"],
    [1 / 4, "¼"],
    [1 / 3, "⅓"],
    [3 / 8, "⅜"],
    [1 / 2, "½"],
    [5 / 8, "⅝"],
    [2 / 3, "⅔"],
    [3 / 4, "¾"],
    [7 / 8, "⅞"],
  ];
  let fracStr = "";
  let closestDiff = Infinity;
  for (const [val, sym] of knownFracs) {
    const diff = Math.abs(frac - val);
    if (diff < closestDiff) {
      closestDiff = diff;
      fracStr = sym;
    }
  }
  if (closestDiff > 0.09) fracStr = ""; // not close enough to a known fraction
  const numStr =
    whole > 0 && fracStr
      ? `${whole}${fracStr}`
      : whole > 0
        ? `${whole}`
        : fracStr || `${Math.round(amount * 100) / 100}`;
  return unit ? `${numStr} ${unit}` : numStr;
}
