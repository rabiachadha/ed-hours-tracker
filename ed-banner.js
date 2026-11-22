// Authors: Rabia Chadha, Claude

// Runs on Ed pages. Whenever you're on CS 61A's Ed, background.js sends
// { questions }, every unanswered question, and this shows one banner for each.
// It also tells background.js when someone types in a text box on Ed.
chrome.runtime.onMessage.addListener((bannerNote) => {
  showBanners(bannerNote.questions);
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

// The banners' look. These rules live in a shadow root, so they can't change
// Ed's page, and Ed's CSS can't select anything inside .stack.
// "all: initial" stops .card from inheriting Ed's fonts and spacing.
const BANNER_CSS = `
  .stack {
    position: fixed; bottom: 24px; right: 24px; z-index: 99999;
    display: flex; flex-direction: column; gap: 10px;
  }
  .card {
    all: initial;
    display: block;
    width: 300px; padding: 16px;
    background: #fff; color: #111827;
    border: 1px solid rgba(0, 0, 0, 0.08); border-radius: 14px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.06);
    font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    animation: slide-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  /* Starts just past the right edge of the window, then slides in and overshoots a little, like a pop. */
  @keyframes slide-in { from { transform: translateX(calc(100% + 24px)); } }
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
const BANNER_HOST_ID = "ed-hours-banners"; // The id of the box on Ed's page that holds the banners

// Input: questions, every unanswered question, like [{ id, minutesAway, endedAt }].
// Output: none; shows one banner per question, stacked in the bottom right, newest at the bottom.
// Description: Banners already showing stay put, so they don't slide in again.
// Banners for questions answered in another tab are removed.
function showBanners(questions) {
  // Nothing to show and no banners yet: don't add an empty box to Ed's page.
  if (questions.length === 0 && !document.getElementById(BANNER_HOST_ID)) return;
  const stack = getBannerStack();
  const questionIds = questions.map((question) => question.id);
  for (const card of stack.querySelectorAll(".card")) {
    if (!questionIds.includes(card.dataset.questionId)) card.remove();
  }
  for (const question of questions) {
    if (!stack.querySelector(`[data-question-id="${question.id}"]`)) stack.append(makeBanner(question));
  }
}

// Input: none.
// Output: the .stack element that holds the banners.
// Description: Makes it the first time, inside a shadow root (see BANNER_CSS).
// Makes it again if Ed's page code ever removes it.
function getBannerStack() {
  let bannerHost = document.getElementById(BANNER_HOST_ID);
  if (!bannerHost) {
    bannerHost = document.createElement("div");
    bannerHost.id = BANNER_HOST_ID;
    bannerHost.attachShadow({ mode: "open" }).innerHTML = `<style>${BANNER_CSS}</style><div class="stack"></div>`;
    document.body.append(bannerHost);
  }
  return bannerHost.shadowRoot.querySelector(".stack");
}

// Input: question, like { id, minutesAway: 3, endedAt: "3:42 PM" }.
// Output: a banner asking about that question, with Yes and No buttons.
// Description: A click removes the banner first, then tells background.js which
// question it answers, so stacked banners can't answer each other's questions.
function makeBanner(question) {
  const card = document.createElement("div");
  card.className = "card";
  card.dataset.questionId = question.id;
  const minutesText = question.minutesAway === 1 ? "1 minute" : `${question.minutesAway} minutes`;
  card.innerHTML = `
    <div class="question">Was that Ed work?</div>
    <div class="detail">You were away from Ed or inactive for ${minutesText}, until ${question.endedAt}.</div>
    <div class="buttons"></div>`;

  for (const [buttonText, countAway] of [["Yes, count it", true], ["No", false]]) {
    const answerButton = document.createElement("button");
    answerButton.textContent = buttonText;
    answerButton.className = countAway ? "yes" : "no";
    answerButton.onclick = () => {
      card.remove();
      chrome.runtime.sendMessage({ questionId: question.id, countAway });
    };
    card.querySelector(".buttons").append(answerButton);
  }
  return card;
}
