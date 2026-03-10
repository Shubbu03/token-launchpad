# Solana Token Launchpad

Backend API for managing token launches on Solana. Handles launch creation, tiered pricing, vesting schedules, whitelists, referral discounts, and purchase tracking.

## Features

- **Launches** — Create and manage token sales with configurable supply, dates, and max-per-wallet limits
- **Tiered pricing** — Price bands by token range (e.g. early buyers get lower price)
- **Vesting** — Cliff + linear vesting with configurable TGE %
- **Whitelist** — Per-launch address allowlists
- **Referrals** — Discount codes with max-use limits
- **Auth** — JWT-based registration and login

## Tech Stack

- Express, TypeScript, Prisma (PostgreSQL), Jest

## Setup

```bash
npm install
# Create .env with DATABASE_URL and JWT_SECRET
npx prisma migrate dev
npm start
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Run server (port 3000) |
| `npm test` | Run tests |

## API Overview

| Route | Description |
|-------|-------------|
| `POST /api/auth/register` | Register user |
| `POST /api/auth/login` | Login, returns JWT |
| `GET/POST /api/launches` | List or create launches |
| `GET/PUT /api/launches/:id` | Get or update launch |
| `POST /api/launches/:id/whitelist` | Add whitelist entries |
| `POST /api/launches/:id/referrals` | Create referral codes |
| `POST /api/launches/:id/purchase` | Record purchase (wallet, amount, tx signature) |
| `GET /api/launches/:id/vesting?walletAddress=...` | Get vesting status for a wallet |
