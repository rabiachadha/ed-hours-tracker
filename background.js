// Authors: Rabia Chadha, Claude

// Each minute: if you're active on CS 61A's Ed, add a minute. When you leave,
// the minutes away are held as a "trip". If you come back within 10 minutes,
// cs61a.org minutes count right away and the Ed banner asks about the rest.
// Each Ed minute is also saved as a typing minute or a reading minute.
const IDLE_SECONDS = 180; // No keyboard or mouse for 3 minutes means not active
const MAX_TRIP_MINUTES = 10; // Longer trips are dropped without asking
const MIN_MINUTES_TO_ASK = 1; // Less time elsewhere than this counts without asking
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
chrome.runtime.onInstalled.addListener(addBannerScriptToOpenEdTabs);

// Input: installDetails from Chrome; reason is "install", "update" (also when you
// click reload on chrome://extensions), or "chrome_update".
// Output: none; adds ed-banner.js to every open Ed tab.
// Description: Chrome only adds ed-banner.js when a page loads, and reloading the
// extension cuts off the copies already in open tabs. This saves reloading them.
async function addBannerScriptToOpenEdTabs(installDetails) {
  if (installDetails.reason === "chrome_update") return; // Chrome restarted, so tabs already have a fresh copy
  const edTabs = await chrome.tabs.query({ url: "https://*.edstem.org/*" });
  for (const edTab of edTabs) {
    // This fails for tabs Chrome has put to sleep. They get the script when they load again.
    chrome.scripting.executeScript({ target: { tabId: edTab.id }, files: ["ed-banner.js"] }).catch(() => {});
  }
}

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

// Input: edPageNote from ed-banner.js, { wasTyping: true } or { questionId, countAway: true or false }.
// Output: none.
// Description: A typing note only marks this minute as a typing minute. Answers
// wait their turn, so two quick answers can't undo each other's changes.
function handleEdPageNote(edPageNote) {
  if (edPageNote.wasTyping) return chrome.storage.session.set({ typedThisMinute: true });
  return runOneAtATime(() => handleBannerAnswer(edPageNote));
}

// Input: none (runs once a minute).
// Output: none; updates today's totals and the current trip.
// Description: Each Ed minute counts as typing or reading and starts a fresh,
// empty trip, which fills up only if they leave Ed. The trip is kept in
// chrome.storage.session because Chrome can stop this script between checks.
async function checkMinute() {
  // Refresh the badge every minute, so it shows 0:00 as soon as a new day starts.
  await showTodayOnBadge();
  const { place, edTabId, edPageLoaded } = await currentPlace();
  await saveLastCheck(place, edPageLoaded);
  const { trip } = await chrome.storage.session.get("trip");
  // Clear the typing mark every minute so it never carries into the next one.
  const { typedThisMinute } = await chrome.storage.session.get("typedThisMinute");
  await chrome.storage.session.remove("typedThisMinute");

  if (place === "ed") {
    if (trip) await endTrip(trip);
    await addToDay(typedThisMinute ? "typingMinutesByDay" : "readingMinutesByDay", 1);
    await addMinutes(1);
    await chrome.storage.session.set({ trip: { cs61aMinutes: 0, otherEdMinutes: 0, elsewhereMinutes: 0 } });
    // ed-banner.js isn't running until the page has loaded. checkReturnToEd shows the banners then.
    if (edPageLoaded) await showBanners(edTabId);
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
// Output: none; if they're now on CS 61A's Ed, ends the trip and shows unanswered banners.
// Description: This shows banners as soon as they're back, instead of at the
// next minute check. It adds no Ed minute; checkMinute still does that.
async function checkReturnToEd() {
  const { place, edTabId, edPageLoaded } = await currentPlace();
  await saveLastCheck(place, edPageLoaded);
  if (place !== "ed") return;
  const { trip } = await chrome.storage.session.get("trip");
  if (trip) {
    await endTrip(trip);
    await chrome.storage.session.set({ trip: { cs61aMinutes: 0, otherEdMinutes: 0, elsewhereMinutes: 0 } });
  }
  // Banners sent before the page loads are lost, because ed-banner.js isn't running yet.
  // Chrome fires onUpdated again when the page finishes loading, which runs this again.
  if (edPageLoaded) await showBanners(edTabId);
}

// Input: none.
// Output: { place, edTabId, edPageLoaded }; place is "ed" (CS 61A's Ed course),
// "otherEd" (any other Ed page), "cs61a", or "elsewhere".
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
    // A tab's status is "complete" once its page has finished loading.
    const edPageLoaded = activeTab.status === "complete";
    if (isCs61aCourse(activeTab.url)) return { place: "ed", edTabId: activeTab.id, edPageLoaded };
    return { place: "otherEd" };
  }
  if (isSite(hostname, "cs61a.org")) return { place: "cs61a" };
  return { place: "elsewhere" };
}

