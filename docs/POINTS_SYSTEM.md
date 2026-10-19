# MunchiesKK points system: brief for the content team

Updated 14 Oct 2026 from the live app and database. Numbers can change: check
with the owner before printing anything permanent. Items marked
**(confirm live)** need the owner's OK before you announce them.

## The one-line version

**Earn points on every order you collect, plus bonus points for sharing and inviting
friends. Spend them on free food. Rank up the more you order. Play the arcade to win
monthly prizes.**

## Step by step: what happens to one customer

1. **Sign up** (free). Nothing is paid yet. If a friend invited them, the link or code is saved.
2. **Place an order in the app.** The payment page shows the points they will earn
   (1 point per RM1, **double on Tuesday to Thursday**, plus a rank bonus once they are Pro or higher).
   No points are paid at this step.
3. **Collect the order.** Only now the points are added: the order points **plus 6 bonus points**.
   If the order is cancelled before collection, no points were ever added, so nothing is lost.
4. **Share the meal** (optional): **+20** after sharing, **+20 more** if a screenshot of the public post is approved.
5. **Invite a friend** (optional): when the friend's **first collected order is RM20 or more**,
   the inviter gets **+150** and the friend gets **+30**.
6. **Spend points** at checkout on the Prize Vault (Free Cheese 50, Free Egg 60, **Free Fries 100**, and more).
7. **Play the arcade** (optional): games give **no points per run**. They build an **Arcade Score**.
   Reaching **1,000 in a week = +25 points**. The **top 3 in the month win free food**.
8. **Rank up**: lifetime spend on collected orders decides the rank (Rookie to Ultimate), which adds bonus points.
9. **Stay active**: points fade only after 12 months with no activity, 25% a month. Any order stops it.

## How customers EARN points

| How | Points | Rules to mention |
|---|---|---|
| **Order in the app** | **1 point per RM1 spent** | Food total actually paid. Orders must be placed in the app (munchieskk.my). Counter sales rung up in Loyverse do not earn app points. **The points are added when the order is collected**, not when it is placed. A cancelled order earns nothing. |
| **Double points days** | **2x order points on Tuesday, Wednesday and Thursday** | Based on the day the order is placed (Malaysia time). The owner can change the days or switch it off, so confirm before posting. Rank bonus is added on top. |
| **Collect your order** | **+6** | Once per order, paid together with the order points when the order is collected. |
| **Share your food** | **+20** | Tap Instagram / Facebook / TikTok after collecting. Once per order. |
| **Share + screenshot** | **40 in total** (+20 more) | Upload a screenshot of the public post (tag @munchieskk). Points are added after we approve it. Send it within 14 days of the order. |
| **Invite a friend** | **+150 for you, +30 for them** | Friend signs up with your link or code. The 150 is paid when their **first collected order of RM20 or more** is done. Max 5 friends per person. **The friend's 30 points are paid at the same moment**, after their first collected order of RM20 or more (not at sign-up). |
| **Rank bonus** | **+5% / +8% / +12%** extra points on every order | Pro / Master / Ultimate ranks only (see Burger Ranks). |
| **Play the arcade (T-Rex Runner, Speed Grab, Munch-Man)** | **No loyalty points per run or win.** Your runs build your **Arcade Score** (see below). | Reach the weekly goal for **+25 points**; top scores win free food. |

**Arcade bonus rules (say this clearly):**
- The only loyalty points from games are the **+25 weekly goal bonus** (once a week).
- **New accounts qualify freely for their first 30 days.** After that, the weekly goal bonus needs a collected order in the last 30 days. At most 4 goal bonuses per account per calendar month (setting `goal_max_per_month`).
- Munch-Man gives one free play a day. Game days reset at **8:00 am Malaysia time**. The daily streak is just a badge now.

## How customers SPEND points

Rewards in the Prize Vault (confirm the current list in Admin > Prizes before
announcing; rewards show "Out of stock" until the item is back in stock):

| Reward | Points | Minimum order |
|---|---|---|
| Free Cheese (add-on) | **50** | RM20 |
| Free Egg (add-on) | **60** | RM20 |
| FREE FRIES | **100** | RM20 |
| Ice BB | **350** | RM20 |
| Free Mushy2 | **800** | RM20 |
| Free Kawan MONSTA platter | **3,000** | RM30 until 31 Dec 2026, then to be reviewed |

**Claim at checkout.** On the payment page, tick "Use your points" and pick one
reward. It is added to the order at **RM0.00** (or as a free add-on on a
burger). Points are taken when the order is placed and **given back if the
order is cancelled**. **One reward per order**, and only when the order is placed.

**Claim at the counter (older way).** In Loyalty tap Redeem, get a 6-character
code, show it at the counter after paying. A reward not collected within
**14 days** expires and the points go back.

## Arcade Score, weekly goal and the monthly arcade contest (new)

**Arcade Score is not points.** It cannot be spent. It only decides the contest ranking and the weekly goal.
Say it that way: *points buy food, Arcade Score wins prizes.* It applies to all three arcade games
(T-Rex Runner, Speed Grab and Munch-Man).

