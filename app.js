/* Audio is isolated here so a cloud or recorded-file implementation can replace it later. */
class BrowserTtsAudio {
  constructor() {
    this.synth = window.speechSynthesis;
    this.playbackId = 0;
  }

  play(text) {
    if (!this.synth) return Promise.reject(new Error("Text-to-speech is not supported by this browser."));
    const playbackId = ++this.playbackId;
    // Chrome can clip the beginning of a new utterance if it is spoken in the
    // same event turn as cancel(). Allow the speech engine to fully reset first.
    this.synth.cancel();
    return new Promise((resolve, reject) => {
      window.setTimeout(() => {
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
      }, 150);
    });
  }
}

const RANGES = [
  { id: "0-10", label: "0–10", min: 0, max: 10 },
  { id: "11-99", label: "11–99", min: 11, max: 99 },
  { id: "100-999", label: "100–999", min: 100, max: 999 },
  { id: "1000-9999", label: "1,000–9,999", min: 1000, max: 9999 },
  { id: "10000-99999", label: "10,000–99,999", min: 10000, max: 99999 },
];

const settings = { autoplay: true, ...JSON.parse(localStorage.getItem("jp-number-settings") || '{"range":"0-10"}') };
const audio = new BrowserTtsAudio();
const state = { answer: null, attempts: 0, awaitingNext: false };

const practiceView = document.querySelector("#practice-view");
const settingsView = document.querySelector("#settings-view");
const rangeLabel = document.querySelector("#range-label");
const answerForm = document.querySelector("#answer-form");
const answerInput = document.querySelector("#answer-input");
const replayButton = document.querySelector("#replay-button");
const feedback = document.querySelector("#feedback");
const nextHint = document.querySelector("#next-hint");
const rangeOptions = document.querySelector("#range-options");
const autoplayToggle = document.querySelector("#autoplay-toggle");

function currentRange() { return RANGES.find((range) => range.id === settings.range) || RANGES[0]; }
function randomNumber({ min, max }) { return Math.floor(Math.random() * (max - min + 1)) + min; }

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
  const man = Math.floor(number / 10000);
  const rest = number % 10000;
  return `${man ? `${under10000(man)}万` : ""}${rest ? under10000(rest) : ""}`;
}

function setFeedback(kind = "", message = "", mark = "") {
  feedback.className = `feedback ${kind}`;
  feedback.innerHTML = mark ? `<span class="mark" aria-hidden="true">${mark}</span><span>${message}</span>` : message;
}

function playCurrent() {
  if (state.answer === null) return;
  replayButton.disabled = true;
  audio.play(numberToJapanese(state.answer)).catch((error) => setFeedback("wrong", error.message)).finally(() => { replayButton.disabled = false; });
}

function nextQuestion() {
  state.answer = randomNumber(currentRange());
  rangeLabel.textContent = `Current range: ${currentRange().label}`;
  state.attempts = 0;
  state.awaitingNext = false;
  answerInput.value = "";
  answerInput.classList.remove("is-correct");
  answerInput.disabled = false;
  document.querySelector(".submit-button").disabled = false;
  setFeedback();
  nextHint.hidden = true;
  answerInput.focus();
  if (settings.autoplay) playCurrent();
}

function submitAnswer() {
  if (state.awaitingNext) return;
  const raw = answerInput.value.trim();
  if (!/^\d+$/.test(raw)) { setFeedback("wrong", "Please type ordinary digits only.", "!"); return; }
  if (Number(raw) === state.answer) {
    nextQuestion();
    return;
  }
  state.attempts += 1;
  answerInput.value = "";
  if (state.attempts === 1) setFeedback("wrong", "Not quite — one retry remaining.", "!");
  else {
    state.awaitingNext = true;
    answerInput.disabled = true;
    document.querySelector(".submit-button").disabled = true;
    setFeedback("wrong", "Incorrect.", "✕");
    nextHint.hidden = false;
  }
}

function renderSettings() {
  rangeOptions.innerHTML = RANGES.map((range) => `<label class="choice-card"><input type="radio" name="range" value="${range.id}" ${settings.range === range.id ? "checked" : ""} /><span>${range.label}</span></label>`).join("");
  autoplayToggle.setAttribute("aria-pressed", String(settings.autoplay));
}

function showView(view) {
  const showSettings = view === "settings";
  practiceView.hidden = showSettings;
  settingsView.hidden = !showSettings;
  if (!showSettings) nextQuestion();
}

document.querySelector("[data-route='settings']").addEventListener("click", () => showView("settings"));
document.querySelector(".brand").addEventListener("click", (event) => { event.preventDefault(); showView("practice"); });
replayButton.addEventListener("click", playCurrent);
autoplayToggle.addEventListener("click", () => {
  settings.autoplay = !settings.autoplay;
  autoplayToggle.setAttribute("aria-pressed", String(settings.autoplay));
});
answerForm.addEventListener("submit", (event) => { event.preventDefault(); submitAnswer(); });
answerInput.addEventListener("input", () => {
  answerInput.value = answerInput.value.replace(/\D/g, "");
  const isCorrect = answerInput.value !== "" && Number(answerInput.value) === state.answer;
  answerInput.classList.toggle("is-correct", isCorrect);
  if (isCorrect) setFeedback();
});
document.addEventListener("keydown", (event) => {
  if (!state.awaitingNext || settingsView.hidden === false || (event.key !== "Enter" && event.key !== " ")) return;
  event.preventDefault();
  nextQuestion();
});
document.querySelector("#settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  settings.range = new FormData(event.currentTarget).get("range") || RANGES[0].id;
  localStorage.setItem("jp-number-settings", JSON.stringify(settings));
  showView("practice");
});

renderSettings();
nextQuestion();
