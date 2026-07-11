# Always-on CollectRx (no daily `npm start`)

You have two durable options: **hosted (Railway)** for production, or **PM2 on your Mac** for local always-on.

---

## Option 1 — Railway (recommended long-term)

Railway keeps the app running, restarts on failure, and runs migrations on deploy. Your repo is already set up (`Dockerfile`, `railway.toml`, health check `/api/health`).

### One service (simplest)

1. Deploy `Collect-RX-main` as a Railway service (see [Collect-RX-main/DEPLOY.md](../../Collect-RX-main/DEPLOY.md)).
2. Set variables: `DATABASE_URL`, `JWT_SECRET`, `NODE_ENV=production`, `PUBLIC_APP_URL`, etc.
3. Open the generated URL — no `npm start` on your laptop.

**Background jobs without a second process:** leave `REDIS_URL` unset. Rules, reminders, and (if enabled) the **Phase 6 learning cron** run **inside** the web process.

**Phase 6 on Railway (single service):**

```bash
LEARNING_LOOP_ENABLED=1
NOTION_API_KEY=...
NOTION_LEARNING_DATABASE_ID=...
LEARNING_CRON=0 6 * * *
ALERT_SMS_TO=+1...
# Twilio vars for SMS summaries
```

### Two services (scale / isolation)

1. Add **Redis** on Railway → set `REDIS_URL` on web + worker.
2. Duplicate the service; set start command to **`npm run worker`** (same root dir + env).
3. Web service: optional `DISABLE_SCHEDULER=1` on extra replicas (see [PHASE8-BACKGROUND.md](./PHASE8-BACKGROUND.md)).

Learning, reminders, and rules then run on the **worker**, 24/7, without your Mac.

---

## Option 2 — PM2 on your Mac (local always-on)

Use this if you want the API running in the background on your machine (e.g. desktop app pointing at `localhost`, or testing learning loop overnight).

### One-time setup

```bash
npm install -g pm2
cd Collect-RX-main

# Postgres (repo root)
cd .. && docker compose up -d postgres && cd Collect-RX-main

# .env with DATABASE_URL, optional REDIS_URL, LEARNING_LOOP_ENABLED, Notion, etc.
npm run db:migrate
```

### Start / stop

```bash
cd Collect-RX-main
npm run pm2:start    # API in background (+ worker if REDIS_URL set)
npm run pm2:status
npm run pm2:logs
npm run pm2:stop
```

PM2 survives closing Terminal. After reboot, run `pm2 resurrect` if you saved the process list (`pm2 save` once).

### Optional: start PM2 when you log in

```bash
pm2 startup
# run the command it prints, then:
pm2 save
```

---

## What you do *not* need day-to-day

| Manual habit | Replacement |
|--------------|-------------|
| `npm start` every session | Railway URL or `npm run pm2:start` once |
| `npm run dev` for production use | Railway deploy; use `dev` only when editing UI code |
| `npm run learning:cycle` on a schedule | `LEARNING_LOOP_ENABLED=1` + cron (API in-process or worker with Redis) |

---

## Quick pick

| Goal | Use |
|------|-----|
| Live product / pilot deployment | **Fly.io** |
| Mac always serves API locally | **PM2** + `docker compose` Postgres |
| Phase 6 learns daily + texts you | Railway or PM2 + `LEARNING_LOOP_ENABLED=1` + Notion + Twilio |
