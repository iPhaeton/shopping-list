# ASO keyword research

**Status: research findings, not a decision.** This does not itself change `app.json`,
`expo.name`, or anything in `ai/kb/`. It exists to ground a future store-listing decision in real
search behavior instead of guesswork.

**Date:** 2026-09-16. Store search results and rankings drift — treat anything here as a snapshot,
not a permanent fact, and re-run the live lookups before actually writing store copy.

**Scope assumed:** general-purpose shared shopping list (not pet-specific), targeting the
English/international market. Feature set as of `ai/kb/entries/scope-boundaries.md` (step 11):
multiple named lists, add/tick items, offline-first writes via an outbox, sharing at
reader/writer/owner via email invite, realtime sync (~1s), soft-delete/bin/restore, item rename,
pagination.

## Platform rules snapshot

Verified by web search on 2026-09-16 (not assumed from memory):

| Platform | Field | Limit |
|---|---|---|
| iOS (App Store Connect) | App Name | 30 characters |
| iOS | Subtitle | 30 characters |
| iOS | Keywords field (hidden, comma-separated) | 100 characters (Apple specifies 100 *bytes*; accented/non-Latin characters cost more than 1 byte) |
| Android (Play Console) | App title | 30 characters |
| Android | Short description | 80 characters |
| Android | Full description | 4,000 characters |

