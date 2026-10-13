# Translation review

Each catalog was back-translated into English by a request that never saw the English, then a second request compared the back-translation with the source and flagged changes of meaning. Written by `node scripts/translate.mjs --review`, from `translation-review.json`; do not edit by hand.

Rounds: 1 (2026-10-13), 2 (2026-10-13, 12 messages).

| locale | messages reviewed | flags, first review | flags now |
|---|---|---|---|
| de | 285 | 2 | 0 |
| fr | 285 | 3 | 0 |
| es | 285 | 2 | 0 |
| it | 285 | 1 | 1 |
| pt-PT | 285 | 3 | 1 |
| sv | 285 | 2 | 0 |
| nb | 285 | 0 | 0 |
| fi | 285 | 1 | 1 |
| pl | 285 | 4 | 2 |
| cs | 285 | 3 | 1 |
| sk | 285 | 3 | 3 |
| sl | 285 | 0 | 0 |
| hr | 285 | 0 | 0 |
| hu | 285 | 0 | 0 |
| sr-Cyrl | 285 | 5 | 0 |
| be | 285 | 2 | 0 |
| ru | 285 | 2 | 0 |
| uk | 285 | 3 | 0 |
| bg | 285 | 3 | 0 |

## de

### `tuS5Jz` — fixed (round 2)

- **English:** "Unblock"
- **Round 1:** "Freigeben"
  - back-translation: "Release"
  - reason: "Freigeben" means release or share (the app uses "Freigabe" for Sharing), not unblock, so the button reads as a different action.
- **Round 2:** no longer flagged.

### `zel8Hf` — fixed (round 2)

- **English:** "Unblocking…"
- **Round 1:** "Freigeben …"
  - back-translation: "Release …"
  - reason: "Freigeben …" means releasing or sharing rather than unblocking, so the progress label names a different action.
- **Round 2:** no longer flagged.

## fr

### `bzSI52` — fixed (round 2)

- **English:** "Discard"
- **Round 1:** "Ignorer"
  - back-translation: "Ignore"
  - reason: "Ignorer" (Ignore) suggests dismissing the banner and leaving the change pending, whereas "Discard" drops the waiting change.
- **Round 2:** no longer flagged.

### `NMVMEI` — fixed (round 2)

- **English:** "To Do First"
- **Round 1:** "À faire"
  - back-translation: "To do"
  - reason: "À faire" (To do) drops "first", so the sort-order button reads like a filter or status label instead of "to-do items go first".
- **Round 2:** no longer flagged.

### `iImVrZ` — fixed (round 2)

- **English:** "To Do Last"
- **Round 1:** "Terminés"
  - back-translation: "Done"
  - reason: "Terminés" (Done) replaces the sort order "To Do Last" with a status label that reads like a filter for done items, losing the ordering meaning.
- **Round 2:** no longer flagged.

## es

### `NMVMEI` — fixed (round 2)

- **English:** "To Do First"
- **Round 1:** "Pendientes"
  - back-translation: "Pending"
  - reason: "Pendientes" ("Pending") drops "first", so the button reads as a pending label or filter rather than an order that puts to-do items first.
- **Round 2:** no longer flagged.

### `iImVrZ` — fixed (round 2)

- **English:** "To Do Last"
- **Round 1:** "Hechos"
  - back-translation: "Done"
  - reason: The sort button label becomes "Done" ("Hechos") instead of "To Do Last", so it names a different state or filter rather than the order that puts to-do items last.
- **Round 2:** no longer flagged.

## it

### `QTMaez` — open

- **English:** "You joined"
- **Round 1:** "Accettato"
  - back-translation: "Accepted"
  - reason: "You joined" says the person is now a member of the list, but the translation only says the invitation was "Accepted", dropping both "you" and the joining.

## pt-PT

### `-54dx9` — open

- **English:** "{name} (you)"
- **Round 1:** "{name} (eu)"
  - back-translation: "{name} (me)"
  - reason: The English labels the user's own row "(you)", addressing the reader, but "(eu)" means "(me)", switching to first person.

### `NMVMEI` — fixed (round 2)

- **English:** "To Do First"
- **Round 1:** "Pendentes"
  - back-translation: "Pending"
  - reason: "Pendentes" ("Pending") drops "first", so the button reads like a filter for pending items rather than a sort that puts to-do items first.
- **Round 2:** no longer flagged.

### `iImVrZ` — fixed (round 2)

