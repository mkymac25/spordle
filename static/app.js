// static/app.js
// Assumes backend endpoints from your app.py exist:
// GET  /api/seed-track
// POST /api/play-snippet   { uri, duration, full }
// POST /api/check-guess    { guess }
// POST /api/report-result  { accepted, attempts, track_id }

(() => {
  // snippet progression in seconds
  const SNIPPET_DURATIONS = [1, 2, 3, 5, 7];
  const MAX_GUESSES = 5;

  let currentTrack = null;
  let guesses = []; // array of strings
  let guessCount = 0;

  // DOM elements
  const playBtn = () => document.getElementById("playSnippet");
  const inputEl = () => document.getElementById("guessInput");
  const submitBtn = () => document.getElementById("submitGuess");
  const feedbackEl = () => document.getElementById("feedback");
  const guessesListEl = () => document.getElementById("guessesList");

  // Fetch a new seed track from backend and reset state
  async function fetchTrack() {
    try {
      const res = await fetch("/api/seed-track");
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        feedbackEl().textContent = err && err.error ? err.error : "No tracks available.";
        currentTrack = null;
        return;
      }
      const data = await res.json();
      currentTrack = data;
      guesses = [];
      guessCount = 0;
      renderGuesses();
      feedbackEl().textContent = "";
      inputEl().value = "";
      inputEl().disabled = false;
      submitBtn().disabled = false;
      // focus input for quick typing
      inputEl().focus();
      // (We purposely do NOT show track title/artist — backend returns title for check-guess)
      console.log("Loaded track:", currentTrack);
    } catch (err) {
      console.error("fetchTrack error:", err);
      feedbackEl().textContent = "Network error while fetching track.";
    }
  }

  // Request backend to play a snippet on user's active Spotify device
  async function playSnippet() {
    if (!currentTrack) return;
    const idx = Math.min(guessCount, SNIPPET_DURATIONS.length - 1);
    const duration = SNIPPET_DURATIONS[idx];

    try {
      const res = await fetch("/api/play-snippet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uri: currentTrack.uri, duration: duration, full: false })
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("play-snippet error:", data);
        feedbackEl().textContent = "Could not play snippet: " + (data.error || res.statusText);
      } else {
        // show a short message so user knows snippet was requested
        feedbackEl().textContent = `Playing ${duration}s snippet on your Spotify device...`;
      }
    } catch (err) {
      console.error("play-snippet network error:", err);
      feedbackEl().textContent = "Network error while requesting snippet.";
    }
  }

  // Ask backend to start full playback (position 0) and NOT auto-pause
  async function playFullTrack() {
    if (!currentTrack) return;
    try {
      const res = await fetch("/api/play-snippet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uri: currentTrack.uri, full: true })
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("play-full error:", data);
        feedbackEl().textContent = "Could not start full playback: " + (data.error || res.statusText);
      } else {
        feedbackEl().textContent = "Playing full song on your Spotify device...";
      }
    } catch (err) {
      console.error("play-full network error:", err);
      feedbackEl().textContent = "Network error while requesting full play.";
    }
  }

  // Submit a guess to backend, update UI and handle correct / out-of-guesses behavior
  async function submitGuess() {
    const guess = inputEl().value.trim();
    if (!guess || !currentTrack) return;

    // append guess locally and update list
    guesses.push(guess);
    guessCount++;
    renderGuesses();

    // clear input for next
    inputEl().value = "";
    inputEl().focus();

    // send guess to backend
    let data;
    try {
      const res = await fetch("/api/check-guess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guess: guess })
      });
      data = await res.json();
      if (!res.ok) {
        // if backend returned an error payload
        console.error("/api/check-guess error:", data);
        feedbackEl().textContent = data.error || "Error checking guess.";
        return;
      }
    } catch (err) {
      console.error("check-guess network error:", err);
      feedbackEl().textContent = "Network error while checking guess.";
      return;
    }

    // If accepted or out of guesses, reveal and play full
    if (data.accepted) {
      feedbackEl().innerHTML = `✅ Correct! The song was "<strong>${escapeHtml(data.correct_title_raw)}</strong>"`;
      // disable further input
      inputEl().disabled = true;
      submitBtn().disabled = true;

      await playFullTrack();

      // report result (attempts = guessCount)
      reportResult(true, guessCount, currentTrack.id).catch(console.error);

      // after a short delay, fetch next track
      setTimeout(fetchTrack, 6000);
      return;
    }

    if (guessCount >= MAX_GUESSES) {
      // last guess used — reveal correct title and play full
      feedbackEl().innerHTML = `❌ Out of guesses! The song was "<strong>${escapeHtml(data.correct_title_raw)}</strong>"`;
      inputEl().disabled = true;
      submitBtn().disabled = true;

      await playFullTrack();

      // report result as incorrect
      reportResult(false, guessCount, currentTrack.id).catch(console.error);

      setTimeout(fetchTrack, 6000);
      return;
    }

    // Otherwise incorrect but more guesses left
    const remaining = MAX_GUESSES - guessCount;
    feedbackEl().textContent = `❌ Incorrect — ${remaining} guess${remaining === 1 ? "" : "es"} left.`;
  }

  // Send result to backend to persist stats
  async function reportResult(accepted, attempts, track_id) {
    try {
      await fetch("/api/report-result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accepted: accepted, attempts: attempts, track_id: track_id })
      });
    } catch (err) {
      console.error("report-result error:", err);
    }
  }

  // Render guesses list
  function renderGuesses() {
    const ul = guessesListEl();
    ul.innerHTML = "";
    guesses.forEach((g, i) => {
      const li = document.createElement("li");
      li.className = "guess-item";
      li.textContent = `${i + 1}. ${g}`;
      ul.appendChild(li);
    });
  }

  // Utility: escape HTML for safety (small)
  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  // Hook up events after DOM loads
  document.addEventListener("DOMContentLoaded", () => {
    // Buttons / input
    const pBtn = playBtn();
    const sBtn = submitBtn();
    const input = inputEl();
    const logout = document.getElementById("logoutBtn");

    if (pBtn) pBtn.addEventListener("click", playSnippet);
    if (sBtn) sBtn.addEventListener("click", submitGuess);
    if (input) {
      input.addEventListener("keyup", (e) => {
        if (e.key === "Enter") submitGuess();
      });
    }
    if (logout) {
      // default link in template already handles logout - this keeps UX consistent
      logout.addEventListener("click", (e) => {
        // allow normal navigation
      });
    }

    // load first track
    fetchTrack();
  });

  // Export for testing (optional)
  window._guessify = {
    fetchTrack,
    playSnippet,
    submitGuess,
    playFullTrack,
  };
})();
