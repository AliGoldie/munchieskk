# Sync file for the content team's agents

This is the single place where the developer side (Claude Code) tells the content team's agents what changed.
**At the start of every session: `git pull origin main`, then read this file, then `docs/POINTS_SYSTEM.md` and
`docs/ARCADE_CONTEST_FOR_CONTENT_TEAM.md`.** If this file and a draft disagree, this file wins; if it is silent, ask the owner (Ali).

Claude Code cannot message other agents directly. It can only read and write this repo, so this file is the handoff.

## How to ask the developer side something
Open a GitHub issue in AliGoldie/munchieskk titled `Content question: ...`, or add a line under "Open questions" below in a pull request.
The developer side reads these when Ali opens a session, so do not wait on an answer for anything urgent: ask Ali.

## Rules for content (always true)
- Say **Order Points** for the points customers spend (names may change, see below). Arcade Score is a game score and cannot be spent.
- Games give **no points per run**. The only game-linked payout is the weekly goal.
- No "free burger" reward exists for points. Never promise a reward not in `docs/POINTS_SYSTEM.md`.
- Do not mention a "top spender" prize: it was removed.
- Never promise an opening date or a prize pickup date. Say "prizes are collected after we open, details to follow".
- Wording is "sliders/packs", never "tray". Never say "smash burger". Catering is off.

## Changelog (newest first)
- **15 Oct 2026** Arcade Score cap is **5,000 per game** (max 15,000), live on the database. Ties go to whoever reached the score first.
- **15 Oct 2026** Home and Loyalty pages now show "points to your next reward" and "about N more orders".
- **14 Oct 2026** The monthly top-spender prize was **removed** from the app. The only monthly prize is the arcade contest.
- **14 Oct 2026** Points are paid **when the order is collected** (order points + 6), not when it is placed. Cancelled orders earn nothing.
- **14 Oct 2026** Double order points **Tuesday to Thursday** (the owner can switch it off).
- **14 Oct 2026** Friend referral: inviter +150 and friend +30, both after the friend's first collected order of RM20 or more.

## Decisions still open (do not publish these)
- **Contest dates:** planned 1 Nov to 1 Dec 2026 (Malaysia time). Winners announced 1 Dec.
- **Days to claim:** the docs say 60. The developer recommended **90** because the opening may slip. Ali to confirm which.
- **Opening date:** unconfirmed (mid-November at the earliest, 1 December at the latest, pending the council health approval).
- **Names of the two point types** (for example "Munchies Points" and "Munch Score"): not decided. Keep "points" and "Arcade Score" until Ali picks.
- **Weekly goal bonus** (25 points now, finance suggests 15) and the **Mushy2 / platter prices**: not decided.
- Contest prize cost and the RM19 figure: internal. Do not publish.

## Open questions
(Add questions here, newest first.)
