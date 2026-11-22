// Authors: Rabia Chadha, Claude

// Checks the weekly text file that popup.js builds.
// Usage: node test-popup.js /path/to/popup.js
const fs = require("fs");
const vm = require("vm");
const assert = require("assert");

// popup.js looks up its button and total boxes, and reads storage, as soon as
// it loads. So give it fake elements, kept by id, and a fake chrome.storage.
const fakeElements = {};
const fakeDocument = { getElementById: (id) => (fakeElements[id] ??= { addEventListener: () => {} }) };
const savedTotals = { minutesByDay: {} };
const savedTripInfo = {}; // What background.js keeps in chrome.storage.session
const fakeChrome = {
  storage: {
    // Like Chrome, keys can be one key or a list of keys.
    local: { get: async (keys) => Object.fromEntries([keys].flat().map((key) => [key, structuredClone(savedTotals[key])])) },
    session: { get: async () => structuredClone(savedTripInfo) },
  },
};
const context = vm.createContext({ document: fakeDocument, chrome: fakeChrome });
vm.runInContext(fs.readFileSync(process.argv[2], "utf8"), context);

// Input: daysAgo, how many days before today.
// Output: that date as a storage key, like "2026-11-18".
function dateKeyDaysAgo(daysAgo) {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo).toLocaleDateString("en-CA");
}

// Input: elementId, a debug row's id in popup.html, like "debug-trip-now".
// Output: the text popup.js put there.
function debugText(elementId) {
  return fakeElements[elementId].textContent;
}

const tests = {
  "Week runs Sunday to Saturday, with each day's split": () => {
    const { weekText, weekStartKey } = context.buildWeekText(
      new Date(2026, 10, 19), // Thursday, Nov 19
      { "2026-11-14": 999, "2026-11-16": 105, "2026-11-18": 150, "2026-11-22": 999 }, // 14th and 22nd are other weeks
      { "2026-11-16": 40, "2026-11-18": 65 },
      { "2026-11-16": 50, "2026-11-18": 70 },
    );
    assert.equal(weekStartKey, "2026-11-15");
    assert.equal(
      weekText,
      [
        "Ed Staff Hours: Sun, Nov 15 – Sat, Nov 21, 2026",
        "",
        "Sun, Nov 15  0h 00m",
        "Mon, Nov 16  1h 45m   (typing 40 min, reading 50 min)",
        "Tue, Nov 17  0h 00m",
        "Wed, Nov 18  2h 30m   (typing 65 min, reading 70 min)",
        "Thu, Nov 19  0h 00m",
        "Fri, Nov 20  0h 00m",
        "Sat, Nov 21  0h 00m",
        "",
        "Week total   4h 15m",
        "",
        "Typing and reading are Ed minutes only. The total also includes counted time away from Ed, like short cs61a.org visits.",
        "",
      ].join("\n"),
    );
  },
  "On Sunday and on Saturday, it's the same week": () => {
    assert.equal(context.buildWeekText(new Date(2026, 10, 15)).weekStartKey, "2026-11-15");
    assert.equal(context.buildWeekText(new Date(2026, 10, 21)).weekStartKey, "2026-11-15");
  },
  "A week across New Year's": () => {
    const { weekText, weekStartKey } = context.buildWeekText(new Date(2027, 0, 1), { "2026-12-30": 61 });
    assert.equal(weekStartKey, "2026-12-27");
    assert.match(weekText, /^Ed Staff Hours: Sun, Dec 27 – Sat, Jan 2, 2027\n/);
    assert.match(weekText, /Wed, Dec 30  1h 01m/);
  },
  "Nothing saved yet: every day is 0": () => {
    const { weekText, weekMinutes } = context.buildWeekText(new Date(2026, 10, 19));
    assert.match(weekText, /Week total   0h 00m/);
    assert.equal(weekMinutes, 0);
  },
  "Popup shows today's total, and last week isn't in this week's": async () => {
    savedTotals.minutesByDay = { [dateKeyDaysAgo(0)]: 83, [dateKeyDaysAgo(7)]: 500 };
    await context.showTotals();
    assert.equal(fakeElements["today-total"].textContent, "1h 23m");
    assert.equal(fakeElements["week-total"].textContent, "1h 23m");
  },
  "Popup shows today's typing and reading time under the Today total": async () => {
    savedTotals.typingMinutesByDay = { [dateKeyDaysAgo(0)]: 40, [dateKeyDaysAgo(1)]: 999 };
    savedTotals.readingMinutesByDay = { [dateKeyDaysAgo(0)]: 125 };
    await context.showTotals();
    assert.equal(fakeElements["today-typing-reading"].textContent, "Typing 0h 40m\nReading 2h 05m");
  },
  "Debug lines before any trip": async () => {
    await context.showDebug();
    assert.equal(debugText("debug-last-check"), "None yet");
    assert.equal(debugText("debug-last-check-time"), "");
    assert.equal(debugText("debug-trip-now"), "None (one starts after a minute on CS 61A's Ed)");
    assert.equal(debugText("debug-last-trip"), "None yet");
    assert.equal(debugText("debug-banners-waiting"), "None");
    assert.equal(fakeElements["debug-send-error-row"].hidden, true);
  },
  "Debug lines say when CS 61A's Ed page was still loading": async () => {
    savedTripInfo.lastCheck = { place: "ed", edPageLoaded: false, checkedAt: "3:46:02 PM" };
    await context.showDebug();
    assert.equal(debugText("debug-last-check"), "CS 61A's Ed, page still loading");
    assert.equal(debugText("debug-last-check-time"), "3:46:02 PM");
  },
  "Debug lines show the trip now, the last trip, the waiting banners, and a send error": async () => {
    Object.assign(savedTripInfo, {
      lastCheck: { place: "otherEd", checkedAt: "3:45:10 PM" },
      trip: { cs61aMinutes: 1, otherEdMinutes: 0, elsewhereMinutes: 2 },
      lastTrip: { cs61aMinutes: 0, otherEdMinutes: 0, elsewhereMinutes: 6, outcome: "asked", endedAt: "3:42 PM" },
      questions: [
        { id: "a1", minutesAway: 3, endedAt: "3:30 PM" },
        { id: "b2", minutesAway: 6, endedAt: "3:42 PM" },
      ],
      bannerError: "Could not establish connection. Receiving end does not exist.",
    });
    await context.showDebug();
    assert.equal(debugText("debug-last-check"), "another Ed page, not CS 61A's course");
    assert.equal(debugText("debug-last-check-time"), "3:45:10 PM");
    assert.equal(debugText("debug-trip-now"), "2 min elsewhere, 1 cs61a.org, 0 other Ed");
    assert.equal(debugText("debug-last-trip"), "asked: 6 min elsewhere, 0 cs61a.org, 0 other Ed");
    assert.equal(debugText("debug-last-trip-time"), "3:42 PM");
    assert.equal(debugText("debug-banners-waiting"), "3 min (3:30 PM), 6 min (3:42 PM)");
    assert.equal(debugText("debug-send-error"), "Could not establish connection. Receiving end does not exist.");
    assert.equal(fakeElements["debug-send-error-row"].hidden, false);
  },
};

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
