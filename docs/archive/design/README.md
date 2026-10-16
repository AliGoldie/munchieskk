# Design reference — Munchies KK

**→ Read `START-HERE.md` first.** It has the build order, the pre-flight checks, and a
paste-ready opening prompt for a coding agent.

Drop this folder into the repo at `docs/design/`. Nothing here is imported by the app;
it is the visual source of truth the build briefs point at.

| File | What it is |
|---|---|
| `Munchieskk Admin Console.dc.html` | Admin console, 13 tabs — the spec for `HANDOFF-ADMIN-CRM.md` |
| `Munchieskk Site v4 Screens.dc.html` | All 11 routes in the v4 dark language |
| `Munchieskk Website Mockup v4.dc.html` | v4 dark landing page |
| `Munchieskk App Mockups.dc.html` | Original 380px app screens (already committed) |
| `HANDOFF-ADMIN-CRM.md` | Build brief: admin CRM upgrade |
| `HANDOFF-V4-DARK.md` | Build brief: v4 dark restyle |
| `HANDOFF-PROMPT.md` | Build brief: original app restyle |
| `support.js` | Runtime the `.dc.html` files load — keep it beside them or they render blank |

Open any `.dc.html` directly in a browser. They are self-contained apart from `support.js`.
