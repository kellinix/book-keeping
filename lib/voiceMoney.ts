export type MoneyMention = { amount: number; currency: "GBP" | "USD"; index: number; end: number };

/** Extract only explicitly currency-labelled amounts; incidental numbers are ignored. */
export function extractExplicitMoneyMentions(text: string): MoneyMention[] {
  const mentions: MoneyMention[] = [];
  const patterns: Array<{ regex: RegExp; amountGroup: number; currency: (match: RegExpExecArray) => "GBP" | "USD" }> = [
    { regex: /([£$])\s*(\d+(?:[.,]\d{1,2})?)/g, amountGroup: 2, currency: (match) => match[1] === "$" ? "USD" : "GBP" },
    { regex: /\b(GBP|USD)\s*(\d+(?:[.,]\d{1,2})?)\b/gi, amountGroup: 2, currency: (match) => match[1].toUpperCase() === "USD" ? "USD" : "GBP" },
    { regex: /\b(\d+(?:[.,]\d{1,2})?)\s*(pounds?|dollars?|GBP|USD)\b/gi, amountGroup: 1, currency: (match) => /dollar|usd/i.test(match[2]) ? "USD" : "GBP" }
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(text)) !== null) {
      const amount = Number(match[pattern.amountGroup].replace(",", "."));
      if (!Number.isFinite(amount) || amount <= 0) continue;
      mentions.push({ amount, currency: pattern.currency(match), index: match.index, end: match.index + match[0].length });
    }
  }
  return mentions
    .sort((a, b) => a.index - b.index || b.end - a.end)
    .filter((mention, index, all) => !all.slice(0, index).some((other) => mention.index < other.end && mention.end > other.index));
}

export function amountAppearsExplicitly(mentions: MoneyMention[], amount: number) {
  return mentions.some((mention) => Math.abs(mention.amount - amount) < 0.005);
}
