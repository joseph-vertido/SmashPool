## v2.1.21 — Version label in public header

- Replaced the public top-bar subtitle `Live Pari-Mutuel Dashboard` with the current application version.
- The displayed value is read from `package.json`, so the header stays aligned with the release version.

## v2.1.20 — Event Description typing fix

- Fixed the Admin **Event Description** rich-text editor so normal keyboard typing works reliably, including mobile browsers.
- The editor is no longer nested inside a form `<label>`, avoiding mobile/contentEditable focus conflicts.
- While the editor has focus, React no longer rewrites its HTML on each change, preventing caret and virtual-keyboard resets.
- Paste and the existing formatting toolbar remain supported.

# SmashPool React + Firebase v2.1.19

## v2.1.19 — Archive wager drill-down, cutoff countdown, and editable event description

- Admin Dashboard **Projected Returns** rows can now be expanded to review every individual named wager on a pair, including bettor, wager amount, timestamp, and current projected payout.
- Event Archive **Projected Returns** rows have the same named wager drill-down using the frozen archived pool.
- Archived **Complete Bet Ledger** now has independent **Search Bettor** and **Search Player** filters.
- Renamed **Projected Return (On $5 Bet)** to **Projected Payout (On $5 Bet)** across Admin, Public, and Archive dashboards.
- Added **Betting Cutoff Date & Time** in Pool Settings. A live countdown appears beside the **LIVE POOL** pill on both Admin and Public dashboards.
- When the cutoff reaches zero, bet entry is immediately disabled. An active Admin session automatically persists `bettingOpen: false` to Firebase; any later Admin session also recognizes an expired cutoff before allowing bets.
- Added a configurable **Event Description** with basic rich-text controls for bold, italic, underline, bulleted/numbered lists, links, and clear formatting. The description is shown on Admin/Public dashboards and preserved in archives.
- Cutoff and event-description fields are included in tournament export/import, private Admin state, public snapshots (when visible), and archive snapshots.
- Public bettor names remain excluded from `publicPools`; named wager drill-down is Admin/archive-only.


## v2.1.18 — Public Dashboard Visibility

- Added **Public Dashboard Visibility** to Admin → Pool Settings.
- When enabled, the normal live public dashboard is published and shown.
- When disabled, the public portal shows **No Ongoing Events** instead of the betting dashboard.
- Hidden mode publishes only a minimal visibility flag to `publicPools/<poolId>`; live totals, pairs, wagers, and activity are removed from the public snapshot while hidden.
- The private Admin pool and Event Archives remain unchanged.

## v2.1.17 Event Archives

- Added a private **Event Archives** section to the authenticated Admin portal.
- **Archive Event** creates a frozen historical Firestore snapshot of the current tournament without changing or resetting the live pool.
- Each archive preserves the complete private tournament state: pool settings, betting-open state, all pairs and players, profile-photo references, every bet/ledger entry, dashboard totals and projected returns, per-pair bettor/wager breakdowns, recent dashboard activity, and settlement information.
- Settlement snapshots support three states: **Finalized**, **Preview** (winning pair selected but payout not finalized), and **Unsettled**. Preview archives preserve the selected winner and calculated payout distribution.
- Archived events are review-only in the UI and do not affect the current live pool.
- Archives are stored in the private `eventArchives/*` collection. Approved admins can create and read archives, while browser updates/deletes are blocked to keep historical snapshots immutable. The public portal cannot access them.

**Important:** deploy the included updated Firestore rules before using Event Archives:

```bash
firebase deploy --only firestore:rules
```

## v2.1.15
- **Projected Return (On $5 Bet)** now displays only the projected dollar payout, e.g. `$10.65`.
- Removed the `×` multiplier from the Projected Return display on both Admin and Public dashboards.

### v2.1.14

- Projected Return is now labeled **Projected Return (On $5 Bet)**.
- The return display combines multiplier and projected dollar payout, e.g. `2.13× / $10.65`.
- Removed the separate **$5 Pays** column/metric from Admin and Public dashboards.

### v2.1.13

- Public **Anonymous Wagers on This Pair** cards now show wager values only. The `Anonymous Bettor` label and numbered square/avatar have been removed.
- Combined-bet count remains visible when an anonymous wager represents multiple entries.

SmashPool is now split into two browser interfaces backed by Firebase:

## v2.1.13 anonymous wager projected payouts

- Expanded public **Anonymous Wagers on This Pair** cards now show both the existing wager amount and its **Projected Payout** if that pair wins at the current pool state.
- Projected payout uses the current distributable prize pool multiplied by that anonymous bettor's share of all wagers on the selected pair.
- The calculation is performed in the public browser from data already present in the public dashboard snapshot, so no bettor names or additional private ledger data are exposed.


