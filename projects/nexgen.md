---
id: nexgen
name: Sundowns NexGen — Deprecation
ticker: NXG
status: active
category: mb-digital
client: Mamelodi Sundowns
priority: 2
finish_line: All applicant data exported to agreed secure storage, platform decommissioned, deletion logged
updated: 2026-10-26
---

## Tasks
- [ ] NXG-1 Confirm with the club that selection is closed and the platform can be retired
- [ ] NXG-2 Agree the POPIA retention/deletion schedule in writing with the club
- [ ] NXG-3 Export applicants who consented to marketing for Yellow Verse BEFORE anything is deleted
- [ ] NXG-4 Decide where the archive lives (club-owned storage preferred over personal accounts)
- [ ] NXG-5 Export Supabase DB and Storage bucket to an encrypted archive; verify the restore
- [ ] NXG-6 Revoke reviewer accounts and take the Vercel site down
- [ ] NXG-7 Delete the Supabase project and Gravity Forms uploads once the archive is verified
- [ ] NXG-8 Write a short deprecation checkpoint (what was kept, where, until when)

## Log
- 2026-07-17: Final dataset 15,819 applicants; 5,107 review-ready, 10,712 behind the readiness gate (32,521 files not migrated).
- 2026-10: Decision to deprecate and store the data securely.
- 2026-10-26: Migrated to ThabaniOS v4.

## Notes
- This is PII under POPIA (CVs, IDs, contact details). Deletion has to cover the source too: the 10,712 un-migrated applicants' files still sit in Gravity Forms / WordPress uploads.
- Repo: `ThabaniOS/NexGen`. Checkpoints: `raw/Vibecoding/vibecoding_checkpoint_nexgen-*.md`.
- The NexGen applicant onboarding stream in Yellow Verse depends on NXG-3.
