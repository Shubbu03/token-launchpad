import request from "supertest";
import app from "../app";
import { prisma } from "../lib/prisma";

describe("API Integration Tests", () => {
  describe("Health Check", () => {
    it("GET /api/health returns status ok", async () => {
      const res = await request(app).get("/api/health");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "ok" });
    });
  });

  describe("Authentication", () => {
    const testUser = {
      email: "test@example.com",
      password: "password123",
      name: "Test User",
    };

    it("POST /api/auth/register creates user and returns token", async () => {
      const res = await request(app).post("/api/auth/register").send(testUser);

      expect(res.status).toBe(201);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe(testUser.email);
      expect(res.body.user.name).toBe(testUser.name);
      expect(res.body.user.id).toBeDefined();
    });

    it("POST /api/auth/register returns 400 for missing fields", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ email: "test@example.com" });

      expect(res.status).toBe(400);
    });

    it("POST /api/auth/register returns 409 for duplicate email", async () => {
      await request(app).post("/api/auth/register").send(testUser);

      const res = await request(app).post("/api/auth/register").send(testUser);

      expect(res.status).toBe(409);
    });

    it("POST /api/auth/login returns token for valid credentials", async () => {
      await request(app).post("/api/auth/register").send(testUser);

      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: testUser.email, password: testUser.password });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe(testUser.email);
    });

    it("POST /api/auth/login returns 401 for invalid credentials", async () => {
      await request(app).post("/api/auth/register").send(testUser);

      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: testUser.email, password: "wrongpassword" });

      expect(res.status).toBe(401);
    });

    it("POST /api/auth/login returns 401 for non-existent user", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "nobody@example.com", password: "password" });

      expect(res.status).toBe(401);
    });
  });

  describe("Token Launches", () => {
    let authToken: string;
    let userId: string;

    beforeEach(async () => {
      const res = await request(app).post("/api/auth/register").send({
        email: "creator@example.com",
        password: "password123",
        name: "Creator",
      });
      authToken = res.body.token;
      userId = res.body.user.id;
    });

    const baseLaunch = {
      name: "Test Token",
      symbol: "TEST",
      totalSupply: "1000000",
      pricePerToken: 0.1,
      startsAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
      endsAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      maxPerWallet: "10000",
      description: "Test token launch",
    };

    it("POST /api/launches creates launch without auth returns 401", async () => {
      const res = await request(app).post("/api/launches").send(baseLaunch);

      expect(res.status).toBe(401);
    });

    it("POST /api/launches creates launch with auth", async () => {
      const res = await request(app)
        .post("/api/launches")
        .set("Authorization", `Bearer ${authToken}`)
        .send(baseLaunch);

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe(baseLaunch.name);
      expect(res.body.status).toBe("ACTIVE");
      expect(res.body.creatorId).toBe(userId);
    });

    it("POST /api/launches creates launch with tiers", async () => {
      const launchWithTiers = {
        ...baseLaunch,
        tiers: [
          { minAmount: "0", maxAmount: "100", pricePerToken: 0.08 },
          { minAmount: "100", maxAmount: "500", pricePerToken: 0.09 },
        ],
      };

      const res = await request(app)
        .post("/api/launches")
        .set("Authorization", `Bearer ${authToken}`)
        .send(launchWithTiers);

      expect(res.status).toBe(201);
      expect(res.body.tiers).toHaveLength(2);
    });

    it("POST /api/launches creates launch with vesting", async () => {
      const launchWithVesting = {
        ...baseLaunch,
        vesting: { cliffDays: 30, vestingDays: 180, tgePercent: 10 },
      };

      const res = await request(app)
        .post("/api/launches")
        .set("Authorization", `Bearer ${authToken}`)
        .send(launchWithVesting);

      expect(res.status).toBe(201);
      expect(res.body.vesting).toBeDefined();
      expect(res.body.vesting.cliffDays).toBe(30);
    });

    it("POST /api/launches returns 400 for missing fields", async () => {
      const res = await request(app)
        .post("/api/launches")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ name: "Incomplete" });

      expect(res.status).toBe(400);
    });

    it("GET /api/launches returns list with pagination", async () => {
      await request(app)
        .post("/api/launches")
        .set("Authorization", `Bearer ${authToken}`)
        .send(baseLaunch);

      const res = await request(app).get("/api/launches?page=1&limit=10");

      expect(res.status).toBe(200);
      expect(res.body.launches).toHaveLength(1);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(10);
    });

    it("GET /api/launches filters by status", async () => {
      const upcomingLaunch = {
        ...baseLaunch,
        name: "Upcoming",
        startsAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
        endsAt: new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString(),
      };

      await request(app)
        .post("/api/launches")
        .set("Authorization", `Bearer ${authToken}`)
        .send(baseLaunch);

      await request(app)
        .post("/api/launches")
        .set("Authorization", `Bearer ${authToken}`)
        .send(upcomingLaunch);

      const activeRes = await request(app).get("/api/launches?status=ACTIVE");
      expect(activeRes.body.launches).toHaveLength(1);
      expect(activeRes.body.launches[0].status).toBe("ACTIVE");

      const upcomingRes = await request(app).get(
        "/api/launches?status=UPCOMING"
      );
      expect(upcomingRes.body.launches).toHaveLength(1);
      expect(upcomingRes.body.launches[0].status).toBe("UPCOMING");
    });

    it("GET /api/launches applies status filter before pagination", async () => {
      await request(app)
        .post("/api/launches")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ ...baseLaunch, name: "Active 1" });

      await request(app)
        .post("/api/launches")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ ...baseLaunch, name: "Active 2", symbol: "A2" });

      await request(app)
        .post("/api/launches")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          ...baseLaunch,
          name: "Upcoming 1",
          symbol: "UP2",
          startsAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
          endsAt: new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString(),
        });

      const page1 = await request(app).get(
        "/api/launches?status=ACTIVE&limit=1&page=1"
      );
      expect(page1.status).toBe(200);
      expect(page1.body.total).toBe(2);
      expect(page1.body.launches).toHaveLength(1);
      expect(page1.body.launches[0].status).toBe("ACTIVE");

      const page2 = await request(app).get(
        "/api/launches?status=ACTIVE&limit=1&page=2"
      );
      expect(page2.status).toBe(200);
      expect(page2.body.total).toBe(2);
      expect(page2.body.launches).toHaveLength(1);
      expect(page2.body.launches[0].status).toBe("ACTIVE");
    });

    it("POST /api/launches returns 400 for malformed numeric/date fields", async () => {
      const invalidBigIntRes = await request(app)
        .post("/api/launches")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          ...baseLaunch,
          totalSupply: "abc",
        });
      expect(invalidBigIntRes.status).toBe(400);

      const invalidDateRes = await request(app)
        .post("/api/launches")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          ...baseLaunch,
          startsAt: "not-a-date",
        });
      expect(invalidDateRes.status).toBe(400);
    });

    it("GET /api/launches/:id returns launch with status", async () => {
      const createRes = await request(app)
        .post("/api/launches")
        .set("Authorization", `Bearer ${authToken}`)
        .send(baseLaunch);

      const res = await request(app).get(
        `/api/launches/${createRes.body.id}`
      );

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(createRes.body.id);
      expect(res.body.status).toBe("ACTIVE");
    });

    it("GET /api/launches/:id returns 404 for non-existent launch", async () => {
      const res = await request(app).get("/api/launches/nonexistent123");

      expect(res.status).toBe(404);
    });

    it("PUT /api/launches/:id updates launch as creator", async () => {
      const createRes = await request(app)
        .post("/api/launches")
        .set("Authorization", `Bearer ${authToken}`)
        .send(baseLaunch);

      const res = await request(app)
        .put(`/api/launches/${createRes.body.id}`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ name: "Updated Name" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Updated Name");
    });

    it("PUT /api/launches/:id returns 403 for non-creator", async () => {
      const createRes = await request(app)
        .post("/api/launches")
        .set("Authorization", `Bearer ${authToken}`)
        .send(baseLaunch);

      const otherUserRes = await request(app).post("/api/auth/register").send({
        email: "other@example.com",
        password: "password123",
        name: "Other User",
      });

      const res = await request(app)
        .put(`/api/launches/${createRes.body.id}`)
        .set("Authorization", `Bearer ${otherUserRes.body.token}`)
        .send({ name: "Hacked Name" });

      expect(res.status).toBe(403);
    });
  });

  describe("Whitelist Management", () => {
    let authToken: string;
    let launchId: string;

    beforeEach(async () => {
      const userRes = await request(app).post("/api/auth/register").send({
        email: "creator@example.com",
        password: "password123",
        name: "Creator",
      });
      authToken = userRes.body.token;

      const launchRes = await request(app)
        .post("/api/launches")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          name: "Test Token",
          symbol: "TEST",
          totalSupply: "1000000",
          pricePerToken: 0.1,
          startsAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
          endsAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
          maxPerWallet: "10000",
          description: "Test",
        });
      launchId = launchRes.body.id;
    });

    it("POST /api/launches/:id/whitelist adds addresses", async () => {
      const res = await request(app)
        .post(`/api/launches/${launchId}/whitelist`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ addresses: ["addr1", "addr2", "addr3"] });

      expect(res.status).toBe(200);
      expect(res.body.added).toBe(3);
      expect(res.body.total).toBe(3);
    });

    it("POST /api/launches/:id/whitelist skips duplicates", async () => {
      await request(app)
        .post(`/api/launches/${launchId}/whitelist`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ addresses: ["addr1", "addr2"] });

      const res = await request(app)
        .post(`/api/launches/${launchId}/whitelist`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ addresses: ["addr2", "addr3"] });

      expect(res.status).toBe(200);
      expect(res.body.added).toBe(1);
      expect(res.body.total).toBe(3);
    });

    it("POST /api/launches/:id/whitelist skips duplicates in same request", async () => {
      const res = await request(app)
        .post(`/api/launches/${launchId}/whitelist`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ addresses: ["addrA", "addrA", "addrB"] });

      expect(res.status).toBe(200);
      expect(res.body.added).toBe(2);
      expect(res.body.total).toBe(2);
    });

    it("GET /api/launches/:id/whitelist returns addresses for creator", async () => {
      await request(app)
        .post(`/api/launches/${launchId}/whitelist`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ addresses: ["addr1", "addr2"] });

      const res = await request(app)
        .get(`/api/launches/${launchId}/whitelist`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.addresses).toContain("addr1");
      expect(res.body.addresses).toContain("addr2");
      expect(res.body.total).toBe(2);
    });

    it("GET /api/launches/:id/whitelist returns 403 for non-creator", async () => {
      const otherUserRes = await request(app).post("/api/auth/register").send({
        email: "other@example.com",
        password: "password123",
        name: "Other",
      });

      const res = await request(app)
        .get(`/api/launches/${launchId}/whitelist`)
        .set("Authorization", `Bearer ${otherUserRes.body.token}`);

      expect(res.status).toBe(403);
    });

    it("DELETE /api/launches/:id/whitelist/:address removes address", async () => {
      await request(app)
        .post(`/api/launches/${launchId}/whitelist`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ addresses: ["addr1", "addr2"] });

      const res = await request(app)
        .delete(`/api/launches/${launchId}/whitelist/addr1`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.removed).toBe(true);

      const listRes = await request(app)
        .get(`/api/launches/${launchId}/whitelist`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(listRes.body.addresses).not.toContain("addr1");
    });

    it("DELETE /api/launches/:id/whitelist/:address returns 404 for non-existent", async () => {
      const res = await request(app)
        .delete(`/api/launches/${launchId}/whitelist/nonexistent`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe("Referral Codes", () => {
    let authToken: string;
    let launchId: string;

    beforeEach(async () => {
      const userRes = await request(app).post("/api/auth/register").send({
        email: "creator@example.com",
        password: "password123",
        name: "Creator",
      });
      authToken = userRes.body.token;

      const launchRes = await request(app)
        .post("/api/launches")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          name: "Test Token",
          symbol: "TEST",
          totalSupply: "1000000",
          pricePerToken: 0.1,
          startsAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
          endsAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
          maxPerWallet: "10000",
          description: "Test",
        });
      launchId = launchRes.body.id;
    });

    it("POST /api/launches/:id/referrals creates referral code", async () => {
      const res = await request(app)
        .post(`/api/launches/${launchId}/referrals`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ code: "SAVE10", discountPercent: 10, maxUses: 100 });

      expect(res.status).toBe(201);
      expect(res.body.code).toBe("SAVE10");
      expect(res.body.discountPercent).toBe(10);
      expect(res.body.maxUses).toBe(100);
      expect(res.body.usedCount).toBe(0);
    });

    it("POST /api/launches/:id/referrals returns 409 for duplicate", async () => {
      await request(app)
        .post(`/api/launches/${launchId}/referrals`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ code: "SAVE10", discountPercent: 10, maxUses: 100 });

      const res = await request(app)
        .post(`/api/launches/${launchId}/referrals`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ code: "SAVE10", discountPercent: 20, maxUses: 50 });

      expect(res.status).toBe(409);
    });

    it("POST /api/launches/:id/referrals validates discountPercent and maxUses", async () => {
      const invalidDiscount = await request(app)
        .post(`/api/launches/${launchId}/referrals`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ code: "BADDISC", discountPercent: 120, maxUses: 10 });
      expect(invalidDiscount.status).toBe(400);

      const invalidMaxUses = await request(app)
        .post(`/api/launches/${launchId}/referrals`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ code: "BADMAX", discountPercent: 10, maxUses: 0 });
      expect(invalidMaxUses.status).toBe(400);
    });

    it("GET /api/launches/:id/referrals lists codes with usedCount", async () => {
      await request(app)
        .post(`/api/launches/${launchId}/referrals`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ code: "CODE1", discountPercent: 5, maxUses: 50 });

      await request(app)
        .post(`/api/launches/${launchId}/referrals`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ code: "CODE2", discountPercent: 10, maxUses: 100 });

      const res = await request(app)
        .get(`/api/launches/${launchId}/referrals`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].usedCount).toBeDefined();
    });

    it("GET /api/launches/:id/referrals returns 403 for non-creator", async () => {
      const otherUserRes = await request(app).post("/api/auth/register").send({
        email: "other@example.com",
        password: "password123",
        name: "Other",
      });

      const res = await request(app)
        .get(`/api/launches/${launchId}/referrals`)
        .set("Authorization", `Bearer ${otherUserRes.body.token}`);

      expect(res.status).toBe(403);
    });
  });

  describe("Token Purchases", () => {
    let creatorToken: string;
    let buyerToken: string;
    let buyerId: string;
    let launchId: string;

    beforeEach(async () => {
      const creatorRes = await request(app).post("/api/auth/register").send({
        email: "creator@example.com",
        password: "password123",
        name: "Creator",
      });
      creatorToken = creatorRes.body.token;

      const buyerRes = await request(app).post("/api/auth/register").send({
        email: "buyer@example.com",
        password: "password123",
        name: "Buyer",
      });
      buyerToken = buyerRes.body.token;
      buyerId = buyerRes.body.user.id;

      const launchRes = await request(app)
        .post("/api/launches")
        .set("Authorization", `Bearer ${creatorToken}`)
        .send({
          name: "Test Token",
          symbol: "TEST",
          totalSupply: "1000",
          pricePerToken: 1.0,
          startsAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
          endsAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
          maxPerWallet: "500",
          description: "Test",
        });
      launchId = launchRes.body.id;
    });

    it("POST /api/launches/:id/purchase creates purchase", async () => {
      const res = await request(app)
        .post(`/api/launches/${launchId}/purchase`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          walletAddress: "wallet123",
          amount: "100",
          txSignature: "tx123",
        });

      expect(res.status).toBe(201);
      expect(res.body.amount).toBe("100");
      expect(res.body.totalCost).toBe(100);
      expect(res.body.userId).toBe(buyerId);
    });

    it("POST /api/launches/:id/purchase with tiered pricing", async () => {
      const launchRes = await request(app)
        .post("/api/launches")
        .set("Authorization", `Bearer ${creatorToken}`)
        .send({
          name: "Tiered Token",
          symbol: "TIER",
          totalSupply: "1000",
          pricePerToken: 2.0,
          startsAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
          endsAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
          maxPerWallet: "500",
          description: "Test",
          tiers: [
            { minAmount: "0", maxAmount: "100", pricePerToken: 0.5 },
            { minAmount: "100", maxAmount: "300", pricePerToken: 1.0 },
          ],
        });

      const res = await request(app)
        .post(`/api/launches/${launchRes.body.id}/purchase`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          walletAddress: "wallet123",
          amount: "250",
          txSignature: "tx_tiered",
        });

      expect(res.status).toBe(201);
      expect(res.body.totalCost).toBe(100 * 0.5 + 150 * 1.0);
    });

    it("POST /api/launches/:id/purchase applies referral discount", async () => {
      await request(app)
        .post(`/api/launches/${launchId}/referrals`)
        .set("Authorization", `Bearer ${creatorToken}`)
        .send({ code: "SAVE20", discountPercent: 20, maxUses: 10 });

      const res = await request(app)
        .post(`/api/launches/${launchId}/purchase`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          walletAddress: "wallet123",
          amount: "100",
          txSignature: "tx_with_ref",
          referralCode: "SAVE20",
        });

      expect(res.status).toBe(201);
      expect(res.body.totalCost).toBe(80);
    });

    it("POST /api/launches/:id/purchase rejects invalid referral", async () => {
      const res = await request(app)
        .post(`/api/launches/${launchId}/purchase`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          walletAddress: "wallet123",
          amount: "100",
          txSignature: "tx_bad_ref",
          referralCode: "INVALID",
        });

      expect(res.status).toBe(400);
    });

    it("POST /api/launches/:id/purchase rejects exhausted referral", async () => {
      await request(app)
        .post(`/api/launches/${launchId}/referrals`)
        .set("Authorization", `Bearer ${creatorToken}`)
        .send({ code: "LIMITED", discountPercent: 10, maxUses: 1 });

      await request(app)
        .post(`/api/launches/${launchId}/purchase`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          walletAddress: "wallet1",
          amount: "10",
          txSignature: "tx1",
          referralCode: "LIMITED",
        });

      const res = await request(app)
        .post(`/api/launches/${launchId}/purchase`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          walletAddress: "wallet2",
          amount: "10",
          txSignature: "tx2",
          referralCode: "LIMITED",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("max uses");
    });

    it("POST /api/launches/:id/purchase enforces maxPerWallet per user", async () => {
      await request(app)
        .post(`/api/launches/${launchId}/purchase`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          walletAddress: "wallet1",
          amount: "400",
          txSignature: "tx1",
        });

      const res = await request(app)
        .post(`/api/launches/${launchId}/purchase`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          walletAddress: "wallet2",
          amount: "200",
          txSignature: "tx2",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("max per wallet");
    });

    it("POST /api/launches/:id/purchase enforces whitelist", async () => {
      await request(app)
        .post(`/api/launches/${launchId}/whitelist`)
        .set("Authorization", `Bearer ${creatorToken}`)
        .send({ addresses: ["allowed_wallet"] });

      const resNotWhitelisted = await request(app)
        .post(`/api/launches/${launchId}/purchase`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          walletAddress: "not_allowed",
          amount: "10",
          txSignature: "tx_not_wl",
        });

      expect(resNotWhitelisted.status).toBe(400);
      expect(resNotWhitelisted.body.error).toContain("not whitelisted");

      const resWhitelisted = await request(app)
        .post(`/api/launches/${launchId}/purchase`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          walletAddress: "allowed_wallet",
          amount: "10",
          txSignature: "tx_wl",
        });

      expect(resWhitelisted.status).toBe(201);
    });

    it("POST /api/launches/:id/purchase rejects duplicate txSignature", async () => {
      await request(app)
        .post(`/api/launches/${launchId}/purchase`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          walletAddress: "wallet1",
          amount: "10",
          txSignature: "same_tx",
        });

      const res = await request(app)
        .post(`/api/launches/${launchId}/purchase`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          walletAddress: "wallet2",
          amount: "10",
          txSignature: "same_tx",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("already used");
    });

    it("POST /api/launches/:id/purchase rejects invalid amount payloads", async () => {
      const zeroAmount = await request(app)
        .post(`/api/launches/${launchId}/purchase`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          walletAddress: "wallet1",
          amount: "0",
          txSignature: "tx_zero",
        });
      expect(zeroAmount.status).toBe(400);

      const negativeAmount = await request(app)
        .post(`/api/launches/${launchId}/purchase`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          walletAddress: "wallet1",
          amount: "-10",
          txSignature: "tx_negative",
        });
      expect(negativeAmount.status).toBe(400);

      const malformedAmount = await request(app)
        .post(`/api/launches/${launchId}/purchase`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          walletAddress: "wallet1",
          amount: "10.5",
          txSignature: "tx_decimal",
        });
      expect(malformedAmount.status).toBe(400);
    });

    it("POST /api/launches/:id/purchase does not increment referral usage when purchase fails", async () => {
      await request(app)
        .post(`/api/launches/${launchId}/referrals`)
        .set("Authorization", `Bearer ${creatorToken}`)
        .send({ code: "SAFE10", discountPercent: 10, maxUses: 5 });

      await request(app)
        .post(`/api/launches/${launchId}/purchase`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          walletAddress: "wallet1",
          amount: "10",
          txSignature: "tx_ref_integrity",
        });

      const failedPurchase = await request(app)
        .post(`/api/launches/${launchId}/purchase`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          walletAddress: "wallet2",
          amount: "10",
          txSignature: "tx_ref_integrity",
          referralCode: "SAFE10",
        });
      expect(failedPurchase.status).toBe(400);

      const referralsRes = await request(app)
        .get(`/api/launches/${launchId}/referrals`)
        .set("Authorization", `Bearer ${creatorToken}`);
      expect(referralsRes.status).toBe(200);

      const code = referralsRes.body.find((r: any) => r.code === "SAFE10");
      expect(code).toBeDefined();
      expect(code.usedCount).toBe(0);
    });

    it("POST /api/launches/:id/purchase rejects when totalSupply exceeded", async () => {
      const res = await request(app)
        .post(`/api/launches/${launchId}/purchase`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          walletAddress: "wallet1",
          amount: "1100",
          txSignature: "tx_exceed",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("exceeds");
    });

    it("POST /api/launches/:id/purchase rejects UPCOMING launch", async () => {
      const upcomingRes = await request(app)
        .post("/api/launches")
        .set("Authorization", `Bearer ${creatorToken}`)
        .send({
          name: "Upcoming Token",
          symbol: "UP",
          totalSupply: "1000",
          pricePerToken: 1.0,
          startsAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
          endsAt: new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString(),
          maxPerWallet: "500",
          description: "Test",
        });

      const res = await request(app)
        .post(`/api/launches/${upcomingRes.body.id}/purchase`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          walletAddress: "wallet1",
          amount: "10",
          txSignature: "tx_upcoming",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("UPCOMING");
    });

    it("POST /api/launches/:id/purchase rejects ENDED launch", async () => {
      const endedRes = await request(app)
        .post("/api/launches")
        .set("Authorization", `Bearer ${creatorToken}`)
        .send({
          name: "Ended Token",
          symbol: "END",
          totalSupply: "1000",
          pricePerToken: 1.0,
          startsAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
          endsAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
          maxPerWallet: "500",
          description: "Test",
        });

      const res = await request(app)
        .post(`/api/launches/${endedRes.body.id}/purchase`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          walletAddress: "wallet1",
          amount: "10",
          txSignature: "tx_ended",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("ENDED");
    });

    it("GET /api/launches/:id/purchases - creator sees all", async () => {
      await request(app)
        .post(`/api/launches/${launchId}/purchase`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          walletAddress: "wallet1",
          amount: "10",
          txSignature: "tx1",
        });

      const res = await request(app)
        .get(`/api/launches/${launchId}/purchases`)
        .set("Authorization", `Bearer ${creatorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.purchases).toHaveLength(1);
      expect(res.body.purchases[0].userId).toBe(buyerId);
    });

    it("GET /api/launches/:id/purchases - buyer sees only own", async () => {
      const buyer2Res = await request(app).post("/api/auth/register").send({
        email: "buyer2@example.com",
        password: "password123",
        name: "Buyer2",
      });

      await request(app)
        .post(`/api/launches/${launchId}/purchase`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          walletAddress: "wallet1",
          amount: "10",
          txSignature: "tx1",
        });

      await request(app)
        .post(`/api/launches/${launchId}/purchase`)
        .set("Authorization", `Bearer ${buyer2Res.body.token}`)
        .send({
          walletAddress: "wallet2",
          amount: "20",
          txSignature: "tx2",
        });

      const res = await request(app)
        .get(`/api/launches/${launchId}/purchases`)
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.purchases).toHaveLength(1);
      expect(res.body.purchases[0].userId).toBe(buyerId);
    });
  });

  describe("Vesting Schedule", () => {
    let creatorToken: string;
    let buyerToken: string;

    beforeEach(async () => {
      const creatorRes = await request(app).post("/api/auth/register").send({
        email: "creator@example.com",
        password: "password123",
        name: "Creator",
      });
      creatorToken = creatorRes.body.token;

      const buyerRes = await request(app).post("/api/auth/register").send({
        email: "buyer@example.com",
        password: "password123",
        name: "Buyer",
      });
      buyerToken = buyerRes.body.token;
    });

    it("GET /api/launches/:id/vesting returns all claimable without vesting config", async () => {
      const launchRes = await request(app)
        .post("/api/launches")
        .set("Authorization", `Bearer ${creatorToken}`)
        .send({
          name: "No Vesting Token",
          symbol: "NVT",
          totalSupply: "1000",
          pricePerToken: 1.0,
          startsAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
          endsAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
          maxPerWallet: "500",
          description: "Test",
        });

      await request(app)
        .post(`/api/launches/${launchRes.body.id}/purchase`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          walletAddress: "wallet123",
          amount: "100",
          txSignature: "tx1",
        });

      const res = await request(app).get(
        `/api/launches/${launchRes.body.id}/vesting?walletAddress=wallet123`
      );

      expect(res.status).toBe(200);
      expect(res.body.totalPurchased).toBe("100");
      expect(res.body.claimableAmount).toBe("100");
      expect(res.body.lockedAmount).toBe("0");
    });

    it("GET /api/launches/:id/vesting calculates TGE amount", async () => {
      const launchRes = await request(app)
        .post("/api/launches")
        .set("Authorization", `Bearer ${creatorToken}`)
        .send({
          name: "Vesting Token",
          symbol: "VT",
          totalSupply: "1000",
          pricePerToken: 1.0,
          startsAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
          endsAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
          maxPerWallet: "500",
          description: "Test",
          vesting: { cliffDays: 30, vestingDays: 180, tgePercent: 20 },
        });

      await request(app)
        .post(`/api/launches/${launchRes.body.id}/purchase`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          walletAddress: "wallet123",
          amount: "100",
          txSignature: "tx1",
        });

      const res = await request(app).get(
        `/api/launches/${launchRes.body.id}/vesting?walletAddress=wallet123`
      );

      expect(res.status).toBe(200);
      expect(res.body.totalPurchased).toBe("100");
      expect(res.body.tgeAmount).toBe("20");
      expect(res.body.cliffEndsAt).toBeDefined();
    });

    it("GET /api/launches/:id/vesting returns 400 without walletAddress", async () => {
      const launchRes = await request(app)
        .post("/api/launches")
        .set("Authorization", `Bearer ${creatorToken}`)
        .send({
          name: "Test Token",
          symbol: "TT",
          totalSupply: "1000",
          pricePerToken: 1.0,
          startsAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
          endsAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
          maxPerWallet: "500",
          description: "Test",
        });

      const res = await request(app).get(
        `/api/launches/${launchRes.body.id}/vesting`
      );

      expect(res.status).toBe(400);
    });

    it("GET /api/launches/:id/vesting returns 404 for non-existent launch", async () => {
      const res = await request(app).get(
        "/api/launches/nonexistent/vesting?walletAddress=wallet123"
      );

      expect(res.status).toBe(404);
    });
  });
});
