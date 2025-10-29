cat > static/app.js <<'JS'
// static/app.js
const SNIPPET_LENGTHS = [1, 2, 5, 7, 10];

let state = { track: null, round: 0, history: [] };

const audio = document.getElementById("audio");
const playButton = document.getElementById("play-snippet");
const newButton = document.getElementById("fetch-new");
const guessForm = document.getElementById("guess-form");
const guessInput = document.getElementById("guess-input");
const infoDiv = document.getElementById("info");
const historyDiv = document.getElementById("history");
const authDiv = document.getElementById("auth");
const gameDiv = document.getElementById("game");
const errorsDiv = document.getElementById("errors");

let stopTimeout = null;

function setInfo(msg) {
  infoDiv.textContent = msg;
}
function setError(msg) {
  errorsDiv.textContent = msg;
}
function clearError() {
  errorsDiv.textContent = "";
}
function renderHistory() {
  historyDiv.innerHTML = "";
  state.history.forEach((h, i) => {
    const el = document.createElement("div");
    el.textContent = `${i+1}. ${h.guess} — ${h.accepted ? "✅" : "❌"} ${h.ratio ? `(${(h.ratio*100).toFixed(0)}%)` : ""}`;
    historyDiv.appendChild(el);
  });
}

function fetchSeed() {
  clearError();
  fetch("/api/seed-track")
    .then(r => r.json())
    .then(data => {
      if (data.needs_auth) {
        authDiv.style.display = "block";
        gameDiv.style.display = "none";
        setError("Please connect your Spotify account.");
        return;
      }
      if (data.error) {
        setError("Error: " + data.error);
        return;
      }
      state.track = data;
      state.round = 0;
      state.history = [];
      authDiv.style.display = "none";
      gameDiv.style.display = "block";
      setInfo(`Artist hint: ${data.artists.join(", ")}`);
      audio.src = "";
      renderHistory();
    })
    .catch(err => {
      setError("Network error: " + err);
    });
}

function playSnippet() {
  clearError();
  if (!state.track || !state.track.preview_url) {
    setError("No preview available for this track. Try a new song or another account.");
    return;
  }
  if (stopTimeout) { clearTimeout(stopTimeout); stopTimeout = null; }
  const startSec = 0;
  const playFor = SNIPPET_LENGTHS[Math.min(state.round, SNIPPET_LENGTHS.length - 1)];
  audio.src = state.track.preview_url;
  audio.currentTime = startSec;
  audio.play().catch(err => {
    setError("Playback failed (browser autoplay rules). Click the Play snippet button directly.");
  });
  stopTimeout = setTimeout(() => {
    audio.pause();
  }, playFor * 1000);
  setInfo(`Playing ${playFor}s — Artist hint: ${state.track.artists.join(", ")}`);
}

playButton.addEventListener("click", (e) => {
  e.preventDefault();
  playSnippet();
});

newButton.addEventListener("click", (e) => {
  e.preventDefault();
  fetchSeed();
});

guessForm.addEventListener("submit", (ev) => {
  ev.preventDefault();
  clearError();
  const guess = guessInput.value.trim();
  if (!guess) return;
  fetch("/api/check-guess", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({guess})
  })
    .then(r => r.json())
    .then(res => {
      if (res.error) {
        setError("Server error: " + res.error);
        return;
      }
      state.history.push(res);
      renderHistory();
      guessInput.value = "";
      if (res.accepted) {
        setInfo(`Correct! 🎉 "${res.correct_title}" — Artists: ${state.track.artists.join(", ")}`);
      } else {
        state.round = Math.min(state.round + 1, SNIPPET_LENGTHS.length - 1);
        setInfo(`Wrong. Next snippet will be ${SNIPPET_LENGTHS[state.round]}s.`);
        setTimeout(playSnippet, 500);
      }
    })
    .catch(err => setError("Network error: " + err));
});

window.addEventListener("load", () => {
  // Try to hydrate session then get a seed
  fetch("/api/session-info")
    .then(r => r.json())
    .then(si => { fetchSeed(); })
    .catch(() => { fetchSeed(); });
});
JS
