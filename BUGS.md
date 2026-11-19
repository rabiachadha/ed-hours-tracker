# Known bugs

Bugs we know about but haven't fixed yet. Keep each entry after it's fixed, so the history stays.
To fix one: write a test in `test-background.js` that fails because of the bug, fix the code until all tests pass, then mark the bug fixed here with the date.

## 1. An old banner can answer a newer question

- **Status:** Not fixed. Found 2026-11-19 by reading the code, and we decided to fix it later. No test reproduces it yet.
- **Where:** `showAwayBanner` in `ed-banner.js` (the click sends only `{ countAway }`, line 77), and `handleBannerAnswer` in `background.js` (lines 108–112).
- **What goes wrong:** With two Ed tabs open, a banner you ignored earlier can use up the minutes from a newer question.
- **Example:**
  1. Tab A shows "away 7 minutes". You ignore it.
  2. Later you come back to Ed in tab B after 6 minutes on another site. The 6 replaces the 7 in storage, and tab B shows "away 6 minutes".
  3. You click **No** on tab A's old banner.
  4. You click **Yes** on tab B's banner. Expected: +6. Actual: +0.
- **Why:** The reply doesn't say which question it answers. `handleBannerAnswer` uses whatever number is stored, then deletes it. So the first click on any banner answers the newest question, and later clicks find nothing.
- **Impact:** Minutes can be counted or dropped by mistake. It needs 2 or more Ed tabs and an ignored banner.
- **Fix idea:** Give each question an id. The banner sends the id back with Yes or No, and `handleBannerAnswer` only counts an answer whose id matches the newest question.

## 2. The badge shows yesterday's total in the morning

- **Status:** Fixed 2026-11-19. Found 2026-11-19 by reading the code. The test "New day: badge resets to 0:00 before any Ed minute (bug #2)" in `test-background.js` failed before the fix (badge stayed `2:30`) and passes after.
- **The fix:** `checkMinute` now calls `showTodayOnBadge` at the start of every minute, and `showTodayOnBadge` looks up today's total itself instead of being handed it. On a new day it finds nothing saved yet, so it shows `0:00`.
- **Where:** `addMinutes` in `background.js` (line 119) is the only place that calls `showTodayOnBadge`.
- **What goes wrong:** The badge and its hover text keep yesterday's numbers until the first counted Ed minute of the new day.
- **Example:** Monday ends at `2:30`. On Tuesday morning, before you open Ed, the badge still says `2:30`, and hovering says "Ed time today: 2h 30m".
- **Why:** The badge only updates when minutes are added. Nothing updates it when the date changes.
- **Impact:** Only the display is wrong. Saved totals are right, since each day has its own key. It fixes itself at the first counted minute.
- **Fix idea:** In `checkMinute`, update the badge from today's saved totals every minute, not only when minutes are added. It would then show `0:00` first thing in the morning.