// Input: place and edPageLoaded, from currentPlace.
// Output: none; saves them with the time, for the popup's debug lines.
async function saveLastCheck(place, edPageLoaded) {
  const checkedAt = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
  await chrome.storage.session.set({ lastCheck: { place, edPageLoaded, checkedAt } });
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

// Input: trip, the time away from Ed that just ended.
// Output: none; counts the trip's minutes or saves a question about them.
// Description: Trips over 10 minutes are dropped. cs61a.org minutes count right
// away and other Ed pages never do. Time elsewhere becomes a question, which
// showBanners shows as a banner and handleBannerAnswer answers.
async function endTrip(trip) {
  const tripMinutes = trip.cs61aMinutes + trip.otherEdMinutes + trip.elsewhereMinutes;
  if (tripMinutes === 0) return;
  if (tripMinutes > MAX_TRIP_MINUTES) return saveLastTrip(trip, `dropped (over ${MAX_TRIP_MINUTES} min)`);

  await addMinutes(trip.cs61aMinutes);
  if (trip.elsewhereMinutes < MIN_MINUTES_TO_ASK) {
    await addMinutes(trip.elsewhereMinutes);
    return saveLastTrip(trip, "counted without asking");
  }
  // Each question gets its own banner. crypto.randomUUID() makes a random id,
  // like Python's uuid.uuid4(), so an answer can name the question it's for.
  const { questions = [] } = await chrome.storage.session.get("questions");
  const endedAt = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  questions.push({ id: crypto.randomUUID(), minutesAway: trip.elsewhereMinutes, endedAt });
  await chrome.storage.session.set({ questions });
  await saveLastTrip(trip, "asked");
}

// Input: edTabId, the CS 61A Ed tab in front.
// Output: none; sends every unanswered question to that tab, which shows one banner each.
// Description: The tab adds banners for new questions and removes answered ones, so
// the same unanswered banners follow you across Ed tabs and reloads.
async function showBanners(edTabId) {
  const { questions = [] } = await chrome.storage.session.get("questions");
  try {
    await chrome.tabs.sendMessage(edTabId, { questions });
    await chrome.storage.session.remove("bannerError");
  } catch (error) {
    // The tab has no banner script yet. The popup's debug lines show the error.
    await chrome.storage.session.set({ bannerError: error.message });
  }
}

// Input: trip, the trip that just ended; outcome, what happened to it, like "asked".
// Output: none; saves both, with the time, for the popup's debug lines.
async function saveLastTrip(trip, outcome) {
  const endedAt = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  await chrome.storage.session.set({ lastTrip: { ...trip, outcome, endedAt } });
}

// Input: edPageNote from a banner, { questionId, countAway: true or false }.
// Output: none; adds that question's minutes if they clicked Yes.
// Description: The minutes come from storage, not the note. The question is
// removed right away, so a second answer to it (from another tab) does nothing.
async function handleBannerAnswer(edPageNote) {
  const { questions = [] } = await chrome.storage.session.get("questions");
  const answeredQuestion = questions.find((question) => question.id === edPageNote.questionId);
  if (!answeredQuestion) return;
  await chrome.storage.session.set({ questions: questions.filter((question) => question !== answeredQuestion) });
  if (edPageNote.countAway) await addMinutes(answeredQuestion.minutesAway);
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
