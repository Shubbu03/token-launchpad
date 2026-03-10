import express from "express";
import healthRouter from "./routes/health";
import authRouter from "./routes/auth";
import launchesRouter from "./routes/launches";
import whitelistRouter from "./routes/whitelist";
import referralsRouter from "./routes/referrals";
import purchasesRouter from "./routes/purchases";
import vestingRouter from "./routes/vesting";

const app = express();
app.use(express.json());

app.use("/api/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/launches", launchesRouter);
app.use("/api/launches/:id/whitelist", whitelistRouter);
app.use("/api/launches/:id/referrals", referralsRouter);
app.use("/api/launches/:id/purchase", purchasesRouter);
app.use("/api/launches/:id/purchases", purchasesRouter);
app.use("/api/launches/:id/vesting", vestingRouter);

export default app;
