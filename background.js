// Authors: Rabia Chadha, Claude

// Each minute: if you're active on CS 61A's Ed, add a minute. When you leave,
// the minutes away are held as a "trip". If you come back within 10 minutes,
// cs61a.org minutes count right away and the Ed banner asks about the rest.
// Each Ed minute is also saved as a typing minute or a reading minute.
const IDLE_SECONDS = 180; // No keyboard or mouse for 3 minutes means not active
const MAX_TRIP_MINUTES = 10; // Longer trips are dropped without asking
const MIN_MINUTES_TO_ASK = 2; // Less time elsewhere than this counts without asking
const ED_COURSE_ID = "100850"; // CS 61A Fall 2026 on Ed. Change it each semester.

// Chrome can clear alarms when it restarts, so make sure the check exists.
chrome.alarms.get("minuteCheck").then((alarm) => {
  if (!alarm) chrome.alarms.create("minuteCheck", { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener(() => runOneAtATime(checkMinute));
chrome.runtime.onMessage.addListener(handleEdPageNote);
// Coming back to Ed ends the trip right away, so the banner doesn't wait for the minute check.
chrome.tabs.onActivated.addListener(() => runOneAtATime(checkReturnToEd));
chrome.tabs.onUpdated.addListener(() => runOneAtATime(checkReturnToEd));
chrome.windows.onFocusChanged.addListener(() => runOneAtATime(checkReturnToEd));
chrome.idle.onStateChanged.addListener(() => runOneAtATime(checkReturnToEd));

let lastQueuedCheck = Promise.resolve(); // The newest check in line; the next one waits for it

// Input: check, an async function that reads and saves the trip, like checkMinute.
// Output: a promise that finishes when check does.
// Description: One page load fires several events at once. Running checks one
// after another stops two of them from ending the same trip twice.
function runOneAtATime(check) {
  const checkFinished = lastQueuedCheck.then(() => check());
  lastQueuedCheck = checkFinished.catch(() => {}); // A failed check shouldn't block later ones
  return checkFinished;
}

// Input: edPageNote from ed-banner.js, { wasTyping: true } or { countAway: true or false }.
// Output: none.
// Description: A typing note only marks this minute as a typing minute.
// It must not reach handleBannerAnswer, which would clear the held minutes.
function handleEdPageNote(edPageNote) {
  if (edPageNote.wasTyping) return chrome.storage.session.set({ typedThisMinute: true });
  return handleBannerAnswer(edPageNote);
}

// Input: none (runs once a minute).
// Output: none; updates today's totals and the current trip.
// Description: Each Ed minute counts as typing or reading and starts a fresh,
// empty trip, which fills up only if they leave Ed. The trip is kept in
// chrome.storage.session because Chrome can stop this script between checks.
async function checkMinute() {
  // Refresh the badge every minute, so it shows 0:00 as soon as a new day starts.
  await showTodayOnBadge();
  const { place, edTabId } = await currentPlace();
  const { trip } = await chrome.storage.session.get("trip");
  // Clear the typing mark every minute so it never carries into the next one.
  const { typedThisMinute } = await chrome.storage.session.get("typedThisMinute");
  await chrome.storage.session.remove("typedThisMinute");

  if (place === "ed") {
    if (trip) await endTrip(trip, edTabId);
    await addToDay(typedThisMinute ? "typingMinutesByDay" : "readingMinutesByDay", 1);
    await addMinutes(1);
    await chrome.storage.session.set({ trip: { cs61aMinutes: 0, otherEdMinutes: 0, elsewhereMinutes: 0 } });
    return;
  }

  // No trip yet means they haven't been on Ed, so this minute doesn't count.
  if (!trip) return;
  if (place === "cs61a") trip.cs61aMinutes += 1;
  else if (place === "otherEd") trip.otherEdMinutes += 1;
  else trip.elsewhereMinutes += 1;
  await chrome.storage.session.set({ trip });
}

// Input: none (runs when they switch tabs, windows, or pages, or come back from idle).
// Output: none; ends the trip right away if they're now on CS 61A's Ed.
// Description: This shows the banner as soon as they're back, instead of at the
// next minute check. It adds no Ed minute; checkMinute still does that.
async function checkReturnToEd() {
  const { place, edTabId } = await currentPlace();
  const { trip } = await chrome.storage.session.get("trip");
  if (place !== "ed" || !trip) return;
  await endTrip(trip, edTabId);
  await chrome.storage.session.set({ trip: { cs61aMinutes: 0, otherEdMinutes: 0, elsewhereMinutes: 0 } });
}

// Input: none.
// Output: { place, edTabId }; place is "ed" (CS 61A's Ed course), "otherEd"
// (any other Ed page), "cs61a", or "elsewhere".
// Description: Checks the front tab of the focused Chrome window. Chrome only
// shows us Ed and cs61a.org addresses, so the rest all count as "elsewhere".
async function currentPlace() {
  const idleState = await chrome.idle.queryState(IDLE_SECONDS);
  if (idleState !== "active") return { place: "elsewhere" };

  let chromeWindow;
  try {
    chromeWindow = await chrome.windows.getLastFocused({ populate: true });
  } catch {
    return { place: "elsewhere" }; // No Chrome windows are open
  }
  if (!chromeWindow.focused) return { place: "elsewhere" };

  const activeTab = chromeWindow.tabs.find((tab) => tab.active);
  const hostname = activeTab?.url ? new URL(activeTab.url).hostname : "";
  if (isSite(hostname, "edstem.org")) {
    if (isCs61aCourse(activeTab.url)) return { place: "ed", edTabId: activeTab.id };
    return { place: "otherEd" };
  }
  if (isSite(hostname, "cs61a.org")) return { place: "cs61a" };
  return { place: "elsewhere" };
}

// Input: hostname of a tab, and a domain like "cs61a.org".
// Output: true if the hostname is that domain or one of its subdomains.
function isSite(hostname, domain) {
  return hostname === domain || hostname.endsWith("." + domain);
}

// Input: edUrl, the address of an Ed tab, like "https://edstem.org/us/courses/100850/discussion".
// Output: true if the page is in CS 61A's Ed course (ED_COURSE_ID).
// Description: The added "/" makes ".../courses/100850" match too, but not ".../courses/1008501".
function isCs61aCourse(edUrl) {
  return (new URL(edUrl).pathname + "/").includes(`/courses/${ED_COURSE_ID}/`);
}

// Input: trip, the time away from Ed that just ended; edTabId, the Ed tab.
// Output: none; counts the trip's minutes or asks about them.
// Description: Trips over 10 minutes are dropped. cs61a.org minutes count right
// away and other Ed pages never do. A little time elsewhere counts; for more,
// the Ed tab's banner asks, and handleBannerAnswer gets the reply.
async function endTrip(trip, edTabId) {
  const tripMinutes = trip.cs61aMinutes + trip.otherEdMinutes + trip.elsewhereMinutes;
  if (tripMinutes === 0 || tripMinutes > MAX_TRIP_MINUTES) return;

  await addMinutes(trip.cs61aMinutes);
  if (trip.elsewhereMinutes < MIN_MINUTES_TO_ASK) {
    await addMinutes(trip.elsewhereMinutes);
    return;
  }
  await chrome.storage.session.set({ minutesToAskAbout: trip.elsewhereMinutes });
  // An Ed tab opened before the extension was installed has no banner script.
  chrome.tabs.sendMessage(edTabId, { minutesAway: trip.elsewhereMinutes }).catch(() => {});
}

// Input: edPageNote from the Ed banner, { countAway: true or false }.
// Output: none; adds the held minutes if they clicked Yes.
// Description: The minutes come from storage, not the note, and are
// cleared right away so they can't be counted twice.
async function handleBannerAnswer(edPageNote) {
  const { minutesToAskAbout = 0 } = await chrome.storage.session.get("minutesToAskAbout");
  await chrome.storage.session.remove("minutesToAskAbout");
  if (edPageNote.countAway) await addMinutes(minutesToAskAbout);
}

// Input: minutesToAdd, how many minutes to add.
// Output: none; adds minutesToAdd to today's total and updates the toolbar badge.
async function addMinutes(minutesToAdd) {
  if (minutesToAdd === 0) return;
  await addToDay("minutesByDay", minutesToAdd);
  await showTodayOnBadge();
}

// Input: storageKey, like "minutesByDay"; minutesToAdd, how many minutes to add.
// Output: none; saves today's new total under that key.
// Description: Each key holds totals by date, like "2026-11-18", in
// chrome.storage.local, so they survive restarts.
async function addToDay(storageKey, minutesToAdd) {
  const today = new Date().toLocaleDateString("en-CA");
  const { [storageKey]: totalMinByDay = {} } = await chrome.storage.local.get(storageKey);
  totalMinByDay[today] = (totalMinByDay[today] || 0) + minutesToAdd;
  await chrome.storage.local.set({ [storageKey]: totalMinByDay });
}

// Input: none.
// Output: none; shows today's total on the toolbar icon, like "1:23". Hovering
// the icon also shows today's typing and reading minutes on Ed.
// Description: Looks up today's date each time, so on a new day it finds no
// saved minutes yet and shows 0:00 instead of yesterday's total.
async function showTodayOnBadge() {
  const today = new Date().toLocaleDateString("en-CA");
  const { minutesByDay = {} } = await chrome.storage.local.get("minutesByDay");
  const { typingMinutesByDay = {} } = await chrome.storage.local.get("typingMinutesByDay");
  const { readingMinutesByDay = {} } = await chrome.storage.local.get("readingMinutesByDay");
  const todayMinutes = minutesByDay[today] || 0;
  const typingMinutes = typingMinutesByDay[today] || 0;
  const readingMinutes = readingMinutesByDay[today] || 0;

  const hours = Math.floor(todayMinutes / 60);
  const leftoverMinutes = String(todayMinutes % 60).padStart(2, "0");
  chrome.action.setBadgeText({ text: `${hours}:${leftoverMinutes}` });
  chrome.action.setTitle({
    title: `Ed time today: ${hours}h ${leftoverMinutes}m (typing ${typingMinutes} min, reading ${readingMinutes} min)`,
  });
}
