# `docs/HISTORY/` — superseded drafts

Docs that were never committed at the time they were written, and whose content has since been fully promoted into a real tracked location. Kept for audit trail; not read as current — the promoted copy is authoritative. Mirrors the same "resolved items graduate down here, nothing deleted" convention as `docs/COMMS/from-advisor/HISTORY/`.

- **`ADR-011_persistence.md`** — Advisor's ADR-011 proposal (SQLite→GCS snapshot, password-clear soft reset). Fully merged into `ARCHITECTURE.md`'s ADR-011 entry.
- **`ADVISOR_note_guestmode_seam_ratified.md`** — Advisor note on the Guest-Mode seam v0.2 ratification. Fully promoted into `docs/COMMS/ADVISOR_TO_PM.md` (2026-08-06#2).
- **`ADVISOR_TO_PM_entry_demo_takers.md`** — Advisor proposal for the gated "Demo" reserved-taker plan-B (`bot-crowd` allowlist/stake/roster gating). Implemented in code — confirmed live at `tools/bot-crowd/src/config.ts` (`takerAllowNames`/`TAKER_ALLOW_NAMES` etc.) and `tools/bot-crowd/src/bot.ts`.
- **`ADVISOR_HANDOVER.md`** — an old Advisor cold-start briefing (dated 2026-07-07). Superseded by the current `docs/COMMS/PM_BRIEF.md` / `CODER_BRIEF.md` / `COMMS_PROTOCOL.md` onboarding system.

`DEMO_TAKER_VM_SETUP.md` (the companion runbook to the demo-takers entry above) was kept live in `docs/` rather than archived here — its content (the actual VM setup steps for the "Demo" taker plan-B) isn't duplicated anywhere else and stays operationally relevant.
