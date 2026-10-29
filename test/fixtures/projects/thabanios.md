---
id: thabanios
name: ThabaniOS v4
ticker: OS
status: active
category: personal
priority: 1
finish_line: Two-way Telegram ↔ repo ↔ dashboard loop live, with confirm before commit
deadline: 2026-11-04
updated: 2026-10-26
---

## Tasks
- [ ] OS-1 Review migrated project files (priorities, finish lines, tasks)
- [x] OS-2 Link GitHub to Claude so cloud sessions can reach ThabaniOS/projects (done 2026-10-26)
- [x] OS-3 Phase 1: repo restructure, schema, status.json Action (done 2026-10-26)
- [ ] OS-4 Phase 2: /api/telegram with tools and confirm/undo
- [ ] OS-5 Phase 3: dashboard v4
- [ ] OS-6 Phase 4: deactivate n8n ThabaniOS Bot, point webhook at Vercel, end-to-end test
- [ ] OS-7 Move sunset files into local archive/ and out of outputs/

## Log
- 2026-10-26: v4 scoped; bot moves to Vercel; confirm-before-commit chosen. Spec in SPEC.md.
- 2026-10-26: Phase 1 live — schema, builder and Action on master; restore point on branch pre-v4.

## Notes
- Deadline is the cloud-session credit expiry (5 Nov, 09:59).
- Spec: `SPEC.md` at the repo root.
