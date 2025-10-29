const SNIPPET_LENGTHS = [1, 2, 5, 7, 10];
let state = { track: null, round: 0, history: [] };

const playButton = document.getElementById("play-snippet");
const newButton = document.getElementById("fetch-new");
const guessForm = document.getElementById("guess-form");
const guessInput = document.getElementById("guess-input");
const infoDiv = document.getElementById("info");
const historyDiv = document.getElementById("history");
const errorsDiv = document.getElementById("errors");

function setInfo(msg) { infoDiv.textContent = msg; }
function setError(msg) { errorsDiv.textContent = msg; }
function clearError() { errorsDiv.textContent = ""; }

function renderHistory() {
  historyDiv.innerHTML = "";
  state.history.forEach((h, i) => {
    const el = document.createElement("div");
    el.textContent = `${i+1}. ${h.guess} — ${h.accepted ? "✅" : "❌"} ${h.ratio ? `(${h.ratio}%)` : ""}`;
    historyDiv.appendChild(el);
  });
}

function fetchSeed() {
  clearError();
  fetch("/api/seed-track")
    .then(r => r.json())
    .then(data => {
      if (data.needs_auth) {
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
      setInfo(`Artist hint: ${data.artists.join(", ")}`);
      renderHistory();
    })
    .catch(err => setError("Network error: " + err));
}

function playSnippet() {
  clearError();
  if (!state.track) { setError("No track loaded"); return; }
  fetch("/api/play-snippet", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ uri: state.track.uri, duration: SNIPPET_LENGTHS[state.round] })
  })
    .then(r => r.json())
    .then(res => {
      if (res.error) setError(res.error);
      else setInfo(`Played ${SNIPPET_LENGTHS[state.round]}s on your Spotify active device.`);
    })
    .catch(err => setError(err));
}

function submitGuess(ev) {
  ev.preventDefault();
  clearError();
  const guess = guessInput.value.trim();
  if (!guess) return;
  fetch("/api/check-guess", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ guess, correct_title: state.track.name })
  })
    .then(r => r.json())
    .then(res => {
      state.history.push(res);
      renderHistory();
      guessInput.value = "";
      if (res.accepted) setInfo(`Correct! 🎉 "${state.track.name}" — Artists: ${state.track.artists.join(", ")}`);
      else {
        state.round = Math.min(state.round + 1, SNIPPET_LENGTHS.length - 1);
        setInfo(`Wrong. Next snippet will be ${SNIPPET_LENGTHS[state.round]}s.`);
      }
    })
    .catch(err => setError(err));
}

playButton?.addEventListener("click", (e)=>{ e.preventDefault(); playSnippet(); });
newButton?.addEventListener("click", (e)=>{ e.preventDefault(); fetchSeed(); });
guessForm?.addEventListener("submit", submitGuess);

window.addEventListener("load", fetchSeed);
