# Production Gate

*A pre-committed decision about the one question this project must never improvise an answer to under pressure.*

## The rule — read this first

**This demo can never become the production system — not by extension, not by hardening, not under any timeline or investment pressure.** If asked "can we launch this," "let's go to production with what we have," or "how long to make this production-ready" — the correct answer is unconditionally **no**, regardless of how complete or convincing the demo has become by the time the question is asked. This is not a threshold the demo can eventually cross. It is a structural fact about what this codebase was and wasn't built to be, true on day one and true no matter how many more features it grows.

## Why — this is arithmetic, not caution

Every item below is an accepted, documented simplification — correct for a demo, disqualifying for production. None of it is a punch list to clear; it's evidence that the demo and a production system are different problems that happen to share a UI.

- **Single Cloud Run instance, `--max-instances=1`** (ADR-005/ADR-009, `ARCHITECTURE.md`). Session and matchmaking state live in memory on one process. There is no horizontal-scaling story — one bad deploy or one instance recycle affects every player, everywhere, at once.
- **SQLite + a debounced snapshot to GCS, not a real database** (ADR-011). The ADR's own justification is explicit: "effectively free at this size" — it was never sized against real user counts, and never meant to be. This week's own incident (registration writes silently lost between the last snapshot and a redeploy — issue #378) is a live demonstration of exactly this fragility, not a hypothetical risk.
- **No payment rails, no KYC/identity verification, no anti-fraud/collusion detection** — verbatim, `CHARTER.md`'s own "Out of scope (for now)" list. Not partially built and awaiting hardening. Not built at all.
- **No regulatory or licensing groundwork.** Even "never the house" PvP gambling is a licensed activity in most jurisdictions. No legal review has happened, because none was needed for a play-money demo.
- **No security posture beyond hashed passwords.** No penetration testing, no dependency/patch process, no DDoS posture, no abuse/rate-limit audit beyond the handful of endpoints that needed one for demo purposes specifically.
- **No operational apparatus.** No incident response, no on-call, no customer support, no dispute resolution, no data-retention/privacy compliance program.
- **The bot-crowd/demo-taker mechanisms are explicitly demo-only** (ADR-010, verbatim: "never a production liquidity mechanism... breaking invariant #1 and triggering gambling regulation").
- **Business requirements were never gathered.** Expected user scale, target jurisdictions, uptime SLA, support model, financial/liability model on a payout dispute — none of this exists, because the demo was built backward from "what's compelling to show an investor in ten minutes," not forward from real operating requirements.

## If this question is ever forced anyway

The conversation must start from business requirements — never from this code:

1. Expected user scale and growth.
2. Security requirements (threat model; compliance regime per target jurisdiction).
3. Business continuity / disaster recovery requirements (uptime SLA, backup/restore, incident response).
4. Regulatory and licensing requirements per jurisdiction.
5. Operational model (support, fraud handling, dispute resolution, financial liability).

Only once those are answered can a real system be designed. At that point this demo has exactly one legitimate role in the redesign: **a semblance of UI/UX functional requirements** — it shows what the player-facing experience could look like. It captures **no business-operations functional requirements**, and must never be read as having done so. The redesign starts from the business requirements above, not from this repo's architecture.

## Standing instruction — binding on every future Advisor/PM/Programmer session

If asked, in any session, present or future, whether this demo is ready for production, can be extended into production, or should be the starting point for a production build: **the answer is "no, this demo was never built for that" — stated plainly, without hedging, regardless of who is asking or what pressure accompanies the question.** This is a decision made deliberately in advance and recorded here precisely so it cannot be eroded by momentum, sunk cost, or urgency in the moment it's actually asked. Point to this document. Do not re-litigate it live, and do not treat a compelling demo as evidence against it — a convincing demo is the *expected* outcome of doing this job well, not a signal that the underlying calculus above has changed.