- **What counts:** your **best score in each of the three games, added together**. Each game counts **at most 5,000** (so 15,000 is the top Arcade Score). Playing more only helps if you beat your best.
- **Three lives** in every game: a crash costs a life, and the run carries on.
- **Weekly goal:** reach **1,000 Arcade Score in a week** (Monday to Sunday, Malaysia time) for **+25 loyalty points**, once a week.
  Because all three games add up, the goal is easy to reach. That is on purpose. (After the first 30 days, game bonuses need a collected order in the last 30 days.)
- **Monthly arcade contest:** one contest a month, running the whole calendar month. The **top 3** win free food
  (the plan: 1st a burger, 2nd fries, 3rd a drink; the owner can change the prizes for each contest).
  - Ties go to whoever reached their score first. **One account per phone number.** A minimum score applies (300 by default).
  - Winners are picked automatically when the contest ends. Only **first names** are shown. Winners show a claim code at the counter
    (claimed **with any order of RM10 or more**; the claim window is set per contest: **90 days** for the November contest).
  - Scores are checked: impossible scores are not counted, and staff check the top players in person.
- **Munch-Man matches the other two games:** no points for a win or a streak (the streak is only a badge). Its score counts toward Arcade Score.
- **Do not say** that T-Rex Runner or Speed Grab give loyalty points for every personal best. They no longer do.

For the full plain-language explanation, see `docs/ARCADE_CONTEST_FOR_CONTENT_TEAM.md`.

## Burger Ranks

A customer's rank comes from their **lifetime spend on collected orders**
(refunds subtracted). **Games, shares and referrals never change a rank.**

| Rank | Lifetime spend | Rewards per month | Bonus points on orders |
|---|---|---|---|
| Rookie | RM0 | 1 | none |
| Regular | RM100 | 2 | none |
| Pro | RM300 | 3 | +5% |
| Master | RM600 | 4 | +8% |
| Ultimate | RM1,200 | 5 | +12% |

(These thresholds were approved on 16 Oct 2026 and go live when the owner runs the rank SQL; the older ladder was RM200 / 850 / 1,500 / 3,000.)

**Ranks never go down.** The app remembers the highest rank a customer reached. A refund, or a later change to the thresholds, never takes a rank away.

**Rank perks.** Claimed on a paid order at checkout, as the one reward for that order (order RM20 or more, RM30 for the platter). A perk costs no points and does **not** use up the monthly rewards. A higher rank keeps the lower perks. Cancelling the order gives the perk back.

| Rank | Perk | How often |
|---|---|---|
| Regular | Free Cheese add-on | once |
| Pro | Birthday Ice BB | once a year, in the birthday month (month and day only, optional, saved once) |
| Master | Free Egg add-on | every month |
| Ultimate | Free Kawan MONSTA platter | once a year |

- Rewards per month counts claims in a calendar month (Malaysia time). A cancelled claim gives its slot back.
- Cancelling an order takes back exactly the points it earned, bonus included.
- The app shows each customer their own rank, progress to the next one and the full ladder in a pop-up. (Do not post the thresholds as a public leaderboard.)

## Points expiry (new)

- Points **expire only if the account is inactive for 12 months**. An order, a game score or claiming a reward each restart the clock.
- It is **gradual, not a sudden wipe**: after 12 months of no activity, the balance drops by **25% a month** until it is gone (4 months). **Any order stops it straight away.**
- We remind customers: a banner in the app from month 11, and a personal WhatsApp message from us for customers who left a phone number.
- **Rank never expires** (it is based on spend). Only the points balance fades.

Safe wording: "Points expire after 12 months of no activity. Order once a year and you never lose a point."

## Handy examples (all real, safe to use)

- "Spend RM25, earn **25 points**. Collect it for **6 more**. That is 31 points from one burger meal. On a **Tuesday to Thursday** it is **56**."
- "Share your meal for **20 points**, send us the screenshot and make it **40**."
- "Bring a friend: you get **150**, they get **30** to start."
- "**Free fries** from just **100 points**. **Free egg** from 60."
- "Ice BB for **350 points**. The big one: a **Kawan MONSTA platter** for **3,000**."
- "New here? Play the arcade free and chase the weekly goal for bonus points while you wait."

## Install the app (new)

On the order page and the Profile page there is an **Install app** button. One tap puts the MunchiesKK icon on the phone's home screen.
On iPhone the app shows a short hint (Share, then Add to Home Screen). Nothing is downloaded from an app store.

## Do NOT promise or mention

- **Bronze / Silver / Gold** or any perks not listed above. The ranks are Rookie, Regular, Pro, Master, Ultimate.
- **A free burger.** No plain burger reward exists. Only the items in the table above.
- **Points for counter (Loyverse) purchases.** Only app orders earn points for now.
- **"Points never expire."** They fade after 12 months of no activity (above).
- **Points for every game win, or a streak bonus.** Games only pay through the weekly goal.
- **Any reward, price or discount not in this document.** No "RM5 off" or percent-off codes for points.
- **A rank leaderboard or other customers' spend.** Monthly winners are first name only.
- **A "top spender" monthly prize.** It has been removed. The only monthly prize is the arcade contest.

## Best days to push

Weekdays are the quietest, so **Tuesday to Thursday double points** is the natural promotion.
It is on now, but the owner can switch it off or change the days in Admin, so confirm before posting.

## Before you post

Ask the owner to confirm the latest update is live (points at collection, double
points days, ranks, 12-month expiry, fries at 100, the November arcade contest) and that stock is back on, because rewards show
"Out of stock" while the shop is closed or an item is at 0.