- **English:** "To Do Last"
- **Round 1:** "Feitos"
  - back-translation: "Done"
  - reason: "Feitos" ("Done") drops the ordering and reads like a filter for done items rather than a sort that puts to-do items last.
- **Round 2:** no longer flagged.

## sv

### `bzSI52` — fixed (round 2)

- **English:** "Discard"
- **Round 1:** "Ignorera"
  - back-translation: "Ignore"
  - reason: "Ignorera" (Ignore) suggests leaving the waiting change alone rather than discarding it, which is a different action.
- **Round 2:** no longer flagged.

### `d2Vli_` — fixed (round 2)

- **English:** "Discard my change"
- **Round 1:** "Ignorera min ändring"
  - back-translation: "Ignore my change"
  - reason: "Ignorera min ändring" (Ignore my change) suggests leaving the waiting change alone rather than dropping it, which is a different action from "Discard my change".
- **Round 2:** no longer flagged.

## fi

### `dEgA5A` — open

- **English:** "Cancel"
- **Round 1:** "Kumoa"
  - back-translation: "Undo"
  - reason: "Kumoa" means "Undo", which reverses an action, whereas "Cancel" closes the confirm or editor without doing anything.

## pl

### `k4Zerb` — open

- **English:** "No lists yet"
- **Round 1:** "Brak list"
  - back-translation: "No lists"
  - reason: "Brak list" ("No lists") drops "yet", losing the sense that lists are expected to come.

### `HbXReU` — open

- **English:** "No notifications yet"
- **Round 1:** "Brak powiadomień"
  - back-translation: "No notifications"
  - reason: "Brak powiadomień" ("No notifications") drops "yet", losing the sense that notifications are expected to come.

### `NMVMEI` — fixed (round 2)

- **English:** "To Do First"
- **Round 1:** "Do zrobienia"
  - back-translation: "To do"
  - reason: "Do zrobienia" means only "To do" and drops "first", so the button no longer says that to-do items are sorted to the top.
- **Round 2:** no longer flagged.

### `iImVrZ` — fixed (round 2)

- **English:** "To Do Last"
- **Round 1:** "Zrobione"
  - back-translation: "Done"
  - reason: "Zrobione" ("Done") replaces "To Do Last" with a different label that no longer states the to-do items go last.
- **Round 2:** no longer flagged.

## cs

### `6GFsYk` — open

- **English:** "{name}'s invitation will be withdrawn."
- **Round 1:** "Pozvánka bude odvolána a {name} ji už nebude moci přijmout."
  - back-translation: "The invitation will be revoked and {name} will no longer be able to accept it."
  - reason: The translation adds a claim that {name} will no longer be able to accept the invitation, which the English does not say.

### `NMVMEI` — fixed (round 2)

- **English:** "To Do First"
- **Round 1:** "Nehotové"
  - back-translation: "Not done"
  - reason: The button reads only "Not done" and loses "first", so it no longer says that items still to do are sorted to the top.
- **Round 2:** no longer flagged.

### `iImVrZ` — fixed (round 2)

- **English:** "To Do Last"
- **Round 1:** "Hotové"
  - back-translation: "Done"
  - reason: The button reads only "Done" and loses the "to do last" ordering, so it no longer says that items still to do go to the end.
- **Round 2:** no longer flagged.

## sk

### `Dn4OyV` — open

- **English:** "Invited"
- **Round 1:** "Pozvaní"
  - back-translation: "Invited"
  - reason: "Pozvaní" is a masculine animate plural adjective for the invited people, whose gender the app does not know.

### `XTSpu4` — open

- **English:** "Not signed in."
- **Round 1:** "Najprv sa prihláste."
  - back-translation: "Sign in first."
  - reason: The statement of a state, "Not signed in.", became an instruction, "Sign in first."

### `QTMaez` — open

- **English:** "You joined"
- **Round 1:** "Prijatá"
  - back-translation: "Accepted"
  - reason: "You joined", a statement that the person is now a member, became "Accepted", a label about the invitation that no longer says the person joined.

## sr-Cyrl

### `jxIZ0A` — fixed (round 2)

- **English:** "Set {name} to owner"
- **Round 1:** "Улога особе {name}: власник"
  - back-translation: "Role of {name}: owner"
  - reason: The English is an action ("Set {name} to owner"), but the translation is a label stating the role ("Role of {name}: owner"), so it describes a current state instead of the action.
- **Round 2:** no longer flagged.

