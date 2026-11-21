# Known bugs

Bugs we know about but haven't fixed yet. Keep each entry after it's fixed, so the history stays.
To fix one: write a test in `test-background.js` that fails because of the bug, fix the code until all tests pass, then mark the bug fixed here with the date.

## 1. An old banner can answer a newer question

- **Status:** Fixed 2026-11-21. Found 2026-11-19 by reading the code. The test "Each banner answers only its own question (bug #1)" in `test-background.js` checks the example below.
- **The fix:** banners now stack, one per time away (Rabia's choice, 2026-11-21). Each question has its own id (`crypto.randomUUID()`), the banner sends that id back with Yes or No, and `handleBannerAnswer` only removes and counts the question with that id. Banners in other tabs are updated to the current list whenever you switch to them.
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

## 3. No banner when coming back to Ed by loading a page

- **Status:** Fixed 2026-11-19. Found 2026-11-19 in real Chrome ("the banner doesn't show anymore"). The tests "Loading an Ed page: the banner waits until the page has loaded (bug #3)" and "Minute check while the Ed page loads doesn't lose the banner (bug #3)" in `test-background.js` failed before the fix (no banner sent) and pass after.
- **The fix:** `currentPlace` now also returns `edPageLoaded` (the tab's status is `"complete"`). Banners are only sent once the page has loaded. When the page finishes loading, Chrome fires `onUpdated` again, which runs `checkReturnToEd` and shows the banner. (Updated 2026-11-21: since banners stack, unanswered questions are kept in storage and sent again on every check, so the trip no longer has to wait for the page to load. Only the sending does.)
- **Where:** `checkReturnToEd` and `checkMinute` in `background.js`.
- **What went wrong:** Coming back to Ed by loading a page showed no banner, and those minutes were never counted.
- **Example:** After 6 minutes on another site, click a link to Ed, type an Ed address, press Back to Ed, open Ed in a new tab, or switch to an Ed tab Chrome had put to sleep. No banner shows.
- **Why:** Chrome fires `onUpdated` as soon as the page starts loading. `checkReturnToEd` ended the trip right then and messaged the tab, but `ed-banner.js` only starts once the page has loaded, so nothing received the message. `.catch(() => {})` hid the error. By the time the page loaded, the trip was already gone. This started when the banner was changed to show right away (also 2026-11-19). Before that, trips ended at the minute check, which almost always came after the page had loaded.
- **Impact:** Minutes away were dropped without asking. Switching to an Ed tab that was already loaded still worked.
- **Related, also fixed 2026-11-19:** after reloading the extension, Ed tabs that were already open couldn't get banners until you reloaded them (the popup's debug line showed "banner failed: Could not establish connection. Receiving end does not exist."). Now `addBannerScriptToOpenEdTabs` adds `ed-banner.js` back to open Ed tabs on install or reload. This needed the `scripting` permission, which Rabia approved. Tested by "Installing or reloading the extension adds the banner script to open Ed tabs".
