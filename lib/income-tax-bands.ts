// UK Income Tax bands for 2025/26 and 2026/27 (identical thresholds currently frozen).
// Update these constants when HMRC announces changes — do NOT inline them elsewhere.
export const IT_BANDS = {
  personalAllowance: 12_570,
  basicRateLimit: 50_270,   // top of 20% band
  higherRateLimit: 125_140, // top of 40% band
  basicRate: 0.20,
  higherRate: 0.40,
  additionalRate: 0.45,
} as const;

/**
 * Band-aware income tax estimate for sole traders / landlords (ITSA scope).
 * Input is taxable profit (income minus allowable expenses).
 * Excludes Class 2/4 National Insurance — show the UI caveat alongside this figure.
 */
export function estimateIncomeTax(taxableProfit: number): number {
  if (taxableProfit <= 0) return 0;
  const { personalAllowance, basicRateLimit, higherRateLimit, basicRate, higherRate, additionalRate } = IT_BANDS;

  const inBasic = Math.max(0, Math.min(taxableProfit, basicRateLimit) - personalAllowance);
  const inHigher = Math.max(0, Math.min(taxableProfit, higherRateLimit) - basicRateLimit);
  const inAdditional = Math.max(0, taxableProfit - higherRateLimit);

  return inBasic * basicRate + inHigher * higherRate + inAdditional * additionalRate;
}
