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
- **Weekly goal:** 1,000 Arcade Score in a Monday to Sunday week gives **+25 points**, once a week. Accounts under 30 days old qualify freely. **Older accounts need a collected order in the last 30 days** (the owner's rule: stay active to keep earning it), and each account gets at most **4 goal bonuses per calendar month**. The app cannot take orders before the shop opens, so an account older than 30 days has no recent order until its first collected order after opening. Safe wording: "New accounts can earn it in their first 30 days. After that, order and collect within the last 30 days to keep earning it." Do not promise it to everyone.
- **Decided (16 Oct): days to claim a contest prize = 90**, counted from the win (1 Dec), so about 1 March. You may publish "90 days to claim". The claim also needs an order of RM10 or more.
- **Top-spender monthly prize: removed.** The arcade contest is the only monthly prize.
- **Progress display:** Home and Loyalty show points to the next reward and "about N more orders".

## Decisions still open (do not publish)
- **Contest dates:** planned 1 Nov to 1 Dec 2026 (Malaysia time), winners announced 1 Dec.
- **Opening date:** unconfirmed (mid-November at the earliest, 1 December at the latest, pending council health approval). Never promise a date.
- **Phone number for the contest:** DECIDED, see the note below. Still do not claim strict "one entry per person".
- **Names of the two point types:** **LIVE since 20 Oct 2026** (confirmed on the live site). Spendable = **Monsta Coins**; game tally = **Burger XP**. Use these names in all posts. Staff-only Admin screens still say "points".
- **Weekly goal size** (25 now, finance suggests 15) and **Mushy2 / platter point prices:** not decided.
- Contest prize cost and the RM19 figure: internal.

**Phone number note.** Phone is **optional at sign-up** (sign-up is email, password, name, optional phone). The contest rule "one account per phone number" only applies to accounts that gave a phone. Someone can enter with an email-only account, and one person could in theory make several. So a phone number is **not required to enter or win**. Winners are checked at the counter. Say "one prize per person", not "one account per phone". **Decided 16 Oct 2026: a winner must add a phone number before the claim code is shown** (code ready in the repo, goes live once Ali runs the database update; until the content team is told it is live, do not publish it as active). Sign-up stays unchanged (phone optional). Safe wording: "Winners add a phone number so we can contact them about their prize." Do not say a phone is needed to play or enter.

## Changed since last sync
- **20 Oct 2026** Loyalty page polish: the rank perks are now an organized grid of tiles (icon, rank, how often, order minimum, and a status tag: Ready at checkout / Used for now / Unlocks at <rank> / Add your birthday), and a rank-up message appears once after reaching a new rank. Profile now shows "My Monsta Coins".
- **19 Oct 2026** Answered content issue #123. The two currencies are renamed: spendable **points -> Monsta Coins**, game **Arcade Score -> Burger XP**. Customer pages, games and the rank card are done; Admin screens still say "points" internally (staff only, a later tidy-up). Only the labels changed: the database, the contest, the weekly goal, the rank bonus and the maths are unchanged. **LIVE 20 Oct 2026**, confirmed on the live site. A follow-up the same day fixed spots that still said "points"/"pts" (Profile, Home, checkout, games, item pop-up, share upload) and made the Loyalty page cards readable.
- **16 Oct 2026** Weekly goal rule tightened (pending Ali running the SQL): after the first 30 days an account needs a **collected order in the last 30 days** (was: any collected order ever), and at most **4 goal bonuses per calendar month**.
- **16 Oct 2026** New ranks are built (pending Ali running the rank SQL; announce nothing until this file says it is live): Regular RM100, Pro RM300, Master RM600, Ultimate RM1,200 lifetime spend on collected app orders. Bonuses +5/+8/+12% and monthly reward limits (1/2/3/4/5) unchanged. Ranks never go down. Perks (paid order, one reward per order, order RM20+, RM30 for the platter, no points, do not use the monthly limit): Regular free Cheese (once); Pro birthday Ice BB (once a year, birthday month, month and day only, optional); Master free Egg (every month); Ultimate free Kawan MONSTA platter (once a year). Rank-up message and "RM to next rank" show in the app.
- **16 Oct 2026** NEW RULE for everything we publish: never describe what is inside our patties (no ingredients, seasoning, blend, fillers or weights). Owner decision: naming the origin ("NZ lamb", "premium Australian beef") and words like "handcrafted" and "premium" are fine, and can be mixed across posts. Sizes and weights are never published; they stay behind the scenes.. Live menu text: Mushy2 showed a weight, so it is changed to "handcrafted premium Australian beef patty"; BBQ Lamb now says "New Zealand lamb" instead of "NZ lamb" (both pending Ali running the SQL). BBQ Chicken keeps "Teriyaki-marinated" (owner: fine either way). Origin wording on the other items is allowed.
- **16 Oct 2026** Developer added a "launch profile v2" switch (Rewards Plan v2 values: weekly goal 10, Ice BB 250, Mushy2 500, platter 2,000, ranks at RM100/300/600/1,200). It is **OFF**. Nothing above changed. Announce nothing from Plan v2 until this file says the switch is on.
- **16 Oct 2026** The contest card now says "One prize per person" (was "One account per phone number"). The Admin form now defaults to **90 days to claim**. Every prize in a contest shares the same claim window.
- **16 Oct 2026** Ali decided **90 days to claim**.
- **16 Oct 2026** Phone number required to claim a contest prize (winners without one are asked to add it before their claim code appears; staff cannot mark a prize claimed without it). Pending Ali running the SQL.
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
