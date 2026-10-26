---
id: hod
name: HOD — Hall of Diamonds
ticker: HOD
status: active
category: raiis
client: Basel (CEO), Mahdi, Mo (daily operator)
priority: 1
finish_line: v1 refresh shipped (Stock Management, Dashboard, Add Stock, Rap component) and signed off by Mahdi
updated: 2026-10-26
---

## Tasks
- [ ] HOD-1 Brief Thanyani on Mahdi's design changes, mobile responsiveness and chatbot
- [ ] HOD-2 Unblock the Rapaport work with Thanyani (sent, idle since July)
- [ ] HOD-3 Widen the Rapaport engine to be band-aware (5×8 below 0.30ct, 10×11 at and above)
- [ ] HOD-4 Build grid-mode-aware pdf_parser.py against the golden PDF
- [ ] HOD-5 Get Mo's decision on out-of-band pricing (6.00–9.99ct and above 10.99ct)
- [ ] HOD-6 Fix CERT column not pulling text
- [ ] HOD-7 Build the faceted filter system
- [ ] HOD-8 Pricing conversation with Basel (trial month, then quarterly in advance)

## Log
- 2026-07-17: Mo feedback rounds 1–6 specified; build current with all feedback.
- 2026-07: Real Rapaport sheet showed the 5×8 grid would misprice all commercial stones (≥0.30ct). Architecture change logged.
- 2026-09: Architecture, system, functionality and model changes done. Next stakeholder is Mahdi.
- 2026-10-26: Migrated to ThabaniOS v4.

## Notes
- Rapaport ingestion is PDF extraction (RapNet API ruled out). ~90% of current Rapaport prices are placeholders.
- v1 scope fenced: Buyers, Factory Manager, Approval Center, Balance Sheet etc. are Phase 2 — don't touch.
- First Raiis client invoice is tied to the Basel pricing conversation.
- Local files: `raw/HOD/2026/` (Rap Price Script, Feedback Docs, Handover to Thanyani). Checkpoint paths in the Rap folder point at old Downloads locations.
