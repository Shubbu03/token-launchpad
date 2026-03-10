import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { computeStatus, LaunchStatus } from "../utils/status";
import {
  badRequest,
  parseBigIntInput,
  parseDateInput,
  parseIntegerInput,
  parseNonEmptyString,
  parseNumberInput,
  parseOptionalTrimmedString,
} from "../utils/requestValidation";

const router = Router();

function serializeLaunch(launch: any, status: LaunchStatus) {
  return {
    ...launch,
    totalSupply: launch.totalSupply.toString(),
    maxPerWallet: launch.maxPerWallet.toString(),
    tiers: launch.tiers?.map((t: any) => ({
      ...t,
      minAmount: t.minAmount.toString(),
      maxAmount: t.maxAmount.toString(),
    })),
    status,
  };
}

async function getTotalPurchased(launchId: string): Promise<bigint> {
  const result = await prisma.purchase.aggregate({
    where: { launchId },
    _sum: { amount: true },
  });
  return result._sum.amount || 0n;
}

function parsePositiveBigInt(value: unknown): bigint | null {
  const parsed = parseBigIntInput(value);
  if (parsed === null || parsed <= 0n) {
    return null;
  }
  return parsed;
}

function parsePositiveNumber(value: unknown): number | null {
  const parsed = parseNumberInput(value);
  if (parsed === null || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseTierPayload(
  tiers: unknown
): Array<{ minAmount: bigint; maxAmount: bigint; pricePerToken: number }> | null {
  if (!Array.isArray(tiers)) {
    return null;
  }

  const parsedTiers: Array<{
    minAmount: bigint;
    maxAmount: bigint;
    pricePerToken: number;
  }> = [];

  for (const tier of tiers) {
    if (!tier || typeof tier !== "object") {
      return null;
    }

    const tierRecord = tier as {
      minAmount?: unknown;
      maxAmount?: unknown;
      pricePerToken?: unknown;
    };
    const minAmount = parseBigIntInput(tierRecord.minAmount);
    const maxAmount = parseBigIntInput(tierRecord.maxAmount);
    const tierPrice = parsePositiveNumber(tierRecord.pricePerToken);

    if (minAmount === null || maxAmount === null || tierPrice === null) {
      return null;
    }

    if (maxAmount <= minAmount) {
      return null;
    }

    parsedTiers.push({ minAmount, maxAmount, pricePerToken: tierPrice });
  }

  return parsedTiers;
}

function parseVestingPayload(vesting: unknown): {
  cliffDays: number;
  vestingDays: number;
  tgePercent: number;
} | null {
  if (!vesting || typeof vesting !== "object") {
    return null;
  }

  const vestingRecord = vesting as {
    cliffDays?: unknown;
    vestingDays?: unknown;
    tgePercent?: unknown;
  };
  const cliffDays = parseIntegerInput(vestingRecord.cliffDays);
  const vestingDays = parseIntegerInput(vestingRecord.vestingDays);
  const tgePercent = parseIntegerInput(vestingRecord.tgePercent);

  if (cliffDays === null || vestingDays === null || tgePercent === null) {
    return null;
  }

  if (cliffDays < 0 || vestingDays < 0 || tgePercent < 0 || tgePercent > 100) {
    return null;
  }

  return { cliffDays, vestingDays, tgePercent };
}

router.post("/", authMiddleware, async (req: AuthRequest, res: Response) => {
  const {
    name,
    symbol,
    totalSupply,
    pricePerToken,
    startsAt,
    endsAt,
    maxPerWallet,
    description,
    tiers,
    vesting,
  } = req.body;

  if (
    name === undefined ||
    symbol === undefined ||
    totalSupply === undefined ||
    pricePerToken === undefined ||
    startsAt === undefined ||
    endsAt === undefined ||
    maxPerWallet === undefined ||
    description === undefined
  ) {
    badRequest(res, "Missing required fields");
    return;
  }

  const parsedName = parseNonEmptyString(name);
  const parsedSymbol = parseNonEmptyString(symbol);
  const parsedTotalSupply = parsePositiveBigInt(totalSupply);
  const parsedMaxPerWallet = parsePositiveBigInt(maxPerWallet);
  const parsedPricePerToken = parsePositiveNumber(pricePerToken);
  const parsedStartsAt = parseDateInput(startsAt);
  const parsedEndsAt = parseDateInput(endsAt);
  const parsedDescription = parseOptionalTrimmedString(description);

  if (
    parsedName === null ||
    parsedSymbol === null ||
    parsedTotalSupply === null ||
    parsedMaxPerWallet === null ||
    parsedPricePerToken === null ||
    parsedStartsAt === null ||
    parsedEndsAt === null ||
    parsedDescription === null
  ) {
    badRequest(res, "Invalid launch payload");
    return;
  }

  if (parsedStartsAt >= parsedEndsAt) {
    badRequest(res, "startsAt must be before endsAt");
    return;
  }

  const parsedTiers = tiers === undefined ? undefined : parseTierPayload(tiers);
  if (tiers !== undefined && parsedTiers === null) {
    badRequest(res, "Invalid tiers payload");
    return;
  }

  const parsedVesting =
    vesting === undefined ? undefined : parseVestingPayload(vesting);
  if (vesting !== undefined && parsedVesting === null) {
    badRequest(res, "Invalid vesting payload");
    return;
  }

  const launch = await prisma.launch.create({
    data: {
      creatorId: req.user!.id,
      name: parsedName,
      symbol: parsedSymbol,
      totalSupply: parsedTotalSupply,
      pricePerToken: parsedPricePerToken,
      startsAt: parsedStartsAt,
      endsAt: parsedEndsAt,
      maxPerWallet: parsedMaxPerWallet,
      description: parsedDescription ?? "",
      tiers: parsedTiers
        ? {
            create: parsedTiers.map((tier, index) => ({
              minAmount: tier.minAmount,
              maxAmount: tier.maxAmount,
              pricePerToken: tier.pricePerToken,
              order: index,
            })),
          }
        : undefined,
      vesting: parsedVesting
        ? {
            create: {
              cliffDays: parsedVesting.cliffDays,
              vestingDays: parsedVesting.vestingDays,
              tgePercent: parsedVesting.tgePercent,
            },
          }
        : undefined,
    },
    include: {
      tiers: true,
      vesting: true,
    },
  });

  const status = computeStatus(launch, 0n);
  res.status(201).json(serializeLaunch(launch, status));
});

router.get("/", async (req, res) => {
  const parsedPage = parseInt(req.query.page as string, 10);
  const parsedLimit = parseInt(req.query.limit as string, 10);
  const page =
    Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 10;
  const statusFilter = req.query.status as LaunchStatus | undefined;
  const launches = await prisma.launch.findMany({
    include: {
      tiers: true,
      vesting: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const launchIds = launches.map((launch) => launch.id);
  const purchaseSums = await prisma.purchase.groupBy({
    by: ["launchId"],
    where: { launchId: { in: launchIds } },
    _sum: { amount: true },
  });
  const purchasedByLaunchId = new Map(
    purchaseSums.map((sum) => [sum.launchId, sum._sum.amount || 0n])
  );

  const launchesWithStatus = launches.map((launch) => {
    const totalPurchased = purchasedByLaunchId.get(launch.id) || 0n;
    const status = computeStatus(launch, totalPurchased);
    return { launch, status };
  });

  const statusMatchedLaunches = statusFilter
    ? launchesWithStatus.filter((l) => l.status === statusFilter)
    : launchesWithStatus;
  const total = statusMatchedLaunches.length;

  const skip = (page - 1) * limit;
  const paginatedLaunches = statusMatchedLaunches.slice(skip, skip + limit);

  res.status(200).json({
    launches: paginatedLaunches.map((l) => serializeLaunch(l.launch, l.status)),
    total,
    page,
    limit,
  });
});

router.get("/:id", async (req, res) => {
  const launch = await prisma.launch.findUnique({
    where: { id: req.params.id },
    include: {
      tiers: true,
      vesting: true,
    },
  });

  if (!launch) {
    res.status(404).json({ error: "Launch not found" });
    return;
  }

  const totalPurchased = await getTotalPurchased(launch.id);
  const status = computeStatus(launch, totalPurchased);

  res.status(200).json(serializeLaunch(launch, status));
});

router.put("/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  const launch = await prisma.launch.findUnique({
    where: { id: req.params.id },
  });

  if (!launch) {
    res.status(404).json({ error: "Launch not found" });
    return;
  }

  if (launch.creatorId !== req.user!.id) {
    res.status(403).json({ error: "Not authorized to update this launch" });
    return;
  }

  const {
    name,
    symbol,
    totalSupply,
    pricePerToken,
    startsAt,
    endsAt,
    maxPerWallet,
    description,
  } = req.body;

  const parsedName =
    name === undefined ? undefined : parseNonEmptyString(name);
  if (name !== undefined && parsedName === null) {
    badRequest(res, "Invalid launch payload");
    return;
  }

  const parsedSymbol =
    symbol === undefined ? undefined : parseNonEmptyString(symbol);
  if (symbol !== undefined && parsedSymbol === null) {
    badRequest(res, "Invalid launch payload");
    return;
  }

  const parsedTotalSupply =
    totalSupply === undefined ? undefined : parsePositiveBigInt(totalSupply);
  if (totalSupply !== undefined && parsedTotalSupply === null) {
    badRequest(res, "Invalid launch payload");
    return;
  }

  const parsedPricePerToken =
    pricePerToken === undefined ? undefined : parsePositiveNumber(pricePerToken);
  if (pricePerToken !== undefined && parsedPricePerToken === null) {
    badRequest(res, "Invalid launch payload");
    return;
  }

  const parsedStartsAt =
    startsAt === undefined ? undefined : parseDateInput(startsAt);
  if (startsAt !== undefined && parsedStartsAt === null) {
    badRequest(res, "Invalid launch payload");
    return;
  }

  const parsedEndsAt = endsAt === undefined ? undefined : parseDateInput(endsAt);
  if (endsAt !== undefined && parsedEndsAt === null) {
    badRequest(res, "Invalid launch payload");
    return;
  }

  const parsedMaxPerWallet =
    maxPerWallet === undefined ? undefined : parsePositiveBigInt(maxPerWallet);
  if (maxPerWallet !== undefined && parsedMaxPerWallet === null) {
    badRequest(res, "Invalid launch payload");
    return;
  }

  const parsedDescription =
    description === undefined ? undefined : parseOptionalTrimmedString(description);
  if (description !== undefined && parsedDescription === null) {
    badRequest(res, "Invalid launch payload");
    return;
  }

  const nextStartsAt = parsedStartsAt || launch.startsAt;
  const nextEndsAt = parsedEndsAt || launch.endsAt;
  if (nextStartsAt >= nextEndsAt) {
    badRequest(res, "startsAt must be before endsAt");
    return;
  }

  const updatedLaunch = await prisma.launch.update({
    where: { id: req.params.id },
    data: {
      ...(parsedName !== undefined && { name: parsedName! }),
      ...(parsedSymbol !== undefined && { symbol: parsedSymbol! }),
      ...(parsedTotalSupply !== undefined && { totalSupply: parsedTotalSupply! }),
      ...(parsedPricePerToken !== undefined && {
        pricePerToken: parsedPricePerToken!,
      }),
      ...(parsedStartsAt !== undefined && { startsAt: parsedStartsAt! }),
      ...(parsedEndsAt !== undefined && { endsAt: parsedEndsAt! }),
      ...(parsedMaxPerWallet !== undefined && {
        maxPerWallet: parsedMaxPerWallet!,
      }),
      ...(parsedDescription !== undefined && { description: parsedDescription! }),
    },
    include: {
      tiers: true,
      vesting: true,
    },
  });

  const totalPurchased = await getTotalPurchased(updatedLaunch.id);
  const status = computeStatus(updatedLaunch, totalPurchased);

  res.status(200).json(serializeLaunch(updatedLaunch, status));
});

export default router;
