// Authors: Rabia Chadha, Claude

// Runs background.js with a fake `chrome` object and checks each scenario.
// Usage: node test-background.js /path/to/background.js
const fs = require("fs");
const vm = require("vm");
const assert = require("assert");
const crypto = require("crypto");

const backgroundSource = fs.readFileSync(process.argv[2], "utf8");

// Input: none.
// Output: { context, fakeBrowser } — a fresh copy of background.js to drive.
// Description: fakeBrowser holds what the fake Chrome reports (where the
// person is), records what the extension did (banners showing), and keeps the
// listeners background.js adds to Chrome events, so tests can fire them.
function loadExtension() {
  const fakeBrowser = {
    place: "ed", focused: true, idleState: "active", bannersShowing: [], windowsOpen: true, edPageLoading: false, scriptsAdded: [],
  };
  // A fake Chrome event. It saves background.js's listener on fakeBrowser under listenerName.
  const fakeChromeEvent = (listenerName) => ({ addListener: (listener) => (fakeBrowser[listenerName] = listener) });
  const makeStorage = () => {
    const savedItems = {};
    return {
      savedItems,
      get: async (key) => (key in savedItems ? { [key]: structuredClone(savedItems[key]) } : {}),
      set: async (values) => Object.assign(savedItems, structuredClone(values)),
      remove: async (key) => delete savedItems[key],
    };
  };
  const urlByPlace = {
    ed: "https://edstem.org/us/courses/100850/discussion/8334335",
    otherCourse: "https://edstem.org/us/courses/99538/discussion",
    edDashboard: "https://edstem.org/us/dashboard",
    cs61a: "https://cs61a.org/lab/",
    code: "https://code.cs61a.org/",
    elsewhere: undefined,
  };
  const chrome = {
    alarms: { get: async () => undefined, create: () => {}, onAlarm: fakeChromeEvent("onAlarm") },
    runtime: {
      onMessage: { addListener: (handleEdPageNote) => (fakeBrowser.handleEdPageNote = handleEdPageNote) },
      onInstalled: fakeChromeEvent("onInstalled"),
    },
    // Two Ed tabs are open. Only a query for Ed pages finds them.
    scripting: { executeScript: async (injection) => fakeBrowser.scriptsAdded.push(injection) },
    storage: { session: makeStorage(), local: makeStorage() },
    idle: { queryState: async () => fakeBrowser.idleState, onStateChanged: fakeChromeEvent("onIdleStateChanged") },
    windows: {
      getLastFocused: async () => {
        if (!fakeBrowser.windowsOpen) throw new Error("No last-focused window");
        const status = fakeBrowser.edPageLoading ? "loading" : "complete";
        return { focused: fakeBrowser.focused, tabs: [{ id: 7, active: true, url: urlByPlace[fakeBrowser.place], status }] };
      },
      onFocusChanged: fakeChromeEvent("onWindowFocusChanged"),
    },
    tabs: {
      query: async (queryInfo) => (queryInfo.url === "https://*.edstem.org/*" ? [{ id: 7 }, { id: 8 }] : []),
      sendMessage: async (tabId, bannerNote) => {
        // Like real Chrome: while the page loads, ed-banner.js isn't running yet, so the message fails.
        if (fakeBrowser.edPageLoading) throw new Error("Could not establish connection. Receiving end does not exist.");
        if (tabId !== 7) throw new Error(`No tab with id ${tabId}`);
        fakeBrowser.bannersShowing = bannerNote.questions; // ed-banner.js shows one banner per question
      },
      onActivated: fakeChromeEvent("onTabActivated"),
      onUpdated: fakeChromeEvent("onTabUpdated"),
    },
    action: {
      setBadgeText: (badge) => (fakeBrowser.badge = badge.text),
      setTitle: (hoverText) => (fakeBrowser.hoverText = hoverText.title),
    },
  };
  const context = vm.createContext({ chrome, URL, structuredClone, crypto });
  vm.runInContext(backgroundSource, context);
  return { context, fakeBrowser, chrome };
}