- `/` — **Public Dashboard** (read-only)
- `/admin` — **Admin Manager** (Firebase Authentication required)

The administrator manages pairs, profile photos, bets, pool settings, settlement, imports, and exports. Each admin change is saved to Firestore and a sanitized dashboard snapshot is published for public viewers in real time.


## v2.1.6 mobile usability

- Admin `/admin` now uses a hamburger button and slide-out navigation drawer on screens 700px wide and below.
- The drawer includes all Admin sections, betting status, and authenticated-user details, and closes automatically after navigation.
- Admin header actions are horizontally scrollable on narrow phones instead of being squeezed off-screen.
- Public **Projected Returns** mobile cards now use substantially larger pair names, player names, metric labels, wager totals, multipliers, payout amounts, and anonymous wager-breakdown text.
- The `$20 Pays` metric receives a full-width row on mobile to improve legibility.


## v2.1.3 public bettor breakdown

The public Projected Returns section now lets viewers expand any pair to see the people who have bet on that pair and the total amount wagered by each person. Repeat bets from the same bettor on the same pair are combined into one total, with the number of combined bet entries shown. The breakdown is collapsed by default and works in both the desktop table and mobile pair-card layouts.

**Historical note:** v2.1.3 originally exposed bettor names in the public snapshot. This was superseded by v2.1.4; current builds publish only anonymous bettor summaries and keep real bettor names admin-only.

## v2.1.2 mobile public dashboard

The public `/` dashboard now has a dedicated responsive layout for mobile browsers:

- Compact sticky live-status header.
- Two-column summary cards on phones, with Most Bet-On Pair spanning the full width.
- Projected Returns switches from the desktop table to touch-friendly pair cards below 760px.
- Each mobile pair card shows profile photos, group, amount wagered, bettor count, pool share, projected return, and the current $20 payout.
- Bet Activity remains visible and is optimized for narrow screens.
- The `/admin` interface and Firebase data model are unchanged.

## Public bettor privacy (v2.1.4)

The public dashboard no longer publishes or displays bettor names. Expanded pair details show anonymous bettor rows with wager totals and combined-entry counts, and Recent Bet Activity shows anonymous bets. Bettor names remain available only inside the authenticated Admin interface and `adminPools/*`.

After deploying this version, sign in to `/admin` and make/save a change once so `publicPools/main` is rewritten without the bettor-name fields that may have been published by v2.1.3.

## Firebase project

This build is preconfigured for the project ID:

`smashpool-d6818`

You still need the Firebase **Web App configuration** from your project.

## 1. Register / locate your Firebase Web App

In Firebase Console:

1. Open **Project settings**.
2. Under **General → Your apps**, register a Web app if one does not already exist.
3. Copy the Firebase config values.
4. Copy `.env.example` to `.env`.
5. Paste the values into `.env`.

