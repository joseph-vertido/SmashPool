# SmashPool — Badminton Pari-Mutuel Manager

**Version 1.3.0**

A local Electron desktop application for managing a flexible badminton tournament pari-mutuel pool.

## Features

- Flexible pair count with add/delete controls
- Two pair groups: **Advantage** and **Challenge**
- Drag and drop pairs between Advantage and Challenge
- Editable player names and individual player profile pictures
- Automatic square crop, resize, compression, and local photo storage
- Player photos displayed throughout the dashboard and betting interface
- Persistent interface zoom from 70% to 150%, plus Ctrl/Cmd +, Ctrl/Cmd -, and Ctrl/Cmd 0
- Live pari-mutuel pool totals and projected return multipliers
- **Projected Returns automatically ordered by total amount wagered, highest to lowest**
- **Most Bet-On Pair** dashboard card with player photos and pool share
- Bettor count per pair and 10 most recent Bet Activity entries
- Bet entry with quick amounts and pre-bet payout preview
- Complete bet ledger with search and deletion
- Configurable pool deduction percentage (defaults to 0%)
- Close/reopen betting
- Winner settlement with proportional payouts and Undo Final Payout
- Settlement CSV export and full tournament JSON export
- Automatic local persistence
- Secure Electron renderer setup using context isolation, sandboxing, and a narrow preload API

## Version 1.3.0 changes

- Replaced legacy Group A / Group B with **Advantage** and **Challenge**.
- Added **+ Add Pair** controls to both groups.
- Added pair deletion with an in-app warning when a pair already has bets. Deleting that pair also removes its linked bets and recalculates the pool.
- Added drag-and-drop movement between Advantage and Challenge; group changes save automatically.
- Removed the fixed 10-pair save restriction. The app now supports any number of pairs.
- Older saves migrate automatically: Group A becomes Advantage and Group B becomes Challenge.
- Bet entry and settlement selectors are grouped under Advantage and Challenge.

## How the payout works

For the winning pair:

`bettor return = (bettor's winning stake / total amount wagered on winner) × distributable prize pool`

The distributable prize pool is:

`total pool × (1 - deduction percentage)`

The displayed multiplier is a live projection and changes until betting closes.

## Run

1. Install Node.js/npm if needed.
2. Open a terminal in this folder.
3. Run:

```bash
npm install
npm start
```

The project targets Electron 43.x.

## Notes

- This app records wagers locally; it does not accept or process payments.
- Confirm that any real-money pool is permitted under the rules and laws applicable to your event/location before using it with money.
