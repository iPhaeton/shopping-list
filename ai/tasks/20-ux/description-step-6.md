# Step 6 — Sharing: the invite bar in a pinned header

Written 2026-09-30 from the user's request, after step 5 shipped. The user's words:

> Update the Sharing Screen design according to the new mockups: the Invite input should be on top
> inside the header, along with the Back button. The header should be sticky. Overall design should
> be the same as for the Lists and List Items screen. Do not change the "People with access part" -
> it is already good.
> Do ios testing only on iPhone 18 Pro.
> Do not do testing on Android.

## The design

The mockups in `ai/ux/primary/`, drawn in this session with the app's own tokens and fonts, replace
step 5's Sharing mockups. Step 5's two owner mockups were deleted, and the member one redrawn under
its old name.

- `sharing-screen-invite-header-quiet-horizon[-moonlit].png`: an owner at rest. The invite bar is
  empty, and Share inside it is disabled.
- `sharing-screen-invite-header-suggestions-quiet-horizon[-moonlit].png`: "Jor" typed. Suggestions
  float over the strip and the cards.
- `sharing-screen-invite-header-scrolled-quiet-horizon[-moonlit].png`: a person picked. The role
  picker is in the strip and Share is live. The roster is scrolled, and its cards pass under the hill.
- `sharing-screen-member-quiet-horizon[-moonlit].png`: a reader or writer. There is no bar, so the
  hill follows the title. Their own card has the Leave confirm open.

Choices the user accepted with the mockups:
- Share lives inside the bar, as Create and Add do.
- The role picker sits in List detail's Show-deleted slot, and **only once a person is picked**. This
  replaces step 5's "once the field has text", because the open suggestions cover that slot and
  their blur smeared the picker.
- The suggestions are an overlay.
- The cards lie on band 0, and there is no footer horizon.
- By night, the hints under the roster use the band's ink: `textSecondary` measures 2.7:1 on band 0.

## Done when

- The header is pinned and opaque as on List detail, with an owner's invite bar and the strip's role
  picker working.
- The member cards, confirms and hints behave as before.
- `npm test`, `npm run typecheck` and `npm run kb:audit` pass.
- Checked on the **iPhone 18 Pro** simulator only, in both themes, against the mockups.
- No Android run.
- Web still works.