// Input: steps like [["ed", 5], ["elsewhere", 3]]; minuteSituation can also be "idle",
// "unfocused", "nowindows", or "typing" (on Ed and typed that minute).
// Output: { getTodayMinutes, minutesShowing, clickBannerButton, getLastTrip, getLastCheck } after running every minute.
async function simulate(steps) {
  const { context, fakeBrowser, chrome } = loadExtension();
  for (const [minuteSituation, minutes] of steps) {
    for (let i = 0; i < minutes; i++) {
      fakeBrowser.idleState = minuteSituation === "idle" ? "idle" : "active";
      fakeBrowser.focused = minuteSituation !== "unfocused";
      fakeBrowser.windowsOpen = minuteSituation !== "nowindows";
      fakeBrowser.place = ["idle", "unfocused", "nowindows", "typing"].includes(minuteSituation) ? "ed" : minuteSituation;
      if (minuteSituation === "typing") await fakeBrowser.handleEdPageNote({ wasTyping: true });
      await context.checkMinute();
    }
  }
  const getTodayMinutes = (storageKey = "minutesByDay") =>
    Object.values(chrome.storage.local.savedItems[storageKey] || {})[0] || 0;
  // The minutes on each banner the Ed tab is showing, oldest first, like [5, 1].
  const minutesShowing = () => fakeBrowser.bannersShowing.map((question) => question.minutesAway);
  // Clicks Yes (true) or No (false) on one banner and removes it, like ed-banner.js does.
  const clickBannerButton = async (countAway, bannerIndex = 0) => {
    const question = fakeBrowser.bannersShowing[bannerIndex];
    fakeBrowser.bannersShowing = fakeBrowser.bannersShowing.filter((shown) => shown !== question);
    return fakeBrowser.handleEdPageNote({ questionId: question.id, countAway });
  };
  const getLastTrip = () => chrome.storage.session.savedItems.lastTrip;
  const getLastCheck = () => chrome.storage.session.savedItems.lastCheck;
  return { getTodayMinutes, minutesShowing, clickBannerButton, getLastTrip, getLastCheck, fakeBrowser };
}

// What Chrome passes to each listener. background.js should work no matter what's passed.
const chromeEventArgs = {
  onAlarm: [{ name: "minuteCheck" }],
  onTabActivated: [{ tabId: 7, windowId: 1 }],
  onTabUpdated: [7, { status: "complete" }, { id: 7, active: true }],
  onWindowFocusChanged: [1],
  onIdleStateChanged: ["active"],
  onInstalled: [{ reason: "update" }], // "update" is also what clicking reload (↻) sends
};

// Input: fakeBrowser; listenerName, like "onTabActivated".
// Output: the listener's promise, so the test can wait for it to finish.
// Description: Calls the listener background.js gave Chrome, with the kind of
// arguments Chrome passes. Fails clearly if background.js never added one.
async function fireChromeEvent(fakeBrowser, listenerName) {
  assert.ok(fakeBrowser[listenerName], `background.js doesn't listen for ${listenerName}`);
  return fakeBrowser[listenerName](...chromeEventArgs[listenerName]);
}

// Input: fakeBrowser.
// Output: none; the person is now active on CS 61A's Ed, in a focused Chrome window.
function putBackOnEd(fakeBrowser) {
  Object.assign(fakeBrowser, { place: "ed", focused: true, idleState: "active", windowsOpen: true });
}

