// Authors: Rabia Chadha, Claude

// Runs on Ed pages. background.js sends { minutesAway } when someone comes
// back to Ed after time on other sites, and this shows the banner.
// It also tells background.js when someone types in a text box on Ed.
chrome.runtime.onMessage.addListener((minutesAwayNote) => {
  showAwayBanner(minutesAwayNote.minutesAway);
});

let lastTypingReportTime = 0; // When reportTyping last messaged background.js, in ms
// Listen before Ed's own code does, so Ed can't hide key presses from us.
document.addEventListener("keydown", reportTyping, true);

// Input: keyPress, a key press anywhere on the Ed page.
// Output: none; sends { wasTyping: true } to background.js, at most every 5 seconds.
// Description: Only key presses in a text box count, so arrow keys and Ed
// shortcuts while reading don't. Which key was pressed is never read or sent.
function reportTyping(keyPress) {
  const inTextBox =
    keyPress.target.isContentEditable || ["INPUT", "TEXTAREA"].includes(keyPress.target.tagName);
  if (!inTextBox || Date.now() - lastTypingReportTime < 5000) return;
  lastTypingReportTime = Date.now();
  chrome.runtime.sendMessage({ wasTyping: true }).catch(() => {});
}

// The banner's look. These rules live in the banner's shadow root, so they
// can't change Ed's page, and Ed's CSS can't select anything inside .card.
// "all: initial" stops .card from inheriting Ed's fonts and spacing.
const BANNER_CSS = `
  .card {
    all: initial;
    position: fixed; bottom: 24px; right: 24px; z-index: 99999;
    width: 300px; padding: 16px;
    background: #fff; color: #111827;
    border: 1px solid rgba(0, 0, 0, 0.08); border-radius: 14px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.06);
    font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    animation: slide-in 0.2s ease-out;
  }
  @keyframes slide-in { from { opacity: 0; transform: translateY(8px); } }
  .question { font-size: 15px; font-weight: 600; }
  .detail { margin-top: 2px; color: #6b7280; text-wrap: pretty; }
  .buttons { display: flex; gap: 8px; margin-top: 14px; }
  button {
    flex: 1; padding: 8px 12px; border: none; border-radius: 8px;
    font: inherit; font-weight: 500; cursor: pointer; transition: background 0.15s;
  }
  .yes { background: #2563eb; color: #fff; }
  .yes:hover { background: #1d4ed8; }
  .no { background: #f3f4f6; color: #374151; }
  .no:hover { background: #e5e7eb; }
`;

// Input: minutesAway, minutes spent on other sites, other apps, or inactive.
// Output: none; adds the banner to the bottom right of the page.
// Description: Yes or No tells background.js whether to count the minutes,
// then the banner goes away. A newer banner replaces an older one.
function showAwayBanner(minutesAway) {
  document.getElementById("ed-hours-banner")?.remove();

  const banner = document.createElement("div");
  banner.id = "ed-hours-banner";
  const bannerRoot = banner.attachShadow({ mode: "open" });
  bannerRoot.innerHTML = `
    <style>${BANNER_CSS}</style>
    <div class="card">
      <div class="question">Was that Ed work?</div>
      <div class="detail">You were away from Ed or inactive for ${minutesAway} minutes.</div>
      <div class="buttons"></div>
    </div>`;

  for (const [buttonText, countAway] of [["Yes, count it", true], ["No", false]]) {
    const answerButton = document.createElement("button");
    answerButton.textContent = buttonText;
    answerButton.className = countAway ? "yes" : "no";
    answerButton.onclick = () => {
      chrome.runtime.sendMessage({ countAway });
      banner.remove();
    };
    bannerRoot.querySelector(".buttons").append(answerButton);
  }
  document.body.append(banner);
}
