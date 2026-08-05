/* Audio is isolated here so a cloud or recorded-file implementation can replace it later. */
class BrowserTtsAudio {
  constructor() {
    this.synth = window.speechSynthesis;
    this.playbackId = 0;
  }

  play(text, { userInitiated = false } = {}) {
    if (!this.synth) return Promise.reject(new Error("Text-to-speech is not supported by this browser."));
    const playbackId = ++this.playbackId;
    // Chrome can clip the beginning of a new utterance if it is spoken in the
    // same event turn as cancel(). Allow the speech engine to fully reset first.
    this.synth.cancel();
    return new Promise((resolve, reject) => {
      const startSpeech = () => {
        if (playbackId !== this.playbackId) return resolve();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "ja-JP";
        utterance.rate = 0.8;
        const japaneseVoice = this.synth.getVoices().find((voice) => voice.lang.toLowerCase().startsWith("ja"));
        if (japaneseVoice) utterance.voice = japaneseVoice;
        utterance.onend = resolve;
        utterance.onerror = (event) => {
          // A newer prompt intentionally cancels this one. Browsers report that
          // cancellation as an error, but the replacement audio is playing.
          const wasSuperseded = playbackId !== this.playbackId;
          const wasCancelled = event.error === "canceled" || event.error === "interrupted";
          if (wasSuperseded || wasCancelled) return resolve();
          reject(new Error("The number could not be played."));
        };
        this.synth.resume();
        this.synth.speak(utterance);
      };
      // Android browsers can block speech started after a timer, even when the
      // timer follows a tap. Start immediately for a user-triggered action.
      if (userInitiated) startSpeech();
      else window.setTimeout(startSpeech, 150);
    });
  }
}

const RANGES = [
  { id: "0-10", label: "0–10", min: 0, max: 10 },
  { id: "11-99", label: "11–99", min: 11, max: 99 },
  { id: "100-999", label: "100–999", min: 100, max: 999 },
  { id: "1000-9999", label: "1,000–9,999", min: 1000, max: 9999 },
  { id: "10000-99999", label: "10,000–99,999", min: 10000, max: 99999 },
  { id: "100000-999999", label: "100,000–999,999", min: 100000, max: 999999 },
  { id: "10000000-99999900", label: "10,000,000–99,999,900", format: "(XX,XXX,X00 to YY,YYY,Y00)", min: 10000000, max: 99999900, step: 100 },
  { id: "100000000-999900000", label: "100,000,000–999,900,000", format: "(XXX,X00,000 to YYY,Y00,000)", min: 100000000, max: 999900000, step: 100000 },
];

const settings = { autoplay: true, ...JSON.parse(localStorage.getItem("jp-number-settings") || '{"range":"0-10"}') };
const audio = new BrowserTtsAudio();
const state = { answer: null, attempts: 0, awaitingNext: false };

const practiceView = document.querySelector("#practice-view");
const settingsView = document.querySelector("#settings-view");
const settingsForm = document.querySelector("#settings-form");
const rangeLabel = document.querySelector("#range-label");
const answerForm = document.querySelector("#answer-form");
const answerInput = document.querySelector("#answer-input");
const replayButton = document.querySelector("#replay-button");
const submitButton = document.querySelector(".submit-button");
const feedback = document.querySelector("#feedback");
const nextHint = document.querySelector("#next-hint");
const rangeOptions = document.querySelector("#range-options");
const autoplayToggle = document.querySelector("#autoplay-toggle");
const settingsTabs = [...document.querySelectorAll("[role='tab']")];
const settingsPanels = [...document.querySelectorAll("[role='tabpanel']")];

function currentRange() { return RANGES.find((range) => range.id === settings.range) || RANGES[0]; }
function randomNumber({ min, max, step = 1 }) { return min + Math.floor(Math.random() * ((max - min) / step + 1)) * step; }
function isValidNumericAnswer(value) { return /^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value); }
function parseNumericAnswer(value) { return Number(value.replaceAll(",", "")); }

function numberToJapanese(number) {
  const under10000 = (value) => {
    const parts = [];
    const units = [[1000, "千"], [100, "百"], [10, "十"], [1, ""]];
    for (const [place, name] of units) {
      const digit = Math.floor(value / place);
      if (digit) parts.push(`${place >= 10 && digit === 1 ? "" : ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"][digit]}${name}`);
      value %= place;
    }
    return parts.join("");
  };
  if (number === 0) return "零";
  const oku = Math.floor(number / 100000000);
  const restAfterOku = number % 100000000;
  const man = Math.floor(restAfterOku / 10000);
  const rest = restAfterOku % 10000;
  return `${oku ? `${under10000(oku)}億` : ""}${man ? `${under10000(man)}万` : ""}${rest ? under10000(rest) : ""}`;
}

function setFeedback(kind = "", message = "", mark = "") {
  feedback.className = `feedback ${kind}`;
  feedback.innerHTML = mark ? `<span class="mark" aria-hidden="true">${mark}</span><span>${message}</span>` : message;
}

