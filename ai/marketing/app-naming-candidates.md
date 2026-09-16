# App naming candidates

**Status: research findings, not a decision.** Adopting a name here does not itself change
`app.json`'s `expo.name`/`slug`/`scheme` or anything in `ai/kb/` — that's a separate follow-up step.

**Date:** 2026-09-16. Uniqueness results are a snapshot of the App Store / Play Store catalog on
that date and will drift — re-check before actually committing to a name.

**Grounded in:** [aso-keyword-research.md](aso-keyword-research.md)'s findings (the terms "shopping
list" / "shared" / "family" / "sync" / "offline" are the validated high-signal keywords) and the
current placeholder identity (`app.json`'s `expo.name: "Shopping List"`, never published, no
`ios.bundleIdentifier`/`android.package` set yet — nothing blocks a rename).

## Criteria

| Criterion | How it was checked |
|---|---|
| Length compliance | Character count against the verified 30-char iOS/Android title limit |
| Keyword fit | Does the bare name carry one of the five validated keywords from the ASO research? |
| Distinctiveness | Not a bare generic term already saturated by competitors (the current placeholder, "Shopping List", is exactly this trap) |
| Memorability | Short, pronounceable, spellable from hearing it once |
| Uniqueness | Live search against both stores' actual catalogs, not memory or assumption |
| Positioning fit | Read against the competitor snapshot — does it signal the app's real differentiator (shared/collaborative, general-purpose lists) without overclaiming an unshipped feature? |

## Raw candidates generated (24)

Across five axes, per the plan:

| Candidate | Axis |
|---|---|
| Listmate, ListHive, ListNest, Listro, Listful, Listwise, ListLoop | core noun + collaboration/brand modifier |
| CartSync, ListSync, SyncCart | compound of two validated keyword roots |
| Basketly, Housecart, PantryPal, CartHive, Cartloop | metaphor for the shared list/cart |
| Cartly, Groci, Grocerly, Housely | invented brandable word |
| QuickList, GroceryLoop, Famlist, Cartwise | simplicity/household angle |

## Uniqueness pass

Every candidate was checked against the **live** App Store catalog (iTunes Search API,
`country=us`) and, for survivors, the live Play Store search results page. A candidate was dropped
outright on an **exact** name collision with an existing app; a near-miss (same root, different
word) is flagged but not automatically disqualifying.

| Candidate | App Store result | Play Store result | Verdict |
|---|---|---|---|
| Listmate | Exact collisions: "My ListMate", "ListMate: Make Lists Together", "ListMate - Lists & Recipes" | not checked | **Dropped — saturated** |
| ListHive | No exact match | **Exact collision: "ListHive" (App Tools Team)** | **Dropped — taken on Android** |
| ListNest | Exact collision: "ListNest - רשימת קניות משותפת" (a Hebrew-market shared-shopping-list app, same concept) | not checked | **Dropped — exact concept collision** |
| Listro | Exact collisions: "Listro", "Listro AI" | not checked | **Dropped** |
| Listful | Exact collision: "Listful - Wishlist & Shopping" (company is literally "Listful LLC") | not checked | **Dropped** |
| Listwise | No exact match (closest: "Listwise: AI Checklist Planner", different niche) | not checked | Kept as low-priority backup, not shortlisted (weak keyword fit — reads as a decision-making pun, not a list app) |
| ListLoop | No exact match | **No exact match ("No results for ListLoop")** | **Clean on both stores — shortlisted** |
| CartSync | No exact match | **Exact collision: "CartSync" (CnC Soft, unrelated booking/business tool)** | Different category, but taken — **flagged, not shortlisted as #1-eligible** |
| ListSync | No exact match | not checked | Backup, not shortlisted (reads as a feature name, not a brand — see Listwise-style concern) |
| SyncCart | No exact match | not checked | Backup |
| Basketly | Exact collisions: "Basketly", "Basketly: Smart Shopping Lists" | not checked | **Dropped** |
| Housecart | No exact match | not checked | Backup — weak keyword fit (no "list"/"grocery"), thematically strained |
| PantryPal | Exact collisions: 5 different "PantryPal" apps already exist | not checked | **Dropped — saturated** |
| CartHive | No exact match | Near-miss only: "Cardhive - Gift Card Cashing" (different word, unrelated category) | **Clean enough — shortlisted** |
| Cartloop | No exact match | not checked | Backup |
| Cartly | Exact collisions: "Cartly+", "Cartly Shopping List", "Cartly: Grocery List", "Cartly - The Grocery List" | not checked | **Dropped — saturated, same niche** |
| Groci | Near-collision: "Groci Online" (same root) | not checked | Backup, moderate risk |
| Grocerly | Exact collisions: "Grocerly: AI Recipe & Grocery", "Grocerly — Shopping List" | not checked | **Dropped** |
| Housely | No exact match, but results were entirely unrelated apps | not checked | Dropped for weak fit, not collision — doesn't evoke shopping/lists at all |
| QuickList | Exact collisions: "QuickList: Smart Grocery List", "QuickList: Shopping List" | not checked | **Dropped — same niche** |
| GroceryLoop | No exact match | **No exact match ("No results for GroceryLoop")** | **Clean on both stores — shortlisted, top pick** |
| Famlist | Near/exact collision: "Fam List", "Famlist: Pantry Organizer" | not checked | **Dropped — too close** |
| Cartwise | Exact collisions: "Cartwise Grocery List", "CartWise - Value Path" | not checked | **Dropped** |

