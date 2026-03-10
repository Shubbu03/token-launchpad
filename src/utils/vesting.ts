interface VestingConfig {
  cliffDays: number;
  vestingDays: number;
  tgePercent: number;
}

interface VestingResult {
  totalPurchased: bigint;
  tgeAmount: bigint;
  cliffEndsAt: Date | null;
  vestedAmount: bigint;
  lockedAmount: bigint;
  claimableAmount: bigint;
}

export function calculateVesting(
  totalPurchased: bigint,
  vestingConfig: VestingConfig | null,
  firstPurchaseDate: Date | null
): VestingResult {
  if (!vestingConfig || !firstPurchaseDate) {
    return {
      totalPurchased,
      tgeAmount: totalPurchased,
      cliffEndsAt: null,
      vestedAmount: 0n,
      lockedAmount: 0n,
      claimableAmount: totalPurchased,
    };
  }

  const { cliffDays, vestingDays, tgePercent } = vestingConfig;

  const tgeAmount = (totalPurchased * BigInt(tgePercent)) / 100n;
  const vestingAmount = totalPurchased - tgeAmount;

  const cliffEndsAt = new Date(firstPurchaseDate);
  cliffEndsAt.setDate(cliffEndsAt.getDate() + cliffDays);

  const now = new Date();

  if (now < cliffEndsAt) {
    return {
      totalPurchased,
      tgeAmount,
      cliffEndsAt,
      vestedAmount: 0n,
      lockedAmount: vestingAmount,
      claimableAmount: tgeAmount,
    };
  }

  const daysSinceCliff = Math.floor(
    (now.getTime() - cliffEndsAt.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysSinceCliff >= vestingDays) {
    return {
      totalPurchased,
      tgeAmount,
      cliffEndsAt,
      vestedAmount: vestingAmount,
      lockedAmount: 0n,
      claimableAmount: totalPurchased,
    };
  }

  const vestedAmount =
    (vestingAmount * BigInt(daysSinceCliff)) / BigInt(vestingDays);
  const lockedAmount = vestingAmount - vestedAmount;
  const claimableAmount = tgeAmount + vestedAmount;

  return {
    totalPurchased,
    tgeAmount,
    cliffEndsAt,
    vestedAmount,
    lockedAmount,
    claimableAmount,
  };
}
