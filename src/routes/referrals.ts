import { Router, Response } from "express";
import { Prisma, ReferralCode } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import {
  badRequest,
  parseIntegerInput,
  parseNonEmptyString,
  parseNumberInput,
} from "../utils/requestValidation";

const router = Router({ mergeParams: true });

async function verifyCreator(
  launchId: string,
  userId: string
): Promise<{ launch: any | null; isCreator: boolean }> {
  const launch = await prisma.launch.findUnique({ where: { id: launchId } });
  if (!launch) return { launch: null, isCreator: false };
  return { launch, isCreator: launch.creatorId === userId };
}

router.post("/", authMiddleware, async (req: AuthRequest, res: Response) => {
  const { id: launchId } = req.params;
  const { code, discountPercent, maxUses } = req.body;

  if (code === undefined || discountPercent === undefined || maxUses === undefined) {
    badRequest(res, "Missing required fields: code, discountPercent, maxUses");
    return;
  }

  const parsedCode = parseNonEmptyString(code);
  const parsedDiscountPercent = parseNumberInput(discountPercent);
  const parsedMaxUses = parseIntegerInput(maxUses);

  if (
    parsedCode === null ||
    parsedDiscountPercent === null ||
    parsedMaxUses === null
  ) {
    badRequest(res, "Invalid referral payload");
    return;
  }

  if (parsedDiscountPercent < 0 || parsedDiscountPercent > 100 || parsedMaxUses <= 0) {
    badRequest(res, "Invalid referral payload");
    return;
  }

  const { launch, isCreator } = await verifyCreator(launchId, req.user!.id);

  if (!launch) {
    res.status(404).json({ error: "Launch not found" });
    return;
  }

  if (!isCreator) {
    res.status(403).json({ error: "Only creator can manage referral codes" });
    return;
  }

  const existingCode = await prisma.referralCode.findUnique({
    where: { launchId_code: { launchId, code: parsedCode } },
  });

  if (existingCode) {
    res.status(409).json({ error: "Referral code already exists for this launch" });
    return;
  }

  let referralCode: ReferralCode;
  try {
    referralCode = await prisma.referralCode.create({
      data: {
        launchId,
        code: parsedCode,
        discountPercent: parsedDiscountPercent,
        maxUses: parsedMaxUses,
        usedCount: 0,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      res.status(409).json({ error: "Referral code already exists for this launch" });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  res.status(201).json({
    id: referralCode.id,
    code: referralCode.code,
    discountPercent: referralCode.discountPercent,
    maxUses: referralCode.maxUses,
    usedCount: referralCode.usedCount,
  });
});

router.get("/", authMiddleware, async (req: AuthRequest, res: Response) => {
  const { id: launchId } = req.params;

  const { launch, isCreator } = await verifyCreator(launchId, req.user!.id);

  if (!launch) {
    res.status(404).json({ error: "Launch not found" });
    return;
  }

  if (!isCreator) {
    res.status(403).json({ error: "Only creator can view referral codes" });
    return;
  }

  const codes = await prisma.referralCode.findMany({
    where: { launchId },
  });

  res.status(200).json(
    codes.map((c) => ({
      id: c.id,
      code: c.code,
      discountPercent: c.discountPercent,
      maxUses: c.maxUses,
      usedCount: c.usedCount,
    }))
  );
});

export default router;
