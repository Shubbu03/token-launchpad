import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { calculateVesting } from "../utils/vesting";
import { badRequest, parseNonEmptyString } from "../utils/requestValidation";

const router = Router({ mergeParams: true });

router.get("/", async (req: Request<{ id: string }>, res: Response) => {
  const { id: launchId } = req.params;
  const { walletAddress } = req.query;

  const parsedWalletAddress = parseNonEmptyString(walletAddress);
  if (parsedWalletAddress === null) {
    badRequest(res, "walletAddress query parameter is required");
    return;
  }

  const launch = await prisma.launch.findUnique({
    where: { id: launchId },
    include: { vesting: true },
  });

  if (!launch) {
    res.status(404).json({ error: "Launch not found" });
    return;
  }

  const purchases = await prisma.purchase.findMany({
    where: { launchId, walletAddress: parsedWalletAddress },
    orderBy: { createdAt: "asc" },
  });

  const totalPurchased = purchases.reduce((sum, p) => sum + p.amount, 0n);
  const firstPurchaseDate = purchases.length > 0 ? purchases[0].createdAt : null;

  const vestingResult = calculateVesting(
    totalPurchased,
    launch.vesting,
    firstPurchaseDate
  );

  res.status(200).json({
    totalPurchased: vestingResult.totalPurchased.toString(),
    tgeAmount: vestingResult.tgeAmount.toString(),
    cliffEndsAt: vestingResult.cliffEndsAt,
    vestedAmount: vestingResult.vestedAmount.toString(),
    lockedAmount: vestingResult.lockedAmount.toString(),
    claimableAmount: vestingResult.claimableAmount.toString(),
  });
});

export default router;