### `rQScU1` — fixed (round 2)

- **English:** "Set {name} to reader"
- **Round 1:** "Улога особе {name}: читалац"
  - back-translation: "Role of {name}: reader"
  - reason: The English is an action ("Set {name} to reader"), but the translation is a label stating the role ("Role of {name}: reader"), so it describes a current state instead of the action.
- **Round 2:** no longer flagged.

### `KaNUsm` — fixed (round 2)

- **English:** "Set {name} to writer"
- **Round 1:** "Улога особе {name}: уредник"
  - back-translation: "Role of {name}: editor"
  - reason: The English is an action ("Set {name} to writer"), but the translation is a label stating the role ("Role of {name}: editor"), so it describes a current state instead of the action.
- **Round 2:** no longer flagged.

### `NMVMEI` — fixed (round 2)

- **English:** "To Do First"
- **Round 1:** "Преостало"
  - back-translation: "Remaining"
  - reason: "To Do First" became "Remaining", which drops the sort order (to-do items placed first) and reads like a filter.
- **Round 2:** no longer flagged.

### `iImVrZ` — fixed (round 2)

- **English:** "To Do Last"
- **Round 1:** "Обављено"
  - back-translation: "Done"
  - reason: "To Do Last" became "Done", which drops the sort order (to-do items placed last) and reads like a filter or a state.
- **Round 2:** no longer flagged.

## be

### `NMVMEI` — fixed (round 2)

- **English:** "To Do First"
- **Round 1:** "Нявыкананыя"
  - back-translation: "Not done"
  - reason: The sort button now says only "Not done" and drops "first", so it reads like a filter showing only unfinished items rather than an order putting them first.
- **Round 2:** no longer flagged.

### `iImVrZ` — fixed (round 2)

- **English:** "To Do Last"
- **Round 1:** "Выкананыя"
  - back-translation: "Done"
  - reason: The sort button now says only "Done" and drops the ordering, so it reads like a filter showing only finished items rather than an order putting to-do items last.
- **Round 2:** no longer flagged.

## ru

### `NMVMEI` — fixed (round 2)

- **English:** "To Do First"
- **Round 1:** "Не куплено"
  - back-translation: "Not bought"
  - reason: "Не куплено" ("Not bought") drops "first", so the sort button reads like a status or filter instead of putting items still to do first.
- **Round 2:** no longer flagged.

### `iImVrZ` — fixed (round 2)

- **English:** "To Do Last"
- **Round 1:** "Куплено"
  - back-translation: "Bought"
  - reason: "Куплено" ("Bought") loses the ordering sense of "To Do Last" and reads as a status or filter for bought items, not a sort order.
- **Round 2:** no longer flagged.

## uk

### `2wxgft` — fixed (round 2)

- **English:** "Rename"
- **Round 1:** "Змінити"
  - back-translation: "Change"
  - reason: The button that renames the list becomes a generic "Change" (Змінити), so the specific rename action is lost.
- **Round 2:** no longer flagged.

### `NMVMEI` — fixed (round 2)

- **English:** "To Do First"
- **Round 1:** "Невиконані"
  - back-translation: "Not done"
  - reason: "To Do First" becomes just "Not done", so the sort order (to-do items go first) is lost.
- **Round 2:** no longer flagged.

### `iImVrZ` — fixed (round 2)

- **English:** "To Do Last"
- **Round 1:** "Виконані"
  - back-translation: "Done"
  - reason: "To Do Last" becomes just "Done", so the sort order (to-do items go last) is lost.
- **Round 2:** no longer flagged.

## bg

### `wyHzBd` — fixed (round 2)

- **English:** "Day all day today"
- **Round 1:** "Ден през цялото денонощие"
  - back-translation: "Day around the clock"
  - reason: "Today" is lost, so the status no longer says that the light theme stays on all day only for today.
- **Round 2:** no longer flagged.

### `Ew8DOx` — fixed (round 2)

- **English:** "Night all day today"
- **Round 1:** "Нощ през цялото денонощие"
  - back-translation: "Night around the clock"
  - reason: "Today" is lost, so the status no longer says that the dark theme stays on all day only for today.
- **Round 2:** no longer flagged.

### `2wxgft` — fixed (round 2)

- **English:** "Rename"
- **Round 1:** "Ново име"
  - back-translation: "New name"
  - reason: The verb button "Rename" has become the noun phrase "New name", so it no longer names the renaming action.
- **Round 2:** no longer flagged.
