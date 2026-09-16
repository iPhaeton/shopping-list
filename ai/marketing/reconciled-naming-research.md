# Reconciled naming & keyword research

**Status: research synthesis, not a decision.** This does not itself change `app.json`,
`expo.name`, or anything in `ai/kb/`. It merges two independent research efforts that arrived at
this folder separately and reconciles where they agree, where one corrects the other, and what
that means for the naming decision.

**Date:** 2026-09-16.

## The two sources being reconciled

| | [aso-keyword-research.md](aso-keyword-research.md) + [app-naming-candidates.md](app-naming-candidates.md) | [keyword-research-2026-09-16.md](keyword-research-2026-09-16.md) |
|---|---|---|
| **Method** | Live App Store (iTunes Search API) + Play Store search results, read as ranking/competitor evidence; USPTO trademark database; general web search for prior use | Google Ads Keyword Planner "Discover new keywords", actual English/all-locations search-volume buckets and advertiser-competition scores, Sep 2025–Aug 2026 |
| **Strength** | Direct evidence of *who else already holds a name* (app-store collisions, federal trademarks, active businesses) — the diligence a name has to survive | Direct evidence of *how many people actually search* a given phrase and how competitive it is to rank for — real demand, not inferred from who happens to rank |
| **Blind spot** | Can mistake "a competitor app ranks on this term" for "people search this a lot" — App Store/Play Store surface low-volume terms too | Doesn't check whether a candidate name is already taken by an app, business, or trademark |

Neither source saw the other while it was produced — the agreement and disagreement between them
below is genuine cross-validation, not one echoing the other.

## Reconciled keyword findings

### Where they agree (mutually reinforcing)

- **"Shared" is the single best qualifier.** My competitor-ranking read flagged it because
  multiple apps build their entire name around it (`List Ease: Shared Grocery List`, `ShopList:
  Shared shopping list`). The Keyword Planner data independently confirms it with real numbers:
  1K–10K monthly volume at the **lowest competition of any qualifier tested (25)** — and calls it
  explicitly the "best fit for this app: real volume, lowest competition, matches the core
  feature." Two unrelated methods landing on the same word is the strongest signal in either
  document.
- **"Shopping list" / "grocery list" are both non-negotiable base terms.** Confirmed by ranking
  (nearly every competitor title contains one) and by volume (both cluster at 1K–10K, Low
  competition 27–33 per Keyword Planner). The Keyword Planner data adds a refinement mine didn't
  have: prefer **"shopping list" in the global/brand-facing name** since "grocery" reads as
  American wording, and place "grocery" in the subtitle/keyword field instead, where both markets
  are captured.

### Where the Keyword Planner data corrects the app-store-ranking read

- **"Offline" is not actually a keyword worth owning in the name.** My research treated it as a
  validated top-5 term because two dedicated competitor apps rank on it (`Shopping List Offline`,
  `List Pro: Offline Shopping`). The Keyword Planner data shows **`offline shopping list app` has
  no search volume data at all** — nobody is actually typing this. Those two apps exist and may
  even rank, but on a query essentially nobody uses. **Correction: offline-first is a feature worth
  a line in the store description, not a word worth spending name or title budget on.**
- **"Family" is a trap if used alone.** My research read `Famcart: Family Grocery List` and
  `FamilyWall` as validating "family" as a positioning wedge. The Keyword Planner data splits this
  in two: `family shopping list app` (app intent, Medium competition 40) is fine, but the shorter
  `family shopping list` / `family grocery list` (no "app") is **High competition (71–93)** because
  it's dominated by printable-list and budget-meal-plan content sites — people typing that phrase
  mostly don't want an app at all. **Correction: "family" needs an explicit "app" qualifier
  wherever it appears in copy, and is riskier as a bare brand-name word than the ranking evidence
  alone suggested.**
- **"Sync" is real but small.** Validated by both — a live competitor (`Grocery List with Sync`)
  builds its name around it, and the Keyword Planner confirms low competition — but actual volume
  is only 10–100/month. Worth having in body copy; not worth building the whole brand around.

### New from the Keyword Planner data (not covered by the app-store read at all)

- **Brand-search sizes for the field**, useful for knowing who has mindshare: AnyList (10K–100K),
  Listonic (1K–10K), OurGroceries (1K–10K), Bring! (100–1K). AnyList is the category leader by
  search volume, not just by app-store placement.
- **Names to actively avoid sounding like**: AnyList, Listonic, OurGroceries, Bring, Out of Milk,
  ListEase, Cozi, Listly — confusable with existing brand-search demand.
- **An adjacent-but-out-of-scope demand pocket**: "meal planning app with grocery list" (1K–10K,
  rising) and "recipe and grocery list app" have real, larger search demand than plain grocery-list
  terms — a future expansion direction, not a launch-positioning concern per `scope-boundaries.md`.

## Reconciled naming candidates

Every candidate either source considered, cross-checked against whatever the *other* source can
add:

| Candidate | Source | Keyword-demand fit | App Store / Play Store | USPTO / prior use | Status |
|---|---|---|---|---|---|
| **Same List** | Both, independently | Doesn't literally match a search cluster, but captures "shared" conversationally — the same framing as OurGroceries' own tagline ("everyone can share the same grocery list") | Clean — no exact match on either store | No USPTO registration; but **"SameList"** (no space) is a live B2B mailing-list comparison tool at `samel.ist` with an active copyright notice — different category, real prior use | **Independently recommended by both methods** — the single strongest convergent signal in either document, with one real but distant-category conflict |
| **GroceryLoop** | App-store/trademark research | Contains "grocery" (validated equal to "shopping list" in volume); does not contain "shared" (the highest-value qualifier) | Clean on both stores | No registration; **no existing business found anywhere** | Cleanest diligence result of any candidate, but misses the single best-validated keyword in the bare name |
| **ListLoop** | App-store/trademark research | Contains "list"; same "shared" gap as GroceryLoop | Clean on both stores | No registration; but `listloop.com` (email publishing) and `listloop.net` (classifieds) are active under this exact name | Real prior use, unrelated category |
| **CartHive** | App-store/trademark research | "Cart" isn't a term either data source validates as demand-backed | Clean (one near-miss: "Cardhive") | No registration; but "Cart Hive Ltd." (UK), `carthiveonline.com`, and a live Shopify store all trade under this name | Weakest keyword fit + real prior use |
| **ShoppingLoop** | App-store/trademark research | Contains "shopping" — the base term the Keyword Planner data confirms reads naturally worldwide (vs. "grocery"'s American skew); same "shared" gap as GroceryLoop/ListLoop | Clean on both stores | No registration; **no prior use found anywhere** — the only web hits are unrelated (physical malls branded "The Loop," and "Shoploop," a discontinued Google project with a different spelling) | **Cleanest diligence result of any candidate checked**, combined with the single best-validated base keyword — a genuine rival to Same List |
| **Shared List** | Keyword Planner research | Literal match to the best-validated cluster ("shared" + "shopping list") — maximum keyword relevance by construction | **Not checked** | **Not checked** | Best keyword-only fit, flagged by its own source as "generic, weak as a brand, hard to protect" — needs the uniqueness/trademark pass before it can be compared fairly to the others |
| **Listmates** | Keyword Planner research | "Mates" implies sharing, informal/friendly register | Not checked by me directly (note: I separately checked the singular **"Listmate"** and dropped it for the same reason) | **Taken** — "ListMate" is a live Google Play app (`com.bjorudev.listmate`) with shared lists and realtime sync — same product, same name, plus "My ListMate" and "ListiMate" on the App Store | **Dropped — taken**, confirmed independently in both documents under the singular/plural variants |
| **OurCart** | Keyword Planner research | "Our" signals sharing informally; not a tested search cluster itself | Not checked | Not checked | Flagged in its own source as "close to OurGroceries in feel" — real risk, unverified |
| **Tandem** | Keyword Planner research | Not a tested cluster | Not checked | Already known to collide with an existing language-exchange app (per its own source) | Effectively dropped |

## Reconciled recommendation

1. **Same List** and **ShoppingLoop** — now co-leads, on different grounds. Same List is the only
   name **two independent methodologies converged on without seeing each other's work**: the
   Keyword Planner data built it from real "shared list" search demand, and the app-store/trademark
   pass independently found it clean on both stores and at the USPTO. Its one flaw — an unrelated
   B2B mailing-tool already live under the bare name — is a real but distant-category common-law
   conflict. **ShoppingLoop** wins on a different axis: it's the cleanest diligence result of *any*
   candidate checked in this whole exercise (no app-store match, no USPTO record, and no prior use
   found anywhere on the open web), and it carries "shopping" — the single base term validated as
   reading naturally worldwide, unlike "grocery." Neither name literally contains "shared" (the
   single best-validated qualifier), so whichever is chosen, the store title should carry it
   explicitly (e.g. "Same List: Shared Shopping List" / "ShoppingLoop: Shared Shopping List").
2. **GroceryLoop** — still fully clean on diligence, and "grocery" is equally well-validated by
   volume, but American-skewed wording makes it a notch behind ShoppingLoop for a global name (the
   Keyword Planner data's own recommendation is "shopping list" over "grocery" for the brand-facing
   name). Same "shared" gap as the co-leads.
3. **ListLoop** and **CartHive** — remain viable runners-up for the reasons already recorded in
   [app-naming-candidates.md](app-naming-candidates.md), each carrying a real but distant-category
   prior-use conflict.
4. **Shared List** is worth a real uniqueness/trademark pass before ranking it — it has the best
   raw keyword construction of anything considered, and the "generic/hard to protect" concern its
   own source raised is exactly what the app-store + USPTO check (not yet run on it) would clarify.
5. **Listmates and Tandem are dropped** (taken); **OurCart** needs the same diligence pass as
   Shared List before it can be compared fairly.

## Carried-forward open risks

- Neither source is a legal trademark opinion — get a real attorney's opinion before committing
  money or filing, especially given "Cart Hive Ltd." is UK-based (foreign trademark offices weren't
  checked) and "listloop.com" (US) predates any filing that would happen here.
- Domain and social-handle availability were not checked for Same List, Shared List, or OurCart.
- Store-search results in the app-store research resolved to a Poland/English storefront (signed-in
  account locale) rather than US — re-verify before finalizing.
- The Keyword Planner account has no ad spend yet, so its volumes are Google's coarse buckets
  (10–100, 100–1K, etc.), not exact counts — fine for ranking qualifiers against each other, not
  precise enough for a media-plan forecast.