Example:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=smashpool-d6818
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_SMASHPOOL_POOL_ID=main
```

`VITE_FIREBASE_STORAGE_BUCKET` is optional. See **Profile photos** below.

## 2. Enable admin login

In Firebase Console:

1. Open **Authentication**.
2. Enable **Email/Password** as a sign-in provider.
3. Create your admin user in **Authentication → Users**.
4. Copy that user's Firebase **UID**.
5. In Firestore, create this document:

```
admins/<YOUR_FIREBASE_UID>
```

Add this field:

```text
active = true   (Boolean)
```

Only users with an active `admins/{uid}` document are allowed to access the full pool state or make changes.

## 3. Deploy Firestore security rules

The included `firestore.rules` gives:

- Everyone: read access to `publicPools/*` only.
- Approved admins: read/write access to `adminPools/*`, create/read access to immutable `eventArchives/*`, plus write access to `publicPools/*`.
- Nobody from the browser: permission to create or modify admin allow-list records.

Using Firebase CLI:

```bash
firebase login
firebase use smashpool-d6818
firebase deploy --only firestore:rules
```

## 4. Profile photos

### Recommended: Firebase Storage

If `VITE_FIREBASE_STORAGE_BUCKET` is configured, profile photos are resized by SmashPool, uploaded to Firebase Storage, and only the resulting URL is stored in Firestore.

Deploy the included Storage rules:

```bash
firebase deploy --only storage
```

The included rules make profile photos publicly readable because the public dashboard needs them, while only approved admins can upload/delete them.

### Without Firebase Storage

If you leave `VITE_FIREBASE_STORAGE_BUCKET` blank, SmashPool continues to store compressed profile pictures directly inside the Firestore pool document as data URLs. This avoids needing Firebase Storage, but it is best for smaller tournaments because Firestore has a per-document size limit.

## 5. Run locally

```bash
npm install
npm run dev
```

Then open:

- Public: `http://localhost:5173/`
- Admin: `http://localhost:5173/admin`

## 6. Deploy to Firebase Hosting

The included `firebase.json` has the SPA rewrite needed for `/admin`.

```bash
npm run build
firebase deploy --only hosting
```

Or deploy Hosting + Firestore rules + Storage rules together:

```bash
npm run build
firebase deploy
```

The build can also be hosted on Vercel or Netlify. SPA rewrites are included for both.

## Firestore layout

```text
admins/
  <firebase-user-uid>
    active: true

adminPools/
  main
    state: { full private tournament state + bet ledger }

eventArchives/
  <archive-id>
    state: { frozen full private tournament state }
    dashboard: { frozen admin dashboard metrics, pair returns, recent activity }
    settlement: { finalized/preview/unsettled status + payout snapshot }
    archivedAt / archivedAtIso / archivedBy

publicPools/
  main
    tournamentName
    bettingOpen
    totalPool
    prizePool
    uniqueBettors
    totalBets
    mostBetOnPairId
    pairs[]           # pair/player/photo + aggregate pool data only
    recentBets[]      # the 10 entries displayed by the public Dashboard
```

If Firebase Storage is enabled:

```text
profilePhotos/
  main/
    <pair-id>/
      player1.webp
      player2.webp
```

## Realtime behavior

The public page listens to `publicPools/main`. When the administrator changes the tournament, the admin app writes both the private state and the sanitized public dashboard snapshot in one Firestore batch. Public browsers update automatically without refreshing.

## Migrating your existing SmashPool data

The Admin interface still includes **Import**.

1. Export your current SmashPool tournament JSON.
2. Sign into `/admin`.
3. Click **Import** and select that JSON.

If Firebase Storage is configured, embedded profile pictures from the old JSON are automatically uploaded to Storage during import. If Storage is not configured, the embedded pictures remain in Firestore.

## Important security note

Do not rely on hiding the `/admin` URL for security. The included Firestore and Storage rules enforce access on Firebase's servers. Keep the `admins/{uid}` allow-list restricted to people who should be able to modify the pool.


## v2.1.2 mobile readability

The public dashboard now uses larger mobile typography for hero copy, summary cards, pair names, metric labels, projected-return values, and recent bet activity. The desktop/admin layouts remain unchanged.


## v2.1.5 mobile readability

The public dashboard now uses a high-legibility phone typography scale. On screens up to 760px, body/supporting text is substantially larger, primary values and pair names are enlarged, and the narrow-phone breakpoint no longer shrinks text below comfortable reading sizes. Admin styling is unchanged.


## v2.1.7 Bet Ledger search

The Admin Bet Ledger now has two independent filters: **Search Bettor** and **Search Player**. The filters can be used separately or together; when both are populated, a bet must match both filters to appear.


## v2.1.10 dashboard refinements

- Removed the duplicated smaller player-name line from Projected Returns on both Admin and Public dashboards.
- On the public mobile dashboard, Bet on Pair, Projected Return, and $20 Pays values now use the same text size as Bettors and Pool Share for a more balanced layout.

## v2.1.10 — Prospective $5 return calculation

Dashboard payout projections now answer the question: **“What happens if I place a new $5 bet on this pair right now?”**

For each pair SmashPool now calculates:

1. Hypothetical total pool = current total pool + $5.
2. Hypothetical prize pool = hypothetical total pool after the configured house deduction.
3. Hypothetical pair pool = current amount bet on that pair + $5.
4. Your winning share = $5 / hypothetical pair pool.
5. **$5 Pays** = hypothetical prize pool × your winning share.
6. **Projected Return ($5)** = $5 Pays / $5, displayed as an `×` multiplier.

This means the projection incorporates the effect of the new $5 wager itself instead of applying the pre-bet multiplier.


## v2.1.11 mobile public-dashboard refinement

- Reduced public mobile typography slightly for a more balanced phone layout.
- Left-aligned **Projected Return ($5)** label and value in mobile Projected Returns cards.
- Kept Admin styling and Firebase data structure unchanged.

## v2.1.16 — Public projected-return reliability fix

- Public **Projected Return (On $5 Bet)** is now calculated live from the published total pool, house percentage, and pair wager total.
- The public dashboard no longer depends on optional `projectedReturn5` / `fivePays` fields being present in the Firestore snapshot.
- This fixes the projected return displaying as an em dash (`—`) when viewing older or not-yet-republished public snapshots.
- The formula matches the Admin dashboard's prospective $5 wager logic.

## v2.1.22
- Added a compact **Admin** shortcut to the public top bar that links directly to `/admin`.
- The shortcut is also available on the **No Ongoing Events** public screen.
- Public header version remains tied to `package.json`.
## v2.1.23

- Added a **SmashPool Dashboard** link to the Admin navigation panel.
- The link returns to the public dashboard at `/` and is available in both desktop and mobile Admin navigation.