**16 of 24 raw candidates were exact or near collisions** — a useful data point on its own: this
naming space (short, list/cart/grocery-themed words) is heavily picked over, which is exactly why
the live check mattered more than a plausibility read.

## Scored shortlist

Only candidates with **no exact collision on either store** advanced:

| Candidate | Chars | Keyword fit | Distinctiveness | Memorability | Positioning fit |
|---|---|---|---|---|---|
| **GroceryLoop** | 11/30 | "Grocery" (validated keyword) | High — clean on both stores | High — "loop" reads naturally, no forced spelling | Strong: "loop" doubles as recurring-errand and "keep everyone in the loop" (realtime), but narrows scope to groceries specifically |
| **ListLoop** | 8/30 | "List" (validated keyword) | High — clean on both stores | High | Strong: same "in the loop" narrative as GroceryLoop, without narrowing to groceries — better match for the app's actual general-purpose-list scope |
| **CartHive** | 8/30 | "Cart" (adjacent to validated keywords, not itself one of the five) | Good — one near-miss typo-neighbor in an unrelated category | Good — "hive" reads as collaborative | Moderate: "cart" leans toward a single checkout rather than an ongoing shared list; "hive" carries the collaboration signal instead |

## Recommendation

### #1 — GroceryLoop

- **Cold read:** yes — "grocery" + "loop" reads as a recurring shared grocery list to someone with
  zero context, on first hearing.
- **Trade-off:** most keyword-aligned and cleanest positioning of the three, but the name commits
  the product to a groceries-first identity even though the shipped feature set (`scope-boundaries.md`)
  is general-purpose named lists, not groceries-specific. If the product is meant to stay
  general-purpose in practice (not just in the schema), this is worth weighing before committing.
- Suggested iOS subtitle (30/30 chars): **"Grocery Lists, Shared & Synced"**
- Suggested Android short description (76/80 chars): **"Shared grocery lists that sync instantly and work offline for any household."**

### Runner-up 1 — ListLoop

- **Cold read:** partial — "list" signals lists clearly, but nothing in the bare name says
  *shopping/grocery* specifically; a cold listener would guess "some kind of list app" and need the
  subtitle to narrow it.
- **Trade-off:** keeps the general-purpose positioning the product actually has, at the cost of
  being one step more abstract than GroceryLoop — the subtitle has to do more work to signal
  "shopping list app" on its own, since "loop" alone doesn't say what kind of list.
- Suggested iOS subtitle (30/30 chars): **"Shared Lists for Home & Family"**
- Suggested Android short description (78/80 chars): **"Shared shopping lists that sync instantly and work offline, for any household."**

### Runner-up 2 — CartHive

