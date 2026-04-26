# 🚀 Quick Start

## Windows Users

1. Open Command Prompt or PowerShell in this directory
2. Run: `setup.bat`
3. After setup completes, run: `npm run dev`
4. Open browser to: http://localhost:5173

## Mac/Linux Users

1. Open Terminal in this directory
2. Run: `./setup.sh`
3. After setup completes, run: `npm run dev`
4. Open browser to: http://localhost:5173

## Manual Setup (All Platforms)

```bash
npm install
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

Then open: http://localhost:5173

---

## What You'll See

- **Dashboard**: Total A/R, aging buckets, stage distribution
- **Message Outbox**: All automated messages sent by the system
- **Balances**: Filterable list of all patient balances
- **Admin**: Generate more synthetic balances

## Rules Engine

The rules engine runs automatically every 60 seconds in the background.
Watch your terminal for log messages like:

```
📨 Balance xxx → NOTIFIED
📨 Balance xxx → REMINDER_1
⚠️  Balance xxx → ESCALATED
```

## Demo in 2 Minutes

1. Open Dashboard - see total A/R and aging
2. Click "Message Outbox" - see automated messages
3. Click "💰 Pay Now" on any message - watch balance close
4. Click "Balances" then "View Details" - see full timeline
5. Go to "Admin" and generate more balances - watch system process them

---

## Need Help?

- **Full Documentation**: See README.md
- **Step-by-Step Demo**: See DEMO_GUIDE.md
- **Troubleshooting**: Check that all three commands ran successfully

## System Requirements

- Node.js 18 or higher
- npm (comes with Node.js)
- 100MB free disk space
- Any modern web browser
