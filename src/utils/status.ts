export type LaunchStatus = "SOLD_OUT" | "UPCOMING" | "ENDED" | "ACTIVE";

export function computeStatus(
  launch: { totalSupply: bigint; startsAt: Date; endsAt: Date },
  totalPurchased: bigint
): LaunchStatus {
  if (totalPurchased >= launch.totalSupply) {
    return "SOLD_OUT";
  }

  const now = new Date();

  if (now < launch.startsAt) {
    return "UPCOMING";
  }

  if (now > launch.endsAt) {
    return "ENDED";
  }

  return "ACTIVE";
}
