interface Tier {
  minAmount: bigint;
  maxAmount: bigint;
  pricePerToken: number;
  order: number;
}

export function calculateTieredPrice(
  amount: bigint,
  tiers: Tier[],
  flatPricePerToken: number,
  alreadySold: bigint = 0n
): number {
  if (tiers.length === 0) {
    return Number(amount) * flatPricePerToken;
  }

  const sortedTiers = [...tiers].sort((a, b) => a.order - b.order);
  let remaining = amount;
  let soldPosition = alreadySold;
  let totalCost = 0;

  for (const tier of sortedTiers) {
    if (remaining <= 0n) {
      break;
    }

    if (soldPosition >= tier.maxAmount) {
      continue;
    }

    const tierStart = soldPosition > tier.minAmount ? soldPosition : tier.minAmount;
    const tierCapacity = tier.maxAmount - tierStart;

    if (tierCapacity <= 0n) {
      continue;
    }

    const tokensInTier = remaining > tierCapacity ? tierCapacity : remaining;
    totalCost += Number(tokensInTier) * tier.pricePerToken;
    remaining -= tokensInTier;
    soldPosition += tokensInTier;
  }

  if (remaining > 0n) {
    totalCost += Number(remaining) * flatPricePerToken;
  }

  return totalCost;
}
