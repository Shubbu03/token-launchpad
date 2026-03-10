import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { badRequest, parseNonEmptyString } from "../utils/requestValidation";

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
  const { addresses } = req.body;

  if (!addresses || !Array.isArray(addresses)) {
    badRequest(res, "addresses array is required");
    return;
  }

  const parsedAddresses = addresses.map((address) => parseNonEmptyString(address));
  if (parsedAddresses.some((address) => address === null)) {
    badRequest(res, "addresses must be a string array with non-empty values");
    return;
  }
  const normalizedAddresses = Array.from(
    new Set(parsedAddresses as string[])
  );

  const { launch, isCreator } = await verifyCreator(launchId, req.user!.id);

  if (!launch) {
    res.status(404).json({ error: "Launch not found" });
    return;
  }

  if (!isCreator) {
    res.status(403).json({ error: "Only creator can manage whitelist" });
    return;
  }

  const createResult = await prisma.whitelistEntry.createMany({
    data: normalizedAddresses.map((address) => ({ launchId, address })),
    skipDuplicates: true,
  });

  const total = await prisma.whitelistEntry.count({ where: { launchId } });

  res.status(200).json({ added: createResult.count, total });
});

router.get("/", authMiddleware, async (req: AuthRequest, res: Response) => {
  const { id: launchId } = req.params;

  const { launch, isCreator } = await verifyCreator(launchId, req.user!.id);

  if (!launch) {
    res.status(404).json({ error: "Launch not found" });
    return;
  }

  if (!isCreator) {
    res.status(403).json({ error: "Only creator can view whitelist" });
    return;
  }

  const entries = await prisma.whitelistEntry.findMany({
    where: { launchId },
    select: { address: true },
  });

  res.status(200).json({
    addresses: entries.map((e) => e.address),
    total: entries.length,
  });
});

router.delete(
  "/:address",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    const { id: launchId, address } = req.params;

    const { launch, isCreator } = await verifyCreator(launchId, req.user!.id);

    if (!launch) {
      res.status(404).json({ error: "Launch not found" });
      return;
    }

    if (!isCreator) {
      res.status(403).json({ error: "Only creator can manage whitelist" });
      return;
    }

    const entry = await prisma.whitelistEntry.findUnique({
      where: { launchId_address: { launchId, address } },
    });

    if (!entry) {
      res.status(404).json({ error: "Address not found in whitelist" });
      return;
    }

    await prisma.whitelistEntry.delete({
      where: { launchId_address: { launchId, address } },
    });

    res.status(200).json({ removed: true });
  }
);

export default router;
