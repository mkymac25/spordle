// static/app.js
(() => {
  const SNIPPETS = [1, 2, 3, 5, 7];
  const MAX_GUESSES = 5;
  const STARTUP_WAIT_MS = 5000; // 5 seconds delay after track loads

  let currentTrack = null;
  let guesses = [];
  let guessCount = 0;
  let snippetIndex = 0;
  let snippetPlaying = false;
  let waitingForSnippet = false;

  // DOM references (will be assigned in DOMContentLoaded)
  let playBtn, guessInput, submitBtn, feedbackEl, guessesList, logoutBtn;

  async function fetchTrack() {
    if (!playBtn || !feedbackEl) return;
    // Disable play while loading & show preparing text
    setPlayDisabled(true, "Loading...");

    try {
      const res = await fetch("/api/seed-track");
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        feedbackEl.textContent = err.error || "No tracks available.";
        setPlayDisabled(true, "Unavailable");
        return;
      }
      currentTrack = await res.json();
      guesses = [];
      guessCount = 0;
      snippetIndex = 0;
      renderGuesses();
      feedbackEl.textContent = "";

      // wait 5 seconds before enabling snippet to allow Spotify to spin up
      waitingForSnippet = true;
      setPlayDisabled(true, "Preparing...");
      setTimeout(() => {
        waitingForSnippet = false;
        setPlayDisabled(false, `Play ${SNIPPETS[0]}s Snippet`);
      }, STARTUP_WAIT_MS);
    } catch (err) {
      console.error("fetchTrack error", err);
      feedbackEl.textContent = "Network error loading track";
      setPlayDisabled(true, "Error");
    }
  }

  function setPlayDisabled(disabled, label) {
    if (!playBtn) return;
    playBtn.disabled = !!disabled;
    if (typeof label === "string") playBtn.textContent = label;
    if (disabled) {
      playBtn.classList.add("disabled");
    } else {
      playBtn.classList.remove("disabled");
    }
  }

  function renderGuesses() {
    if (!guessesList) return;
    guessesList.innerHTML = "";
    guesses.forEach((g, i) => {
      const li = document.createElement("li");
      li.className = "guess-item";
      li.textContent = `${i + 1}. ${g}`;
      guessesList.appendChild(li);
    });
  }

  async function playSnippet() {
    if (!currentTrack || snippetPlaying || waitingForSnippet) return;
    snippetPlaying = true;

    // choose duration based on attempt index
    const idx = Math.min(snippetIndex, SNIPPETS.length - 1);
    const duration = SNIPPETS[idx];

    setPlayDisabled(true, `Playing ${duration}s...`);
    feedbackEl.textContent = `Playing ${duration}s snippet on your Spotify device...`;

    try {
      const res = await fetch("/api/play-snippet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uri: currentTrack.uri, duration: duration, full: false })
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("play-snippet error", data);
        feedbackEl.textContent = "Could not play snippet: " + (data.error || res.statusText);
      } else {
        // snippet ended (backend paused). prepare next snippet label
        snippetIndex++;
        const nextIdx = Math.min(snippetIndex, SNIPPETS.length - 1);
        setPlayDisabled(false, `Play ${SNIPPETS[nextIdx]}s Snippet`);
        feedbackEl.textContent = `Snippet finished (${duration}s).`;
      }
    } catch (err) {
      console.error("play-snippet network error", err);
      feedbackEl.textContent = "Network error while requesting snippet.";
      setPlayDisabled(false, `Play ${SNIPPETS[Math.min(snippetIndex, SNIPPETS.length - 1)]}s Snippet`);
    } finally {
      snippetPlaying = false;
    }
  }

  async function playFull() {
    if (!currentTrack) return;
    setPlayDisabled(true, "Playing full song...");
    feedbackEl.textContent = "Starting full playback on your Spotify device...";
    try {
      const res = await fetch("/api/play-snippet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uri: currentTrack.uri, full: true })
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("play-full error", data);
        feedbackEl.textContent = "Could not start full playback: " + (data.error || res.statusText);
      } else {
        feedbackEl.textContent = "Playing full song on your Spotify device...";
      }
    } catch (err) {
      console.error("play-full network error", err);
      feedbackEl.textContent = "Network error while requesting full playback.";
    }
  }

  async function submitGuess() {
    if (!guessInput || !currentTrack) return;
    const guess = guessInput.value.trim();
    if (!guess) return;

    guesses.push(guess);
    guessCount++;
    renderGuesses();
    guessInput.value = "";
    guessInput.focus();

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
        console.error("/api/check-guess error", data);
        feedbackEl.textContent = data.error || "Error checking guess";
        return;
      }
    } catch (err) {
      console.error("check-guess network error", err);
      feedbackEl.textContent = "Network error while checking guess.";
      return;
    }

    if (data.accepted) {
      feedbackEl.innerHTML = `✅ Correct! The song was "<strong">${escapeHtml(data.correct_title_raw)}</strong>"`;
      guessInput.disabled = true;
      submitBtn.disabled = true;
      await playFull();
      reportResult(true, guessCount, currentTrack.id).catch(console.error);
      setTimeout(fetchTrack, 6000);
      return;
    }

    if (guessCount >= MAX_GUESSES) {
      feedbackEl.innerHTML = `❌ Out of guesses. The song was "<strong>${escapeHtml(data.correct_title_raw)}</strong>"`;
      guessInput.disabled = true;
      submitBtn.disabled = true;
      await playFull();
      reportResult(false, guessCount, currentTrack.id).catch(console.error);
      setTimeout(fetchTrack, 6000);
      return;
    }

    const remaining = MAX_GUESSES - guessCount;
    feedbackEl.textContent = `❌ Incorrect — ${remaining} guess${remaining === 1 ? "" : "es"} left.`;
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
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  // DOMContentLoaded hookup — now DOM elements guaranteed to exist
  document.addEventListener("DOMContentLoaded", () => {
    playBtn = document.getElementById("playSnippet");
    guessInput = document.getElementById("guessInput");
    submitBtn = document.getElementById("submitGuess");
    feedbackEl = document.getElementById("feedback");
    guessesList = document.getElementById("guessesList");
    logoutBtn = document.getElementById("logoutBtn");

    // defensive checks
    if (!playBtn || !guessInput || !submitBtn || !feedbackEl || !guessesList) {
      console.error("Missing required DOM elements. Check template IDs.");
      return;
    }

    playBtn.addEventListener("click", playSnippet);
    submitBtn.addEventListener("click", submitGuess);

    guessInput.addEventListener("keyup", (e) => {
      if (e.key === "Enter") submitGuess();
    });

    // initial load
    fetchTrack();
  });
})();