Sources: [App Store & Google Play Character Limits (2026) – AppStyle](https://www.appstyle.dev/blog/app-store-character-limits/),
[App Store App Name, Subtitle, Keywords: 30/30/100 – AppScreenshotStudio](https://appscreenshotstudio.com/blog/app-store-metadata-for-indie-devs-title-subtitle-keywords-2026),
[App Store Metadata Character Limits 2026 – AppLaunchFlow](https://www.applaunchflow.com/blog/app-store-metadata-character-limits-2026),
[Google Play Short Description Guide – WhixFrame](https://www.whixframe.com/blog/google-play-short-description-guide),
[Google changed character limit for App title – dgtlmart](https://dgtlmart.com/blog/google-changed-character-limit-for-app-title-in-google-play-store/).
No discrepancy found against the commonly-assumed ~30/30/100/80 figures.

## Live search results

Two independent sources, both queried live on 2026-09-16:

- **Google Play** — actual store search results pages, via browser (`play.google.com/store/search`).
  Store locale resolved to Poland/English; titles/rankings for a US-locale user may differ slightly,
  but the app set and naming patterns are the same population.
- **Apple App Store** — the public iTunes Search API (`itunes.apple.com/search`), `country=us`,
  which mirrors real App Store search relevance for a given term.

### Generic core queries

| Query | Store | Top results (title as displayed) |
|---|---|---|
| `shopping list` | Play | Shopping List - Listonic, Bring! Grocery Shopping List, That Shopping List PRO, Shopping List • Listic, AnyList: Grocery Shopping List, Our Groceries Shopping List, Widget List - Shopping List, Enchlist: Shopping List, Shopping List (Kiwi3), Shopping list — Lister, Shopping List & Calculator, Shopping List - Simple & Easy |
| `grocery list app` | App Store | AnyList: Grocery Shopping List, Our Groceries Shopping List, List Ease: Shared Grocery List, Shopping List - Grocery & Todo, Grocery List: Out of Milk, Grocery List - Listonic, Bring! Grocery Shopping List |

**Takeaway:** almost every top-ranked app's title literally contains "Shopping List" or "Grocery
[Shopping] List" — these two phrases are the highest-value literal keyword real estate in a title,
confirmed by observed ranking, not assumption.

### Feature-anchored queries

Each row is a query grounded in one specific shipped feature from `scope-boundaries.md` — a query
that can't be traced to a shipped feature or a captured result was not kept.

| Shipped feature | Query tested | Store | What it surfaced |
|---|---|---|---|
| sharing at reader/writer/owner, invite by email | `shared shopping list` | Play + App Store | Same core competitor set as above, plus `List Ease: Shared Grocery List`, `ShopList :Shared shopping list`, `Cozi Family Organizer` (adjacent — a family organizer app that bundles a grocery list) |
| sharing, multi-person households | `family shopping list app` | Play | Adds `Meal Planner & Grocery List`, and notably `Famcart: Family Grocery List` — a dedicated app naming itself directly for this exact angle |
| sharing, multi-person households | `family shopping list` | App Store | Adds `FamilyWall: Family Organizer` (adjacent, calendar+list bundle) |
| offline-first outbox (writes queued, retried) | `offline shopping list app` | Play | Surfaces **dedicated single-purpose apps ranking specifically on this term**: `Shopping List Offline`, `Shopping List – Offline` |
| offline-first outbox | `offline grocery list` | App Store | Surfaces `List Pro: Offline Shopping .`, plus `Grocery List with Sync` (see next row) |
| realtime sync (~1s propagation) | (found via the offline query above) | App Store | `Grocery List with Sync` (Buzzworthy Vibe Co.) is a real, live competitor whose entire name is built around "Sync" — direct evidence that "sync" is a keyword worth owning, not just a feature description |
| email OTP / no password | — | — | **Not tested.** Sign-in mechanics are not something a shopper searches for; deliberately excluded rather than invented (see Exclusions) |

### Excluded from query generation entirely

Per the plan, no queries were generated for **soft-delete/bin/restore, item rename, or pagination**.
These are internal mechanics invisible to someone deciding whether to download a shopping-list app —
nobody searches "shopping list app with tombstone restore."

## Competitor snapshot

Exact title strings and character counts pulled from the live iTunes Search API response (not
paraphrased from a blog), 2026-09-16, `country=us`:

| App | Title (exact) | Chars | Category (primary, secondary) | Positioning (from live description) |
|---|---|---|---|---|
| AnyList | `AnyList: Grocery Shopping List` | 30/30 (uses the full limit) | Productivity, Food & Drink | Meal planning + always-in-sync shared list; "the #1 app for busy families, couples" |
| Our Groceries | `Our Groceries Shopping List` | 27/30 | Shopping, Lifestyle | Simplicity + family framing: "the easiest way to manage your family's grocery shopping" |
| Bring! | `Bring! Grocery Shopping List` | 28/30 | Productivity, Lifestyle | Household sharing, explicitly "creating and sharing grocery store lists ... with your household" |
| Cozi | `Cozi Family Organizer` | 21/30 | Productivity, Lifestyle | Adjacent, broader: shared calendar + reminders + grocery list bundled into one family-org app, not list-first |

**Observation:** three of four top competitors list under **Productivity** (not **Shopping**) as
their primary category — worth a deliberate choice later rather than a default to "Shopping."
AnyList's title uses the full 30-character budget; Our Groceries and Cozi leave headroom, spent
instead on a stronger subtitle/short description.

## Keyword takeaways

Ranked by how directly each is grounded in both a shipped feature and observed real-world ranking
evidence:

1. **"shopping list" / "grocery list"** — the base term. Non-negotiable to include somewhere in
   title or subtitle; every serious competitor does.
2. **"shared"** — directly tied to the sharing feature (reader/writer/owner), and the term multiple
   competitors (`List Ease: Shared Grocery List`, `ShopList: Shared shopping list`) build their
   entire name around.
3. **"family" / "household"** — tied to the same sharing feature, from a different angle;
   `Famcart: Family Grocery List` and `FamilyWall` show this is an actively used positioning wedge,
   not a guess.
4. **"sync"** — tied to the realtime feature; validated by a real competitor (`Grocery List with
   Sync`) using it as the entire name, not just body copy.
5. **"offline"** — tied to the outbox/offline-first feature; validated by two dedicated competitor
   apps ranking specifically on this term (`Shopping List Offline`, `List Pro: Offline Shopping`).

## Exclusions

Cross-checked against `scope-boundaries.md`'s "still deliberately out" list (inviting a non-account
email, leaving a shared list, social sign-in, biometric unlock, passwords). None of the queries or
takeaways above imply any of these — nothing here should be used to justify store copy that
promises them.
