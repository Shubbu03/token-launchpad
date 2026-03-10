import { prisma } from "../lib/prisma";

beforeEach(async () => {
  await prisma.purchase.deleteMany();
  await prisma.referralCode.deleteMany();
  await prisma.whitelistEntry.deleteMany();
  await prisma.tier.deleteMany();
  await prisma.vestingConfig.deleteMany();
  await prisma.launch.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});