function playCurrent({ userInitiated = false } = {}) {
  if (state.answer === null) return;
  replayButton.disabled = true;
  audio.play(numberToJapanese(state.answer), { userInitiated }).catch((error) => setFeedback("wrong", error.message)).finally(() => { replayButton.disabled = false; });
}

function nextQuestion({ userInitiated = false } = {}) {
  state.answer = randomNumber(currentRange());
  rangeLabel.textContent = `Current range: ${currentRange().label}`;
  state.attempts = 0;
  state.awaitingNext = false;
  answerInput.value = "";
  answerInput.classList.remove("is-correct");
  answerInput.disabled = false;
  submitButton.disabled = false;
  submitButton.textContent = "Check";
  setFeedback();
  nextHint.hidden = true;
  nextHint.textContent = "Press Enter or Space for the next number.";
  answerInput.focus();
  if (settings.autoplay) playCurrent({ userInitiated });
}

function submitAnswer() {
  if (state.awaitingNext) {
    nextQuestion({ userInitiated: true });
    return;
  }
  const raw = answerInput.value.trim();
  if (!isValidNumericAnswer(raw)) { setFeedback("wrong", "Please use digits, with optional commas such as 1,000.", "!"); return; }
  if (parseNumericAnswer(raw) === state.answer) {
    nextQuestion({ userInitiated: true });
    return;
  }
  state.attempts += 1;
  answerInput.value = "";
  if (state.attempts === 1) setFeedback("wrong", "Not quite — one retry remaining.", "!");
  else {
    state.awaitingNext = true;
    answerInput.value = String(state.answer);
    answerInput.classList.remove("is-correct");
    answerInput.disabled = true;
    submitButton.textContent = "Continue";
    submitButton.disabled = false;
    setFeedback("wrong", "Incorrect.", "✕");
    nextHint.textContent = `The answer was ${state.answer}. Press Enter or Space for the next number.`;
    nextHint.hidden = false;
  }
}

function renderSettings() {
  rangeOptions.innerHTML = RANGES.map((range) => `${range.id === "100000-999999" ? `<div class="tts-only-note"><strong>Text-to-speech only</strong><small>(For mobile users: use your phone's native browser for audio playback)</small></div>` : ""}<label class="choice-card"><input type="radio" name="range" value="${range.id}" ${settings.range === range.id ? "checked" : ""} /><span>${range.label}${range.format ? `<small class="range-format">${range.format}</small>` : ""}</span></label>`).join("");
  autoplayToggle.setAttribute("aria-pressed", String(settings.autoplay));
}

function showSettingsCategory(category) {
  settingsTabs.forEach((tab) => {
    const selected = tab.id === `${category}-tab`;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  settingsPanels.forEach((panel) => { panel.hidden = panel.id !== `${category}-panel`; });
}

function showView(view) {
  const showSettings = view === "settings";
  practiceView.hidden = showSettings;
  settingsView.hidden = !showSettings;
  if (!showSettings) nextQuestion({ userInitiated: true });
}

document.querySelector("[data-route='settings']").addEventListener("click", () => showView("settings"));
document.querySelector(".brand").addEventListener("click", (event) => { event.preventDefault(); showView("practice"); });
settingsTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => showSettingsCategory(tab.id.replace("-tab", "")));
  tab.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const nextTab = settingsTabs[(index + (event.key === "ArrowRight" ? 1 : settingsTabs.length - 1)) % settingsTabs.length];
    nextTab.focus();
    showSettingsCategory(nextTab.id.replace("-tab", ""));
  });
});
replayButton.addEventListener("click", () => playCurrent({ userInitiated: true }));
autoplayToggle.addEventListener("click", () => {
  settings.autoplay = !settings.autoplay;
  autoplayToggle.setAttribute("aria-pressed", String(settings.autoplay));
});
answerForm.addEventListener("submit", (event) => { event.preventDefault(); submitAnswer(); });
answerInput.addEventListener("input", () => {
  answerInput.value = answerInput.value.replace(/[^\d,]/g, "");
  const isCorrect = isValidNumericAnswer(answerInput.value) && parseNumericAnswer(answerInput.value) === state.answer;
  answerInput.classList.toggle("is-correct", isCorrect);
  if (isCorrect) setFeedback();
});
document.addEventListener("keydown", (event) => {
  if (settingsView.hidden === false) {
    if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing) {
      event.preventDefault();
      settingsForm.requestSubmit();
    }
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (state.awaitingNext && (event.key === "Enter" || event.code === "Space")) {
    event.preventDefault();
    nextQuestion({ userInitiated: true });
    return;
  }
  if (!state.awaitingNext && event.code === "Space") {
    event.preventDefault();
    playCurrent({ userInitiated: true });
  }
});
settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  settings.range = new FormData(event.currentTarget).get("range") || RANGES[0].id;
  localStorage.setItem("jp-number-settings", JSON.stringify(settings));
  showView("practice");
});

renderSettings();
nextQuestion();
