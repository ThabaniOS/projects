---
id: raiis-payments
name: Raiis Payment Reminder Bot
ticker: PAY
status: live
category: raiis
priority: 3
finish_line: Every service has a billing day and reminders reach the Raiis partners' group
updated: 2026-10-26
---

## Tasks
- [ ] PAY-1 Fill Digital Ocean billing_day (bot is blind to it)
- [ ] PAY-2 Find GoDaddy and Spaceship billing days
- [ ] PAY-3 Assign an owner for Railway (or remove it if Lionlead infra is shut down)
- [ ] PAY-4 Move reminders to a Raiis partners' Telegram group (swap chat ID)
- [ ] PAY-5 Migrate off n8n to a GitHub Actions schedule (see "Migration plan" below)
- [ ] PAY-6 Before cancelling n8n: confirm nothing else still runs on it (Sundowns marketing engine, Lionlead webhook)

## Log
- 2026-07-22: Live. Daily 12:00 SAST check of the Raiis Software Costs sheet; annual renewals get a 7-day heads-up.
- 2026-10-26: Migrated to ThabaniOS v4.
- 2026-10-26: Decided to move off n8n one day — about $27/month for this one automation isn't worth it. Not urgent.

## Notes
- n8n: Schedule → Sheet → Code → Telegram. Sheet is the source of truth; no database, deliberately.
- Reusable pattern for future scheduled-check builds — see `raw/Vibecoding/checkpoint-raiis-payment-reminder.md`.
- Sends through the ThabaniOS Telegram bot; unaffected by the v4 webhook move.

### Migration plan (off n8n)
- **Target:** a GitHub Actions scheduled workflow (`on: schedule`) in a private Raiis repo. A small script reads the Raiis Software Costs sheet, applies the same filter (due tomorrow; annuals 7 days out) and posts to Telegram.
- **Why not Vercel cron:** Hobby allows daily cron (fine for this) but is non-commercial only, and this is Raiis business tooling. Pro is $20/month per seat — no saving.
- **Why Actions:** free within the repo's monthly minutes (a run takes seconds), no commercial-use restriction. Trade-off: scheduled runs can start late at busy times — fine for "pay this tomorrow".
- **Cost after:** $0 for this bot. Cancel n8n only once PAY-6 is clear.
- **Carry over:** the fixed-offset SAST handling, month-end clamp and "send nothing when nothing is due" rule from the checkpoint.
