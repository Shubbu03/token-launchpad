import { Router, Response } from "express";
import { Prisma, Purchase } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { computeStatus } from "../utils/status";
import { calculateTieredPrice } from "../utils/pricing";
import {
  badRequest,
  parseBigIntInput,
  parseNonEmptyString,
} from "../utils/requestValidation";

const router = Router({ mergeParams: true });

class PurchaseRequestError extends Error {}

async function getTotalPurchased(launchId: string): Promise<bigint> {
  const result = await prisma.purchase.aggregate({
    where: { launchId },
    _sum: { amount: true },
  });
  return result._sum.amount || 0n;
}

async function getUserTotalPurchased(
  launchId: string,
  userId: string
): Promise<bigint> {
  const result = await prisma.purchase.aggregate({
    where: { launchId, userId },
    _sum: { amount: true },
  });
  return result._sum.amount || 0n;
}

router.post("/", authMiddleware, async (req: AuthRequest, res: Response) => {
  const { id: launchId } = req.params;
  const { walletAddress, amount, txSignature, referralCode } = req.body;

  if (walletAddress === undefined || amount === undefined || txSignature === undefined) {
    badRequest(res, "Missing required fields: walletAddress, amount, txSignature");
    return;
  }

  const parsedWalletAddress = parseNonEmptyString(walletAddress);
  const parsedTxSignature = parseNonEmptyString(txSignature);
  const purchaseAmount = parseBigIntInput(amount);
  const parsedReferralCode =
    referralCode === undefined ? undefined : parseNonEmptyString(referralCode);

  if (
    parsedWalletAddress === null ||
    parsedTxSignature === null ||
    purchaseAmount === null ||
    purchaseAmount <= 0n ||
    (referralCode !== undefined && parsedReferralCode === null)
  ) {
    badRequest(res, "Invalid purchase payload");
    return;
  }

  const launch = await prisma.launch.findUnique({
    where: { id: launchId },
    include: { tiers: true },
  });

  if (!launch) {
    res.status(404).json({ error: "Launch not found" });
    return;
  }

  const totalPurchased = await getTotalPurchased(launchId);
  const status = computeStatus(launch, totalPurchased);

  if (status !== "ACTIVE") {
    res.status(400).json({ error: `Launch is ${status}, cannot purchase` });
    return;
  }

  const whitelistCount = await prisma.whitelistEntry.count({
    where: { launchId },
  });

  if (whitelistCount > 0) {
    const isWhitelisted = await prisma.whitelistEntry.findUnique({
      where: { launchId_address: { launchId, address: parsedWalletAddress } },
    });

    if (!isWhitelisted) {
      res.status(400).json({ error: "Wallet not whitelisted" });
      return;
    }
  }

  const userTotalPurchased = await getUserTotalPurchased(
    launchId,
    req.user!.id
  );
  if (userTotalPurchased + purchaseAmount > launch.maxPerWallet) {
    res.status(400).json({
      error: `Purchase exceeds max per wallet limit. Current: ${userTotalPurchased}, Requested: ${purchaseAmount}, Max: ${launch.maxPerWallet}`,
    });
    return;
  }

  if (totalPurchased + purchaseAmount > launch.totalSupply) {
    res.status(400).json({
      error: `Purchase exceeds available supply. Available: ${launch.totalSupply - totalPurchased}, Requested: ${purchaseAmount}`,
    });
    return;
  }

  const existingTx = await prisma.purchase.findUnique({
    where: { txSignature: parsedTxSignature },
  });

  if (existingTx) {
    res.status(400).json({ error: "Transaction signature already used" });
    return;
  }

  const totalCost = calculateTieredPrice(
    purchaseAmount,
    launch.tiers,
    launch.pricePerToken
  );

  let purchase: Purchase;
  try {
    purchase = await prisma.$transaction(async (tx) => {
      let referralCodeId: string | null = null;
      let finalTotalCost = totalCost;

      if (parsedReferralCode) {
        const referralCodeRecord = await tx.referralCode.findUnique({
          where: { launchId_code: { launchId, code: parsedReferralCode } },
        });

        if (!referralCodeRecord) {
          throw new PurchaseRequestError("Invalid referral code");
        }

        if (referralCodeRecord.usedCount >= referralCodeRecord.maxUses) {
          throw new PurchaseRequestError("Referral code has reached max uses");
        }

        const discount = finalTotalCost * (referralCodeRecord.discountPercent / 100);
        finalTotalCost -= discount;

        const referralUpdate = await tx.referralCode.updateMany({
          where: {
            id: referralCodeRecord.id,
            usedCount: { lt: referralCodeRecord.maxUses },
          },
          data: { usedCount: { increment: 1 } },
        });

        if (referralUpdate.count === 0) {
          throw new PurchaseRequestError("Referral code has reached max uses");
        }

        referralCodeId = referralCodeRecord.id;
      }

      return tx.purchase.create({
        data: {
          launchId,
          userId: req.user!.id,
          walletAddress: parsedWalletAddress,
          amount: purchaseAmount,
          totalCost: finalTotalCost,
          txSignature: parsedTxSignature,
          referralCodeId,
        },
      });
    });
  } catch (error) {
    if (error instanceof PurchaseRequestError) {
      badRequest(res, error.message);
      return;
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      badRequest(res, "Transaction signature already used");
      return;
    }

    res.status(500).json({ error: "Internal server error" });
    return;
  }

  res.status(201).json({
    id: purchase.id,
    launchId: purchase.launchId,
    userId: purchase.userId,
    walletAddress: purchase.walletAddress,
    amount: purchase.amount.toString(),
    totalCost: purchase.totalCost,
    txSignature: purchase.txSignature,
    referralCodeId: purchase.referralCodeId,
    createdAt: purchase.createdAt,
  });
});

router.get("/", authMiddleware, async (req: AuthRequest, res: Response) => {
  const { id: launchId } = req.params;

  const launch = await prisma.launch.findUnique({
    where: { id: launchId },
  });

  if (!launch) {
    res.status(404).json({ error: "Launch not found" });
    return;
  }

  const isCreator = launch.creatorId === req.user!.id;

  const purchases = await prisma.purchase.findMany({
    where: isCreator ? { launchId } : { launchId, userId: req.user!.id },
    orderBy: { createdAt: "desc" },
  });

  res.status(200).json({
    purchases: purchases.map((p) => ({
      id: p.id,
      userId: p.userId,
      walletAddress: p.walletAddress,
      amount: p.amount.toString(),
      totalCost: p.totalCost,
      txSignature: p.txSignature,
      referralCodeId: p.referralCodeId,
      createdAt: p.createdAt,
    })),
    total: purchases.length,
  });
});

export default router;
