// static/app.js
// Wordle-for-songs frontend that controls playback on user's active Spotify device via backend.
// Tracks stats: total correct songs and which attempt each correct guess occurred on.

const SNIPPET_LENGTHS = [1, 2, 5, 7, 10];

let state = {
  track: null,
  round: 0, // 0 = first snippet (1s), 1 = second snippet (2s), ...
  history: [], // array of guess results for current song
  stats: {
    correctSongs: 0,
    attemptsPerSong: [] // push attempt number (1..n) for each correct song
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
  statAttemptsSpan.textContent = state.stats.attemptsPerSong.length > 0 ? state.stats.attemptsPerSong.join(", ") : "—";
}

/* Fetch a seed track from backend (random top track)
   Resets local round & history for the new song. */
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
      setInfo(`Artist hint: ${data.artists.join(", ")}`);
      renderHistory();
    })
    .catch(err => {
      setError("Network error: " + err);
      setInfo("");
    });
}

/* Trigger playback on user's active Spotify device via backend.
   Disables Play button while snippet is playing to avoid overlapping calls. */
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

/* Submit a guess to the backend for fuzzy checking.
   When accepted: increment stats, record attempt number, auto-fetch a new song.
   When rejected: advance round so next snippet will be longer. */
function submitGuess(ev) {
  ev.preventDefault();
  clearError();
  if (!state.track) { setError("No track loaded."); return; }

  const guess = guessInput.value.trim();
  if (!guess) return;
  setInfo("Checking guess...");
  
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

    if (res.accepted) {
      const attemptNumber = Math.min(state.round + 1, SNIPPET_LENGTHS.length);
      state.stats.correctSongs += 1;
      state.stats.attemptsPerSong.push(attemptNumber);
      setInfo(`✅ Correct! "${state.track.name}" — guessed on attempt #${attemptNumber}. Total correct: ${state.stats.correctSongs}`);
      // automatically fetch new song after short delay
      setTimeout(fetchSeed, 1200);
    } else {
      // incorrect guess
      state.round++;
      if (state.round >= 5) {
        // max 5 guesses reached → song failed
        setInfo(`❌ Max guesses reached. The song was "${state.track.name}" by ${state.track.artists.join(", ")}.`);
        setTimeout(fetchSeed, 2000); // move to next song
        state.round = 0;
        state.history = [];
      } else {
        setInfo(`❌ Wrong. Next snippet will be ${SNIPPET_LENGTHS[Math.min(state.round, SNIPPET_LENGTHS.length-1)]}s.`);
      }
    }
  })
  .catch(err => {
    setError("Network error: " + err);
    setInfo("");
  });
}

/* Wire up event listeners */
playButton?.addEventListener("click", (e) => { e.preventDefault(); playSnippet(); });
newButton?.addEventListener("click", (e) => { e.preventDefault(); fetchSeed(); });
guessForm?.addEventListener("submit", submitGuess);

/* Initialize on load */
window.addEventListener("load", () => {
  renderStats();
  fetch("/api/session-info")
    .then(r => r.json())
    .then(si => {
      if (si.needs_auth) {
        setError("Please connect your Spotify account (click Connect on the landing page).");
        setInfo("");
      } else {
        fetchSeed();
      }
    })
    .catch(() => {
      // If session-info fails, still try to fetch a seed (will show proper errors)
      fetchSeed();
    });
});
