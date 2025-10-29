// static/app.js
const SNIPPET_LENGTHS = [1, 2, 5, 7, 10];

let state = {
  track: null,
  round: 0,
  history: [],
  stats: {
    correctSongs: 0,
    totalAttemptsForCorrectSongs: 0
  },
  playing: false
};

const playButton = document.getElementById("play-snippet");
const newButton = document.getElementById("fetch-new");
const guessForm = document.getElementById("guess-form");
const guessInput = document.getElementById("guess-input");
const infoDiv = document.getElementById("info");
const historyDiv = document.getElementById("history");
const errorsDiv = document.getElementById("errors");
const statCorrectSpan = document.getElementById("stat-correct");
const statAttemptsSpan = document.getElementById("stat-attempts");

function setInfo(msg) { if (infoDiv) infoDiv.textContent = msg; }
function setError(msg) { if (errorsDiv) errorsDiv.textContent = msg; }
function clearError() { if (errorsDiv) errorsDiv.textContent = ""; }

function renderHistory() {
  historyDiv.innerHTML = "";
  state.history.forEach((h, i) => {
    const el = document.createElement("div");
    el.className = "history-item";
    const ratioText = h.ratio !== undefined ? ` (${h.ratio}%)` : "";
    el.textContent = `${i+1}. ${h.guess} — ${h.accepted ? "✅" : "❌"}${ratioText}`;
    historyDiv.appendChild(el);
  });
  renderStats();
}

function renderStats() {
  statCorrectSpan.textContent = state.stats.correctSongs;
  const avg = state.stats.correctSongs > 0
    ? (state.stats.totalAttemptsForCorrectSongs / state.stats.correctSongs).toFixed(2)
    : "—";
  statAttemptsSpan.textContent = avg;
}

function fetchSeed() {
  clearError();
  setInfo("Fetching a new track...");
  fetch("/api/seed-track")
    .then(r => r.json())
    .then(data => {
      if (data.needs_auth) {
        setError("Please connect your Spotify account.");
        setInfo("");
        return;
      }
      if (data.error) {
        setError("Error: " + data.error);
        setInfo("");
        return;
      }
      state.track = data;
      state.round = 0;
      state.history = [];
      state.playing = false;
      renderHistory();
    })
    .catch(err => {
      setError("Network error: " + err);
      setInfo("");
    });
}

function playSnippet() {
  clearError();
  if (!state.track) { setError("No track loaded — click New song."); return; }
  if (state.playing) { setError("Snippet already playing — wait."); return; }

  const duration = SNIPPET_LENGTHS[Math.min(state.round, SNIPPET_LENGTHS.length - 1)];
  setInfo(`Requesting ${duration}s playback on your active Spotify device...`);
  state.playing = true;
  updatePlayButtonState();

  fetch("/api/play-snippet", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ uri: state.track.uri, duration })
  })
    .then(r => r.json())
    .then(res => {
      state.playing = false;
      updatePlayButtonState();
      if (res.error) {
        setError(res.error);
        setInfo("");
        return;
      }
      setInfo(`Played ${duration}s on your Spotify device. Make a guess!`);
    })
    .catch(err => {
      state.playing = false;
      updatePlayButtonState();
      setError("Network error: " + err);
      setInfo("");
    });
}

function updatePlayButtonState() {
  if (!playButton) return;
  playButton.disabled = state.playing;
  playButton.textContent = state.playing ? "Playing…" : "Play snippet";
}

function submitGuess(ev) {
  ev.preventDefault();
  clearError();
  if (!state.track) { setError("No track loaded."); return; }

  const guess = guessInput.value.trim();
  if (!guess) return;

  fetch("/api/check-guess", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ guess, correct_title: state.track.name })
  })
  .then(r => r.json())
  .then(res => {
    if (res.error) {
      setError("Server error: " + res.error);
      setInfo("");
      return;
    }

    state.history.push(res);
    renderHistory();
    guessInput.value = "";

    // Show hint only on guesses 3-5 (round 2-4)
    if (state.round >= 2 && state.round < 5) {
      setInfo(`Hint: Artist(s) — ${state.track.artists.join(", ")}`);
    }

    if (res.accepted) {
      const attemptNumber = Math.min(state.round + 1, SNIPPET_LENGTHS.length);
      state.stats.correctSongs += 1;
      state.stats.totalAttemptsForCorrectSongs += attemptNumber;

      setInfo(`✅ Correct! "${state.track.name}" — guessed on attempt #${attemptNumber}. Total correct: ${state.stats.correctSongs}`);

      setTimeout(fetchSeed, 5000);
      state.round = 0;
      state.history = [];
    } else {
      state.round++;