- **Cold read:** weak — "cart" alone reads more like a checkout/e-commerce app than an ongoing
  shared list; "hive" adds a collaborative feel but a cold listener would not guess "shopping list"
  without the subtitle doing most of the work.
- **Trade-off:** most distinctive/brandable-sounding of the three, but "cart" is the weakest
  keyword fit against the validated ASO research (it's not one of the five terms that competitor
  data actually validated), and it carries a one-letter-off neighbor ("Cardhive") in an unrelated
  category worth a second look before committing.
- Suggested iOS subtitle (29/30 chars): **"Shared Shopping Lists, Synced"**
- Suggested Android short description (75/80 chars): **"A shared shopping list for your household - synced live, works offline too."**

## Trademark check (2026-09-16)

Checked for all three shortlisted names: the live USPTO trademark database
([tmsearch.uspto.gov](https://tmsearch.uspto.gov/search/search-information)), both as the exact
combined wordmark and as a spaced two-word search (which the tool resolves as a broader
word-component match, useful for catching a registration filed with different spacing/casing), plus
a general web search for existing businesses trading under the name outside of any formal filing.

| Candidate | USPTO federal registration/application | Existing business already using the name |
|---|---|---|
| **GroceryLoop** | None found (exact or component search) | None found |
| **ListLoop** | None found (exact or component search) | **Yes** — `listloop.com` (an active email/newsletter publishing service) and `listloop.net` (a local-classifieds site) both currently trade under this exact name |
| **CartHive** | None found (exact or component search) | **Yes** — "Cart Hive Ltd." (a UK sales-funnel/CRM company), `carthiveonline.com`, and a live Shopify storefront (`cart-hive-shop.myshopify.com`) all currently trade under this exact name |

**This changes the picture from the store-uniqueness pass alone.** None of the three has a
registered or pending US trademark, so there's no formal registration blocking any of them — but
ListLoop and CartHive are both already in active use by real, unrelated businesses, which is exactly
the kind of common-law naming conflict a trademark search (rather than just an app-store search)
exists to catch. **GroceryLoop is the only one of the three with no evidence of any prior claim,
formal or informal**, which meaningfully strengthens it as the top pick rather than just the
first-listed option.

One secondary note from the component search: the word "LOOP" alone is heavily used as a mark in
commerce/fintech (Loop Commerce, LoopPay, Loop Wallet, Loop Technology, Loop Mobility, Loop
Communications). None of these overlap with "GroceryLoop" as a combined mark, but it's a crowded
neighboring space worth knowing about if a formal trademark application is ever filed.

## Additional candidate checked on request: "Same List"

Checked 2026-09-16 against the same battery as the shortlist above, after the original 24 were
generated:

| Check | Result |
|---|---|
| App Store (iTunes Search API, `country=us`) | No exact match for "Same List" or "SameList" |
| Play Store (live search) | No exact match |
| USPTO (exact wordmark, both "SameList" and "Same List") | No results found |
| USPTO (component search) | No combined "SAME LIST" mark; component hits only on "SAME" (SAME LLC, SAME-S.P.A., Same Swim, Same Same Creamery) and "LIST" (List Realty, List Holding AG) separately |
| General web search | **"SameList" is a live, named product** — a privacy-first mailing-list comparison tool at `samel.ist`, with an explicit "© 2024 SameList. All rights reserved." notice. Different category entirely (B2B email/marketing tooling, not shopping lists), so direct app-store confusion is unlikely — but it is a real, active common-law use of the exact name. (The plain `samelist.com` domain is unused — parked for sale on GoDaddy.) |

**Verdict:** clean on both app stores and at the USPTO, same as GroceryLoop — but unlike
GroceryLoop, it is **not** clean on the general-web check: an existing company already trades under
this exact name today, just outside the shopping-list category. That puts it in the same bucket as
ListLoop and CartHive (no formal registration, but real prior use), rather than joining GroceryLoop
as fully unclaimed. Keyword-fit note: "Same List" doesn't contain any of the five validated ASO
keywords, but it does capture the sharing feature conversationally — "everyone's on the same
list" — which is the same framing OurGroceries' own tagline uses ("everyone can share the same
grocery list"), so the concept is validated even though the literal string isn't a new keyword win.

## Additional candidates checked on request: "SameShopping" and "ShoppingHive"

Checked 2026-09-16 against the same battery as above:

| Check | SameShopping | ShoppingHive |
|---|---|---|
| App Store (iTunes Search API, `country=us`) | No exact match | No exact match |
| Play Store (live search) | No exact match | No exact match, but a close neighbor: **"ShopHive"** (MCOM) — same concept, one syllable shorter |
| USPTO (exact wordmark, combined and spaced) | No results found | No results found |
| General web search | No exact existing business found (near-misses only: "SAME shopping mall," "SameShop," "SameSame Shop" — none is the same string) | **Heavily taken** — multiple real e-commerce businesses already trade as "Shopping Hive": `shoppinghive.co.uk`, `theshoppinghive.com`, an eBay store (`ebay.com/str/shoppinghive`), and a Twitter/X account (`@shoppinghive`) |

**SameShopping — verdict: clean on every check**, on par with GroceryLoop as one of the least
contested candidates found so far. Positioning caveat, independent of collision risk: "shopping" as
a mass noun doesn't pair with "same" as cleanly as "list" does — "we're on the same list" reads
naturally, "we do the same shopping" is vaguer and doesn't as clearly evoke *one shared list two
people edit*. Would lean harder on the subtitle to carry the concept than "Same List" does.

**ShoppingHive — verdict: dropped.** It clears the app-store and USPTO checks, but it's already the
active trading name of multiple unrelated retail businesses (UK, eBay, social) — a denser and more
directly on-topic (retail/shopping) common-law conflict than anything else checked in this document,
including ListLoop and CartHive's single-business collisions.

## Additional candidate checked on request: "ShoppingLoop"

Checked 2026-09-16 against the same battery as above:

| Check | Result |
|---|---|
| App Store (iTunes Search API, `country=us`) | No exact match |
| Play Store (live search) | No exact match (closest neighbors are unrelated: "Loop: Fashion & Home", "Loopers.shop" — different names, different concepts) |
| USPTO (exact wordmark, combined and spaced) | No results found |
| General web search | No exact business found. Nearest neighbors are all different concepts: physical shopping centers branded "The Loop" (Chicago, Methuen MA, Kissimmee FL — real-world malls, unrelated category), and "Shoploop," a discontinued Google Area 120 video-shopping project (different spelling, different word order) |

**Verdict: clean on every check — the strongest result of any candidate checked so far**, alongside
GroceryLoop and SameShopping. It also has the best combined keyword fit of the three "Loop" names:
it carries **"shopping"**, the single generic term the Keyword Planner data confirmed reads
naturally worldwide (unlike "grocery," flagged as American-specific), plus the same "everyone's
kept in the loop" realtime/collaborative metaphor already validated by GroceryLoop and ListLoop —
without GroceryLoop's narrowing to groceries specifically, and without ListLoop's vagueness about
what kind of list. This makes it a genuine rival to Same List for the top recommendation, on
different grounds: Same List wins on "shared" (the single best-validated qualifier) and on being
independently found by two unrelated research methods; ShoppingLoop wins on carrying the single
best-validated *base* term plus a clean, cross-platform, cross-search-engine record with literally
no prior use found anywhere.

## Open risks

- **This is a USPTO federal search plus a general web check, not a legal opinion.** It does not
  cover state-level trademark registrations, foreign trademark offices (relevant since "Cart Hive
  Ltd." above is UK-based), or a full common-law use search. Get a real trademark attorney's opinion
  before committing to any of these, especially before spending money on branding or filing.
- **Domain and social-handle availability were not checked** for any candidate — do that before
  finalizing. For ListLoop and CartHive, the domains found above are already taken by the existing
  businesses; GroceryLoop's domain/handle availability is still unverified either way.
- **Store locale skew:** the Play Store searches in this research resolved to a Poland/English
  storefront (the signed-in Google account's locale), not a US storefront. The app population and
  naming patterns observed are unlikely to differ meaningfully by locale, but re-verify on a US
  storefront (or logged-out) before finalizing.
