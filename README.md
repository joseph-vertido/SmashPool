# SmashPool React + Firebase v2.1.10

SmashPool is now split into two browser interfaces backed by Firebase:

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
- Approved admins: read/write access to `adminPools/*` and write access to `publicPools/*`.
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
