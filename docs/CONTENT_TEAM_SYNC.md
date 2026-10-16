# Sync file for the content team's agents

At the start of every session: `git pull origin main`, then read this file, then `docs/POINTS_SYSTEM.md` and
`docs/ARCADE_CONTEST_FOR_CONTENT_TEAM.md`. **This file wins over any draft.** Nothing under "Decisions still open" gets published.
Claude Code (developer side) cannot message other agents directly; it reads and writes this repo and GitHub issues.
Ask questions by opening a GitHub issue titled `Content question: ...`. Answers come when Ali opens a developer session.

## Live now (in the app and database)
- **Order points:** 1 point per RM1 of food, worked out when the order is placed, **paid when the order is collected**, together with a flat **+6**. A cancelled order earns nothing. Verified in the database by read-only checks and tests; **not yet confirmed with a real collected order** (none exist yet). Do not show screenshots of points being paid until Ali confirms.
- **Double points Tue, Wed, Thu** (Malaysia time, by the day the order is placed). It doubles the 1-point-per-RM order points. The rank bonus (5/8/12%) is a percentage of the doubled amount, so it also grows. The flat **+6 is not doubled**. The owner can switch it off.
- **Referral:** inviter +150, friend +30, both paid after the friend's first collected order of RM20 or more. Max 5 friends per inviter.
- **Arcade Score:** best score in each of the 3 games, added together. Each game counts at most **5,000** (so 15,000 is the maximum). Games give no points per run.
- **Weekly goal:** 1,000 Arcade Score in a Monday to Sunday week gives **+25 points**, once a week. Accounts under 30 days old qualify freely. **Older accounts need at least one collected order ever.** The app cannot take orders before the shop opens, so an account older than 30 days with no collected order does not get the bonus until its first collected order after opening. Safe wording: "New accounts can earn it in their first 30 days. After that, order and collect once to keep earning it." Do not promise it to everyone.
- **Top-spender monthly prize: removed.** The arcade contest is the only monthly prize.
- **Progress display:** Home and Loyalty show points to the next reward and "about N more orders".

## Decisions still open (do not publish)
- **Contest dates:** planned 1 Nov to 1 Dec 2026 (Malaysia time), winners announced 1 Dec.
- **Days to claim:** 60 or 90. The developer recommends 90 (the opening may slip). Ali to confirm. Do not print a number.
- **Opening date:** unconfirmed (mid-November at the earliest, 1 December at the latest, pending council health approval). Never promise a date.
- **Phone number for the contest:** see the note below. Wording must not claim strict "one entry per person".
- **Names of the two point types:** not decided. Keep "points" and "Arcade Score".
- **Weekly goal size** (25 now, finance suggests 15) and **Mushy2 / platter point prices:** not decided.
- Contest prize cost and the RM19 figure: internal.

**Phone number note.** Phone is **optional at sign-up** (sign-up is email, password, name, optional phone). The contest rule "one account per phone number" only applies to accounts that gave a phone. Someone can enter with an email-only account, and one person could in theory make several. So a phone number is **not required to enter or win**. Winners are checked at the counter. Say "one prize per person", not "one account per phone". Ali is deciding whether to ask for a phone before a prize is claimed.

## Changed since last sync
- **16 Oct 2026** Answered content issue #109. Sync file restructured into the three sections the content team asked for. Added the phone note and the exact double-points and weekly-goal rules.
- **15 Oct 2026** Arcade Score cap is **5,000 per game** (max 15,000), live on the database. Ties go to whoever reached the score first.
- **15 Oct 2026** Home and Loyalty pages show "points to your next reward" and "about N more orders".
- **14 Oct 2026** The monthly top-spender prize was **removed**.
- **14 Oct 2026** Points are paid **when the order is collected** (order points + 6), not when placed.
- **14 Oct 2026** Double order points **Tuesday to Thursday**.
- **14 Oct 2026** Friend referral: inviter +150, friend +30, after the friend's first collected order of RM20 or more.

## Always true
- Games give no points per run. No "free burger" reward exists for points. Never promise a reward not in `docs/POINTS_SYSTEM.md`.
- Never promise an opening date or a prize pickup date. Say "prizes are collected after we open, details to follow".
- Wording is "sliders/packs", never "tray". Never say "smash burger". Catering is off.
