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

## Log
- 2026-07-22: Live. Daily 12:00 SAST check of the Raiis Software Costs sheet; annual renewals get a 7-day heads-up.
- 2026-10-26: Migrated to ThabaniOS v4.

## Notes
- n8n: Schedule → Sheet → Code → Telegram. Sheet is the source of truth; no database, deliberately.
- Reusable pattern for future scheduled-check builds — see `raw/Vibecoding/checkpoint-raiis-payment-reminder.md`.
- Sends through the ThabaniOS Telegram bot; unaffected by the v4 webhook move.