const tests = {
  "New day: badge resets to 0:00 before any Ed minute (bug #2)": async () => {
    const { context, fakeBrowser, chrome } = loadExtension();
    // Yesterday ended at 2:30, and the badge still shows it.
    const today = new Date();
    const yesterdayKey = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).toLocaleDateString("en-CA");
    chrome.storage.local.savedItems.minutesByDay = { [yesterdayKey]: 150 };
    fakeBrowser.badge = "2:30";
    fakeBrowser.place = "elsewhere";
    await context.checkMinute();
    assert.equal(fakeBrowser.badge, "0:00");
    assert.match(fakeBrowser.hoverText, /^Ed time today: 0h 00m/);
  },
  "Ed only: every minute counts": async () => {
    const simulationResult = await simulate([["ed", 5]]);
    assert.equal(simulationResult.getTodayMinutes(), 5);
    assert.equal(simulationResult.fakeBrowser.badge, "0:05");
  },
  "cs61a.org trip counts automatically, no banner": async () => {
    const simulationResult = await simulate([["ed", 5], ["cs61a", 5], ["ed", 1]]);
    assert.equal(simulationResult.getTodayMinutes(), 11);
    assert.deepEqual(simulationResult.minutesShowing(), []);
  },
  "code.cs61a.org counts as cs61a": async () => {
    const simulationResult = await simulate([["ed", 1], ["code", 3], ["ed", 1]]);
    assert.equal(simulationResult.getTodayMinutes(), 5);
  },
  "Other site 5 min: banner asks, Yes counts it once": async () => {
    const simulationResult = await simulate([["ed", 5], ["cs61a", 5], ["elsewhere", 5], ["ed", 1]]);
    assert.equal(simulationResult.getTodayMinutes(), 11);
    assert.deepEqual(simulationResult.minutesShowing(), [5]);
    const [question] = simulationResult.fakeBrowser.bannersShowing;
    await simulationResult.clickBannerButton(true);
    assert.equal(simulationResult.getTodayMinutes(), 16);
    // The same answer again, like a click on an old copy of this banner in another tab, must not count twice.
    await simulationResult.fakeBrowser.handleEdPageNote({ questionId: question.id, countAway: true });
    assert.equal(simulationResult.getTodayMinutes(), 16);
  },
  "Other site: No drops it": async () => {
    const simulationResult = await simulate([["ed", 2], ["elsewhere", 5], ["ed", 1]]);
    await simulationResult.clickBannerButton(false);
    assert.equal(simulationResult.getTodayMinutes(), 3);
  },
  "Even 1 min elsewhere asks": async () => {
    const simulationResult = await simulate([["ed", 1], ["elsewhere", 1], ["ed", 1]]);
    assert.deepEqual(simulationResult.minutesShowing(), [1]);
    await simulationResult.clickBannerButton(true);
    assert.equal(simulationResult.getTodayMinutes(), 3);
  },
  "Two 1 min trips in a row: each one asks": async () => {
    const simulationResult = await simulate([["ed", 5], ["elsewhere", 1], ["ed", 1], ["elsewhere", 1], ["ed", 1]]);
    assert.deepEqual(simulationResult.minutesShowing(), [1, 1]);
    assert.equal(simulationResult.getTodayMinutes(), 7); // Time elsewhere waits for an answer
  },
  "Exactly 10 min trip still counts": async () => {
    const simulationResult = await simulate([["ed", 1], ["cs61a", 10], ["ed", 1]]);
    assert.equal(simulationResult.getTodayMinutes(), 12);
  },
  "11 min trip is dropped, no banner": async () => {
    const simulationResult = await simulate([["ed", 1], ["cs61a", 6], ["elsewhere", 5], ["ed", 1]]);
    assert.equal(simulationResult.getTodayMinutes(), 2);
    assert.deepEqual(simulationResult.minutesShowing(), []);
  },
  "Trip that never returns to Ed doesn't count": async () => {
    const simulationResult = await simulate([["ed", 2], ["cs61a", 5]]);
    assert.equal(simulationResult.getTodayMinutes(), 2);
  },
  "cs61a.org before ever opening Ed doesn't count": async () => {
    const simulationResult = await simulate([["cs61a", 5], ["ed", 1]]);
    assert.equal(simulationResult.getTodayMinutes(), 1);
  },
  "Idle on Ed is treated as away and asked about": async () => {
    const simulationResult = await simulate([["ed", 2], ["idle", 5], ["ed", 1]]);
    assert.equal(simulationResult.getTodayMinutes(), 3);
    assert.deepEqual(simulationResult.minutesShowing(), [5]);
  },
  "Another app in front (Chrome not focused) is away": async () => {
    const simulationResult = await simulate([["ed", 1], ["unfocused", 5], ["ed", 1]]);
    assert.deepEqual(simulationResult.minutesShowing(), [5]);
  },
  "No Chrome windows open doesn't crash": async () => {
    const simulationResult = await simulate([["ed", 1], ["nowindows", 5], ["ed", 1]]);
    assert.deepEqual(simulationResult.minutesShowing(), [5]);
  },
  "Ed minutes split into typing and reading; trips are neither": async () => {
    const simulationResult = await simulate([["ed", 2], ["typing", 3], ["cs61a", 2], ["ed", 1]]);
    assert.equal(simulationResult.getTodayMinutes(), 8);
    assert.equal(simulationResult.getTodayMinutes("typingMinutesByDay"), 3);
    assert.equal(simulationResult.getTodayMinutes("readingMinutesByDay"), 3);
  },
  "Typing while the banner waits doesn't lose the held minutes": async () => {
    const simulationResult = await simulate([["ed", 1], ["elsewhere", 5], ["ed", 1], ["typing", 1]]);
    await simulationResult.clickBannerButton(true);
    assert.equal(simulationResult.getTodayMinutes(), 8);
  },
  "Another Ed course never counts, even briefly": async () => {
    const simulationResult = await simulate([["ed", 2], ["otherCourse", 3], ["ed", 1]]);
    assert.equal(simulationResult.getTodayMinutes(), 3);
    assert.deepEqual(simulationResult.minutesShowing(), []);
  },
  "Ed dashboard never counts, even before CS 61A Ed": async () => {
    const simulationResult = await simulate([["edDashboard", 3], ["ed", 1], ["edDashboard", 2], ["ed", 1]]);
    assert.equal(simulationResult.getTodayMinutes(), 2);
  },
  "Banner asks only about the non-Ed minutes": async () => {
    const simulationResult = await simulate([["ed", 1], ["otherCourse", 3], ["elsewhere", 5], ["ed", 1]]);
    assert.deepEqual(simulationResult.minutesShowing(), [5]);
  },
  "Other Ed minutes still count toward the 10 min limit": async () => {
    const simulationResult = await simulate([["ed", 1], ["otherCourse", 8], ["elsewhere", 3], ["ed", 1]]);
    assert.equal(simulationResult.getTodayMinutes(), 2);
    assert.deepEqual(simulationResult.minutesShowing(), []);
  },
  "Switching back after a cs61a.org trip counts it right away, no banner": async () => {
    const simulationResult = await simulate([["ed", 1], ["cs61a", 1]]);
    putBackOnEd(simulationResult.fakeBrowser);
    await fireChromeEvent(simulationResult.fakeBrowser, "onTabActivated");
    assert.equal(simulationResult.getTodayMinutes(), 2);
    assert.deepEqual(simulationResult.minutesShowing(), []);
  },
  "Switching to another Ed course doesn't end the trip": async () => {
    const simulationResult = await simulate([["ed", 1], ["elsewhere", 6]]);
    simulationResult.fakeBrowser.place = "otherCourse";
    await fireChromeEvent(simulationResult.fakeBrowser, "onTabActivated");
    assert.deepEqual(simulationResult.minutesShowing(), []);
    putBackOnEd(simulationResult.fakeBrowser);
    await fireChromeEvent(simulationResult.fakeBrowser, "onTabActivated");
    assert.deepEqual(simulationResult.minutesShowing(), [6]);
  },
  "Switching to Ed before ever being on Ed does nothing": async () => {
    const simulationResult = await simulate([["cs61a", 3]]);
    putBackOnEd(simulationResult.fakeBrowser);
    await fireChromeEvent(simulationResult.fakeBrowser, "onTabActivated");
    assert.equal(simulationResult.getTodayMinutes(), 0);
    assert.deepEqual(simulationResult.minutesShowing(), []);
  },
  "Switch events and the minute check firing together count the trip once": async () => {
    const simulationResult = await simulate([["ed", 1], ["cs61a", 3], ["elsewhere", 5]]);
    putBackOnEd(simulationResult.fakeBrowser);
    // One page load fires onTabUpdated several times, and the minute check can land at the same moment.
    await Promise.all([
      fireChromeEvent(simulationResult.fakeBrowser, "onTabUpdated"),
      fireChromeEvent(simulationResult.fakeBrowser, "onTabUpdated"),
      fireChromeEvent(simulationResult.fakeBrowser, "onAlarm"),
    ]);
    assert.deepEqual(simulationResult.minutesShowing(), [5]);
    assert.equal(simulationResult.getTodayMinutes(), 5); // 1 Ed + 3 cs61a + 1 Ed
  },
  "A quick look at Ed ends the trip": async () => {
    // Without the quick look, this would be one 20-minute trip, dropped without asking.
    const simulationResult = await simulate([["ed", 1], ["elsewhere", 10]]);
    const { fakeBrowser } = simulationResult;
    putBackOnEd(fakeBrowser);
    await fireChromeEvent(fakeBrowser, "onTabActivated");
    fakeBrowser.place = "elsewhere";
    for (let i = 0; i < 10; i++) await fireChromeEvent(fakeBrowser, "onAlarm");
    putBackOnEd(fakeBrowser);
    await fireChromeEvent(fakeBrowser, "onTabActivated");
    assert.deepEqual(simulationResult.minutesShowing(), [10, 10]);
  },
  "Each banner answers only its own question (bug #1)": async () => {
    // Two absences, both unanswered: 7 minutes, then 6 minutes.
    const simulationResult = await simulate([["ed", 1], ["elsewhere", 7], ["ed", 1], ["elsewhere", 6], ["ed", 1]]);
    assert.deepEqual(simulationResult.minutesShowing(), [7, 6]);
    await simulationResult.clickBannerButton(false, 0); // No on the 7-minute banner
    assert.deepEqual(simulationResult.minutesShowing(), [6]);
    await simulationResult.clickBannerButton(true, 0); // Yes on the 6-minute banner
    assert.equal(simulationResult.getTodayMinutes(), 9); // 3 Ed + 6
  },
  "Answering two banners at once counts both and clears both": async () => {
    const simulationResult = await simulate([["ed", 1], ["elsewhere", 2], ["ed", 1], ["elsewhere", 3], ["ed", 1]]);
    const { fakeBrowser } = simulationResult;
    const [firstQuestion, secondQuestion] = fakeBrowser.bannersShowing;
    await Promise.all([
      fakeBrowser.handleEdPageNote({ questionId: firstQuestion.id, countAway: true }),
      fakeBrowser.handleEdPageNote({ questionId: secondQuestion.id, countAway: true }),
    ]);
    assert.equal(simulationResult.getTodayMinutes(), 8); // 3 Ed + 2 + 3
    await fireChromeEvent(fakeBrowser, "onTabActivated");
    assert.deepEqual(simulationResult.minutesShowing(), []);
  },
  "An unanswered banner comes back after a reload or switching Ed tabs": async () => {
    const simulationResult = await simulate([["ed", 1], ["elsewhere", 3], ["ed", 1]]);
    const { fakeBrowser } = simulationResult;
    fakeBrowser.bannersShowing = []; // Reloading the Ed page clears what it showed
    await fireChromeEvent(fakeBrowser, "onTabUpdated");
    assert.deepEqual(simulationResult.minutesShowing(), [3]);
    fakeBrowser.bannersShowing = []; // Another Ed tab, which isn't showing it yet
    await fireChromeEvent(fakeBrowser, "onTabActivated");
    assert.deepEqual(simulationResult.minutesShowing(), [3]);
  },
  "An answered banner is removed from the next Ed tab you look at": async () => {
    const simulationResult = await simulate([["ed", 1], ["elsewhere", 3], ["ed", 1]]);
    const { fakeBrowser } = simulationResult;
    const otherTabBanners = fakeBrowser.bannersShowing; // Another Ed tab shows the same banner
    await simulationResult.clickBannerButton(true);
    fakeBrowser.bannersShowing = otherTabBanners; // Switch to that tab
    await fireChromeEvent(fakeBrowser, "onTabActivated");
    assert.deepEqual(simulationResult.minutesShowing(), []);
  },
  "Installing or reloading the extension adds the banner script to open Ed tabs": async () => {
    const { fakeBrowser } = loadExtension();
    await fireChromeEvent(fakeBrowser, "onInstalled");
    assert.deepEqual(fakeBrowser.scriptsAdded, [
      { target: { tabId: 7 }, files: ["ed-banner.js"] },
      { target: { tabId: 8 }, files: ["ed-banner.js"] },
    ]);
  },
  "A Chrome update doesn't add the banner script again": async () => {
    const { fakeBrowser } = loadExtension();
    await fireChromeEvent(fakeBrowser, "onInstalled"); // Makes sure background.js listens for it
    fakeBrowser.scriptsAdded = [];
    await fakeBrowser.onInstalled({ reason: "chrome_update" });
    assert.deepEqual(fakeBrowser.scriptsAdded, []);
  },
  "Each ended trip is saved with what happened, for the popup's debug lines": async () => {
    const askedResult = await simulate([["ed", 1], ["elsewhere", 3], ["ed", 1]]);
    assert.equal(askedResult.getLastTrip().elsewhereMinutes, 3);
    assert.equal(askedResult.getLastTrip().outcome, "asked");
    const countedResult = await simulate([["ed", 1], ["cs61a", 1], ["ed", 1]]);
    assert.equal(countedResult.getLastTrip().outcome, "counted without asking");
    const droppedResult = await simulate([["ed", 1], ["elsewhere", 11], ["ed", 1]]);
    assert.equal(droppedResult.getLastTrip().outcome, "dropped (over 10 min)");
  },
  "Minute checks and switches save where they saw you, for the popup's debug lines": async () => {
    const simulationResult = await simulate([["ed", 1], ["otherCourse", 1]]);
    assert.equal(simulationResult.getLastCheck().place, "otherEd");
    putBackOnEd(simulationResult.fakeBrowser);
    simulationResult.fakeBrowser.edPageLoading = true;
    await fireChromeEvent(simulationResult.fakeBrowser, "onTabActivated");
    assert.equal(simulationResult.getLastCheck().place, "ed");
    assert.equal(simulationResult.getLastCheck().edPageLoaded, false);
  },
  "Loading an Ed page: the banner waits until the page has loaded (bug #3)": async () => {
    const simulationResult = await simulate([["ed", 1], ["elsewhere", 6]]);
    const { fakeBrowser } = simulationResult;
    putBackOnEd(fakeBrowser);
    // Chrome fires onUpdated when the page starts loading, and again when it's done.
    fakeBrowser.edPageLoading = true;
    await fireChromeEvent(fakeBrowser, "onTabUpdated");
    fakeBrowser.edPageLoading = false;
    await fireChromeEvent(fakeBrowser, "onTabUpdated");
    assert.deepEqual(simulationResult.minutesShowing(), [6]);
  },
  "Minute check while the Ed page loads doesn't lose the banner (bug #3)": async () => {
    const simulationResult = await simulate([["ed", 1], ["elsewhere", 6]]);
    const { fakeBrowser } = simulationResult;
    putBackOnEd(fakeBrowser);
    fakeBrowser.edPageLoading = true;
    await fireChromeEvent(fakeBrowser, "onAlarm");
    fakeBrowser.edPageLoading = false;
    await fireChromeEvent(fakeBrowser, "onTabUpdated");
    assert.deepEqual(simulationResult.minutesShowing(), [6]);
    await simulationResult.clickBannerButton(true);
    assert.equal(simulationResult.getTodayMinutes(), 8); // 1 Ed + 1 Ed while loading + 6 away
  },
};

