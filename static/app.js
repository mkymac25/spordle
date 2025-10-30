// static/app.js
(() => {
  const SNIPPETS = [1, 2, 3, 5, 7];
  const MAX_GUESSES = 5;

  let currentTrack = null;
  let guesses = [];
  let guessCount = 0;

  // DOM
  const playBtn = () => document.getElementById("playSnippet");
  const guessInput = () => document.getElementById("guessInput");
  const submitBtn = () => document.getElementById("submitGuess");
  const feedback = () => document.getElementById("feedback");
  const guessesList = () => document.getElementById("guessesList");

  async function fetchTrack() {
    try {
      const res = await fetch("/api/seed-track");
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        feedback().textContent = err.error || "No tracks available";
        currentTrack = null;
        return;
      }
      currentTrack = await res.json();
      guesses = [];
      guessCount = 0;
      renderGuesses();
      feedback().textContent = "";
      guessInput().value = "";
      guessInput().disabled = false;
      submitBtn().disabled = false;
      guessInput().focus();
      console.log("Loaded track:", currentTrack);
    } catch (err) {
      console.error("fetchTrack error", err);
      feedback().textContent = "Network error loading track";
    }
  }

  function renderGuesses() {
    const ul = guessesList();
    ul.innerHTML = "";
    for (let i = 0; i < guesses.length; i++) {
      const li = document.createElement("li");
      li.className = "guess-item";
      li.textContent = `${i + 1}. ${guesses[i]}`;
      ul.appendChild(li);
    }
  }

  // play a snippet (calls backend). Disables the button while request is in-flight.
  async function playSnippet() {
    if (!currentTrack) return;
    const idx = Math.min(guessCount, SNIPPETS.length - 1);
    const duration = SNIPPETS[idx];

    const btn = playBtn();
    if (btn) btn.disabled = true;
    feedback().textContent = `Playing ${duration}s snippet on your active Spotify device...`;

    try {
      const res = await fetch("/api/play-snippet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uri: currentTrack.uri, duration: duration, full: false })
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("play-snippet error", data);
        feedback().textContent = "Could not play snippet: " + (data.error || res.statusText);
      } else {
        // backend returns after pause; re-enable button now
        feedback().textContent = `Snippet finished (${duration}s).`;
      }
    } catch (err) {
      console.error("play-snippet network error", err);
      feedback().textContent = "Network error while requesting snippet.";
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // request backend to start full playback (position 0) and not auto-pause
  async function playFull() {
    if (!currentTrack) return;
    feedback().textContent = "Starting full playback on your Spotify device...";
    try {
      const res = await fetch("/api/play-snippet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uri: currentTrack.uri, full: true })
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("play-full error", data);
        feedback().textContent = "Could not start full playback: " + (data.error || res.statusText);
      } else {
        feedback().textContent = "Playing full song on your Spotify device...";
      }
    } catch (err) {
      console.error("play-full network error", err);
      feedback().textContent = "Network error while requesting full playback.";
    }
  }

  async function submitGuess() {
    const guess = guessInput().value.trim();
    if (!guess || !currentTrack) return;

    guesses.push(guess);
    guessCount++;
    renderGuesses();
    guessInput().value = "";
    guessInput().focus();

    // check guess
    let data;
    try {
      const res = await fetch("/api/check-guess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guess: guess })
      });
      data = await res.json();
      if (!res.ok) {
        console.error("/api/check-guess error", data);
        feedback().textContent = data.error || "Error checking guess";
        return;
      }
    } catch (err) {
      console.error("check-guess network error", err);
      feedback().textContent = "Network error while checking guess.";
      return;
    }

    if (data.accepted) {
      feedback().innerHTML = `✅ Correct! The song was "<strong>${escapeHtml(data.correct_title_raw)}</strong>"`;
      guessInput().disabled = true;
      submitBtn().disabled = true;

      // play full from start
      await playFull();

      // report result
      reportResult(true, guessCount, currentTrack.id).catch(console.error);

      // next track after short delay
      setTimeout(fetchTrack, 6000);
      return;
    }

    if (guessCount >= MAX_GUESSES) {
      feedback().innerHTML = `❌ Out of guesses. The song was "<strong>${escapeHtml(data.correct_title_raw)}</strong>"`;
      guessInput().disabled = true;
      submitBtn().disabled = true;

      // play full
      await playFull();

      reportResult(false, guessCount, currentTrack.id).catch(console.error);

      setTimeout(fetchTrack, 6000);
      return;
    }

    // incorrect but more guesses left
    const remaining = MAX_GUESSES - guessCount;
    feedback().textContent = `❌ Incorrect — ${remaining} guess${remaining === 1 ? "" : "es"} left.`;
  }

  async function reportResult(accepted, attempts, track_id) {
    try {
      await fetch("/api/report-result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accepted: accepted, attempts: attempts, track_id: track_id })
      });
    } catch (err) {
      console.error("report-result error", err);
    }
  }

  function escapeHtml(str) {
    return String(str).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }

  // hookup
  document.addEventListener("DOMContentLoaded", () => {
    const p = playBtn();
    const s = submitBtn();
    const input = guessInput();

    if (p) p.addEventListener("click", playSnippet);
    if (s) s.addEventListener("click", submitGuess);
    if (input) input.addEventListener("keyup", (e) => { if (e.key === "Enter") submitGuess(); });

    fetchTrack();
  });

  // expose for debug
  window._guessify = { fetchTrack, playSnippet, submitGuess, playFull };
})();
