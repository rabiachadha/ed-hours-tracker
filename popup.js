// Authors: Rabia Chadha, Claude

// Runs in the popup that opens when you click the extension's toolbar icon.
// It shows today's and this week's totals, and the button saves this week,
// Sunday to Saturday, as a .txt file.
document.getElementById("download-week").addEventListener("click", downloadWeek);
showTotals();
showDebug();

// Input: none (runs each time the popup opens).
// Output: none; fills in the "Today" and "This week" totals above the button,
// and today's typing and reading time on Ed under the "Today" total.
// Description: The week total comes from buildWeekText, so it always matches
// the "Week total" line in the downloaded file.
async function showTotals() {
  const { minutesByDay = {}, typingMinutesByDay = {}, readingMinutesByDay = {} } = await chrome.storage.local.get(
    ["minutesByDay", "typingMinutesByDay", "readingMinutesByDay"],
  );
  const today = new Date();
  const todayDateKey = today.toLocaleDateString("en-CA");
  const todayMinutes = minutesByDay[todayDateKey] || 0;
  const typingMinutes = typingMinutesByDay[todayDateKey] || 0;
  const readingMinutes = readingMinutesByDay[todayDateKey] || 0;
  const { weekMinutes } = buildWeekText(today, minutesByDay);
  document.getElementById("today-total").textContent = formatHours(todayMinutes);
  document.getElementById("week-total").textContent = formatHours(weekMinutes);
  // "\n" starts a new line, because popup.html styles this with white-space: pre-line.
  document.getElementById("today-typing-reading").textContent =
    `Typing ${formatHours(typingMinutes)}\nReading ${formatHours(readingMinutes)}`;
}

// Input: none (runs each time the popup opens).
// Output: none; fills in the debug lines under the button.
// Description: Shows where the last check saw you, the current trip, the last trip
// and what happened to it, the unanswered banners, and why sending them failed, if it did.
async function showDebug() {
  const { lastCheck, trip, lastTrip, questions = [], bannerError } = await chrome.storage.session.get(
    ["lastCheck", "trip", "lastTrip", "questions", "bannerError"],
  );
  const waitingBanners = questions.map((question) => `${question.minutesAway} min (${question.endedAt})`);
  setText("debug-last-check", lastCheck ? describeCheck(lastCheck) : "None yet");
  setText("debug-last-check-time", lastCheck?.checkedAt ?? "");
  setText("debug-trip-now", trip ? describeTrip(trip) : "None (one starts after a minute on CS 61A's Ed)");
  setText("debug-last-trip", lastTrip ? `${lastTrip.outcome}: ${describeTrip(lastTrip)}` : "None yet");
  setText("debug-last-trip-time", lastTrip?.endedAt ?? "");
  setText("debug-banners-waiting", waitingBanners.join(", ") || "None");
  // The error row only shows when the last send to the Ed tab failed.
  setText("debug-send-error", bannerError ?? "");
  document.getElementById("debug-send-error-row").hidden = !bannerError;
}

// Input: elementId, an id in popup.html; text, what to show there.
// Output: none; replaces that element's text.
function setText(elementId, text) {
  document.getElementById(elementId).textContent = text;
}

// What each place from background.js's currentPlace means.
const PLACE_NAMES = {
  ed: "CS 61A's Ed",
  otherEd: "another Ed page, not CS 61A's course",
  cs61a: "cs61a.org",
  elsewhere: "elsewhere (another site or app, idle, or DevTools in front)",
};

// Input: lastCheck, like { place: "ed", edPageLoaded: true, checkedAt: "3:45:10 PM" }.
// Output: where it saw you, like "CS 61A's Ed" or "CS 61A's Ed, page still loading".
// Description: edPageLoaded is only saved for CS 61A's Ed, so it's false only
// when that page was still loading.
function describeCheck(lastCheck) {
  const loadingNote = lastCheck.edPageLoaded === false ? ", page still loading" : "";
  return `${PLACE_NAMES[lastCheck.place]}${loadingNote}`;
}

// Input: trip, like { cs61aMinutes: 1, otherEdMinutes: 0, elsewhereMinutes: 2 }.
// Output: text like "2 min elsewhere, 1 cs61a.org, 0 other Ed".
function describeTrip(trip) {
  return `${trip.elsewhereMinutes} min elsewhere, ${trip.cs61aMinutes} cs61a.org, ${trip.otherEdMinutes} other Ed`;
}

// Input: none (runs when the button is clicked).
// Output: none; saves a file like ed-hours-week-of-2026-11-15.txt to Downloads.
// Description: A link with a "download" attribute saves a file instead of
// opening a page, so this needs no extra Chrome permission.
async function downloadWeek() {
  const { minutesByDay, typingMinutesByDay, readingMinutesByDay } = await chrome.storage.local.get(
    ["minutesByDay", "typingMinutesByDay", "readingMinutesByDay"],
  );
  const { weekText, weekStartKey } = buildWeekText(new Date(), minutesByDay, typingMinutesByDay, readingMinutesByDay);
  const fileLink = document.createElement("a");
  fileLink.href = URL.createObjectURL(new Blob([weekText], { type: "text/plain" }));
  fileLink.download = `ed-hours-week-of-${weekStartKey}.txt`;
  fileLink.click();
}

// Input: today, a Date; minutesByDay, typingMinutesByDay, readingMinutesByDay, saved totals by date.
// Output: { weekText, weekStartKey, weekMinutes }; weekStartKey is Sunday's date, like "2026-11-15".
// Description: getDay() is 0 on Sunday, so going back that many days finds
// this week's Sunday. new Date(year, month, day) handles day numbers past
// the end of a month, like Dec 32, so weeks can cross months and years.
function buildWeekText(today, minutesByDay = {}, typingMinutesByDay = {}, readingMinutesByDay = {}) {
  const weekDays = [];
  for (let i = 0; i < 7; i++) {
    weekDays.push(new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay() + i));
  }

  let weekMinutes = 0;
  const dayLines = weekDays.map((day) => {
    const dateKey = day.toLocaleDateString("en-CA");
    const dayMinutes = minutesByDay[dateKey] || 0;
    weekMinutes += dayMinutes;
    let dayLine = formatDay(day).padEnd(13) + formatHours(dayMinutes);
    if (dayMinutes > 0) {
      dayLine += `   (typing ${typingMinutesByDay[dateKey] || 0} min, reading ${readingMinutesByDay[dateKey] || 0} min)`;
    }
    return dayLine;
  });

  const sunday = weekDays[0];
  const saturday = weekDays[6];
  const weekText = [
    `Ed Staff Hours: ${formatDay(sunday)} – ${formatDay(saturday)}, ${saturday.getFullYear()}`,
    "",
    ...dayLines,
    "",
    "Week total".padEnd(13) + formatHours(weekMinutes),
    "",
    "Typing and reading are Ed minutes only. The total also includes counted time away from Ed, like short cs61a.org visits.",
    "",
  ].join("\n");
  return { weekText, weekStartKey: sunday.toLocaleDateString("en-CA"), weekMinutes };
}

// Input: day, a Date.
// Output: a short label like "Sun, Nov 15".
function formatDay(day) {
  return day.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// Input: minutes, a number of minutes.
// Output: hours and minutes like "1h 05m", the same style as the badge's hover text.
function formatHours(minutes) {
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