// One test per way of getting back to Ed. Each Chrome event should show the
// banner right away, the next minute check shouldn't ask again, and Yes counts it.
const waysBackToEd = [
  ["switching tabs", "onTabActivated", "elsewhere"],
  ["switching from another app or window", "onWindowFocusChanged", "unfocused"],
  ["going to Ed in the same tab", "onTabUpdated", "elsewhere"],
  ["coming back from idle", "onIdleStateChanged", "idle"],
];
for (const [wayBack, listenerName, awaySituation] of waysBackToEd) {
  tests[`Banner shows right away after ${wayBack}`] = async () => {
    const simulationResult = await simulate([["ed", 1], [awaySituation, 6]]);
    putBackOnEd(simulationResult.fakeBrowser);
    await fireChromeEvent(simulationResult.fakeBrowser, listenerName);
    assert.deepEqual(simulationResult.minutesShowing(), [6]);
    await fireChromeEvent(simulationResult.fakeBrowser, "onAlarm");
    assert.deepEqual(simulationResult.minutesShowing(), [6]); // Still one banner, not two
    await simulationResult.clickBannerButton(true);
    assert.equal(simulationResult.getTodayMinutes(), 8); // 1 Ed + 6 away + 1 Ed
  };
}

(async () => {
  let failureCount = 0;
  for (const [name, test] of Object.entries(tests)) {
    try {
      await test();
      console.log("PASS", name);
    } catch (error) {
      failureCount++;
      console.log("FAIL", name, "\n    ", error.message);
    }
  }
  console.log(failureCount ? `${failureCount} failed` : "All passed");
  process.exit(failureCount ? 1 : 0);
})();
