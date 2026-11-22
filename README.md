# Ed Staff Hours

A Chrome extension that counts the minutes CS 61A staff spend working on CS 61A's Ed course. Today's total shows on the extension's toolbar icon, and clicking the icon lets you download the week as a text file.

- [Using it](#using-it): for staff who install it
- [Working on it](#working-on-it): for anyone changing the code

---

## Using it

### What counts

- **Time on Ed:** a minute counts when CS 61A's Ed course (`edstem.org/us/courses/100850`) is the front tab of the Chrome window you're using, and you've used the keyboard or mouse in the last 3 minutes. "Ed" below means this course.
- Each Ed minute is saved as **typing** (you typed in a text box on Ed) or **reading** (everything else).
- **Time away from Ed** only counts if you come back to Ed:

| Where you were | Counted? |
|---|---|
| cs61a.org, including subdomains like code.cs61a.org | Yes, automatically |
| Another Ed course, or Ed pages outside a course like the dashboard | Never, and you aren't asked. These minutes still count toward the 10-minute limit. |
| Anywhere else, or not using the keyboard or mouse | A banner on Ed asks "Was that Ed work?" Yes counts it. No doesn't. Each time away gets its own banner, and it stays until you answer. Unanswered banners are dropped, uncounted, when Chrome quits. |
| Away more than 10 minutes in total, even on cs61a.org | No, and you aren't asked |

- The extension checks once a minute, so totals are accurate to about a minute.
- Time away ends as soon as you're back on CS 61A's Ed, even for a second. So a quick look at Ed splits one long time away into two shorter ones.

### What it can and can't see

- It can only see Ed and cs61a.org. Chrome hides the address of every other site from it, so all other sites look the same: "elsewhere".
- It never reads what you type, which keys you press, or what's on the page. For typing minutes, it only notes that a key was pressed in a text box on Ed.
- Everything stays in Chrome on your computer. Nothing is uploaded.
- Chrome permissions it uses: `idle` (was the keyboard or mouse used lately), `alarms` (run once a minute), `storage` (save totals), `scripting` (put the banner script back into open Ed tabs after an install or update), plus access to edstem.org and cs61a.org. `scripting` can only reach those two sites.

### Install

1. Put the `ed-staff-hours` folder somewhere it can stay. Chrome runs the extension from that folder.
2. In Chrome, go to `chrome://extensions`.
3. Turn on **Developer mode** (switch in the top right).
4. Click **Load unpacked** and choose the `ed-staff-hours` folder.
5. Click the puzzle-piece icon to the right of the address bar, then the pin next to **Ed Staff Hours**, so the icon stays visible.

### The badge, the banner, and the weekly file

- **Badge:** the small text on the extension's icon, like `1:23`, is today's total in hours and minutes. Hover over the icon to see the typing and reading split.
- The badge updates every minute, so it shows `0:00` once a new day starts, even before you open Ed.
- **Banners:** white boxes in the bottom right of CS 61A's Ed pages, each asking whether one time away was Ed work, like "away for 3 minutes, until 3:42 PM". A new one slides in as soon as you're back on Ed and the page has loaded. They stack, newest at the bottom, and stay on whichever CS 61A Ed page you're looking at, even after a reload, until you click Yes or No. Answering in one tab removes that banner from the others.
- **Popup:** click the extension's icon to see today's total and this week's total (Sunday to Saturday). Under today's total is today's typing and reading time on Ed.
- **Debug lines:** the Debug box at the bottom of the popup shows where the last check saw you (CS 61A's Ed, another Ed page, cs61a.org, or elsewhere), the current trip, the last trip with what happened to it (asked, counted without asking, or dropped), the banners waiting for an answer, and the error if sending them to the Ed tab failed (in red, only when it happens). Close and reopen the popup to refresh them. They're kept for now while staff try the extension.
- **Weekly file:** in the popup, click **Download this week**. It saves a file like `ed-hours-week-of-2026-11-15.txt` to Downloads, with each day from Sunday to Saturday, the typing and reading split, and the week total.

### Good to know

- Keep the folder where it is. If you move it, you'll have to load it again, and Chrome treats it as a new extension, so your saved totals don't carry over.
- Removing the extension deletes your saved totals.
- To update: replace the files in the folder, click the reload arrow (↻) on the extension's card in `chrome://extensions`. Your totals are kept.
- Known bugs are listed in [BUGS.md](BUGS.md), along with fixed ones.

---

## Working on it

There's no build step: Chrome runs these files exactly as written.

### Files

| File | What it does |
|---|---|
| `manifest.json` | Chrome's settings file: name, permissions, and which scripts run where |
| `background.js` | The service worker. Once a minute it works out where you are and counts minutes. It also ends your time away as soon as you're back on Ed. All the counting rules live here. |
| `ed-banner.js` | Content script that runs on every Ed page. Shows the banners (`showBanners`, `makeBanner`) and reports typing. |
| `popup.html`, `popup.js` | The popup that opens when you click the icon. `showTotals` fills in today's and this week's totals, plus today's typing and reading time. `buildWeekText` makes the week's text, and a link with a `download` attribute saves it, so no extra permission is needed. |
| `icons/` | The extension's icon. `icon.svg` is the drawing; the PNGs (16, 32, 48, 128 px) are exported from it, since Chrome can't use SVG icons. |
| `test-background.js` | Node tests. Runs `background.js` with a fake `chrome` object. Chrome never loads it. |
| `test-popup.js` | Node tests for the popup's totals and the weekly file's text. Chrome never loads it. |
| `BUGS.md` | Known bugs, kept as a history |

### How it works

- A Chrome alarm runs `checkMinute` once a minute. It calls `currentPlace`, which returns `"ed"` (CS 61A's Ed course, checked by `isCs61aCourse`), `"otherEd"`, `"cs61a"`, or `"elsewhere"`.
- **On Ed:** settle the current trip with `endTrip`, add the minute (as typing or reading), and start a fresh, empty trip.
- **Away:** add the minute to the trip, as a cs61a, other Ed, or elsewhere minute. If there's no trip yet (not on Ed since Chrome started), nothing counts.
- **Back on Ed, between checks:** switching tabs, windows, or pages, or coming back from idle, runs `checkReturnToEd`. If you're now on CS 61A's Ed, it settles the trip with `endTrip` right away, then `showBanners` sends the unanswered questions to the tab, so banners don't wait for the next minute. Both checks do these steps through `endTripAndShowBanners`. Banners are only sent once the page has loaded, because `ed-banner.js` isn't running before then (bug #3). It adds no Ed minute; `checkMinute` still does that.
- **Install or reload:** `addBannerScriptToOpenEdTabs` adds `ed-banner.js` to every open Ed tab. Chrome only adds it when a page loads, and reloading the extension cuts off the copies already in open tabs.
- `runOneAtATime` makes `checkMinute` and `checkReturnToEd` take turns. One page load fires several events at once, and two checks running together could end the same trip twice.
- `endTrip` applies the rules in [What counts](#what-counts). To ask, it adds a question, `{ id, minutesAway, endedAt }`, to the `questions` list in storage.
- `showBanners` (in background.js) sends the whole `questions` list to the Ed tab in front, every minute on Ed and on every switch back. `showBanners` (in ed-banner.js) adds a banner for each new question and removes banners for answered ones, so banners already showing don't slide in again.
- `handleBannerAnswer` gets Yes or No with a question's id, removes that question, and takes its minutes from storage, not from the message, so it can't be counted twice. Answers take turns through `runOneAtATime`, so two quick clicks can't undo each other.
- The settings are constants at the top of `background.js`: `IDLE_SECONDS` (180), `MAX_TRIP_MINUTES` (10), `MIN_MINUTES_TO_ASK` (1), `ED_COURSE_ID` (`"100850"`, Fall 2026). Update `ED_COURSE_ID` each semester, or nothing on Ed will count.

Messages between the two scripts:

```
background.js  --{ questions: [...] }-->             ed-banner.js   show one banner per question
background.js  <--{ questionId, countAway: true }--  ed-banner.js   the Yes or No answer to one banner
background.js  <--{ wasTyping: true }--              ed-banner.js   typed in a text box (at most every 5 seconds)
```

Storage:

| Where | Key | Holds |
|---|---|---|
| `chrome.storage.local` (kept across restarts) | `minutesByDay` | Total minutes per date, like `{ "2026-11-19": 95 }` |
| | `typingMinutesByDay` | Ed typing minutes per date |
| | `readingMinutesByDay` | Ed reading minutes per date |
| `chrome.storage.session` (cleared when Chrome quits) | `trip` | `{ cs61aMinutes, otherEdMinutes, elsewhereMinutes }` since you left Ed |
| | `questions` | Unanswered banners, each `{ id, minutesAway, endedAt }` |
| | `bannerError` | Why the last send to the Ed tab failed, for the popup's debug lines. Cleared when a send works. |
| | `typedThisMinute` | Set when a typing note arrives, cleared at each check |
| | `lastTrip` | The last trip that ended, with `outcome` and `endedAt`, for the popup's debug lines |
| | `lastCheck` | Where the last minute check or switch saw you, with `checkedAt`, for the popup's debug lines |

- State lives in storage, not in variables, because Chrome stops the service worker when it's idle, which wipes normal variables.

### Rules

These were decided on purpose. Agree on a change before making one, especially the privacy rules, since staff install this.

- `host_permissions` stays limited to Ed and cs61a.org. Don't add permissions that can see other sites.
- Never record what's typed or what's on the page.
- No Ed API key in the extension, ever.
- The counting rules are the ones in [What counts](#what-counts).

### Run the tests

```
node test-background.js background.js
node test-popup.js popup.js
```

- Needs Node 18 or newer. It uses only Node's built-in modules, so there's nothing to install.
- Each background test plays out pretend minutes (on Ed, elsewhere, idle, and so on) and checks the totals and banners. Some also fire Chrome events, like switching tabs, to check the banner shows right away.
- The popup tests check the popup's totals and the weekly file's text, including weeks that cross months and years.
- Each file ends with "All passed" or how many failed.
- When you fix a bug or change a rule, add or update a test first.

### Test in Chrome

- Load it as in [Install](#install).
- To see background.js: on `chrome://extensions`, click the **service worker** link on the extension's card, then open **Console**.
  - `await chrome.storage.local.get(null)` shows the saved totals.
  - `await chrome.storage.session.get(null)` shows the current trip and any minutes waiting on an answer.
- To see ed-banner.js: on an Ed page, right-click, choose **Inspect**, then open **Console**.
- To see popup.js: right-click the extension's icon and choose **Inspect popup**.
- While a DevTools window is in front, the extension counts you as away from Ed.
- After editing code: click reload (↻) on the extension's card. Open Ed tabs get the new `ed-banner.js` on their own, except tabs Chrome has put to sleep, which get it when they load again.
- To start over: run `chrome.storage.local.clear()` in the service worker console, then reload the extension.

A quick check, about 15 minutes:

| Do this | Expect |
|---|---|
| Stay on Ed for 3 minutes, moving the mouse now and then | The badge appears at `0:01`, then counts up |
| Type in an Ed reply box for a minute (don't post) | Hover text: typing goes up by 1 |
| Open the Ed dashboard or another course for 2 minutes, then come back | Those 2 minutes are not added |
| Leave for 3 minutes, then come back | The banner slides in right away, and Yes adds about 3 |
| Leave for 11 minutes or more, then come back | Nothing is added, no banner |
| Click the extension's icon | "Today" matches the badge, and "This week" is at least that much |
| In the popup, click **Download this week** | A `.txt` file in Downloads, with today's minutes on today's line |

Authors: Rabia Chadha, Claude
