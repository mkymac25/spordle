// static/app.js (robust version)
// - Waits for DOMContentLoaded
// - Defensive checks for element presence
// - Implements: play snippet -> /api/play-snippet, new song -> /api/seed-track
// - Guess checking -> /api/check-guess
// - 5-guess limit, hints on guesses 3-5, 5s persistent messages
// - Tracks stats: total correct and average attempts per correct song

(() => {
  "use strict";

  const SNIPPET_LENGTHS = [1, 2, 5, 7, 10];
  const MESSAGE_DISPLAY_MS = 5000;

  // App state
  let state = {
    track: null,
    round: 0,
    history: [],
    stats: {
      correctSongs: 0,
      totalAttemptsForCorrectSongs: 0
    },
    playing: false,
    pendingTimeoutId: null
  };

  // DOM refs (filled after DOM ready)
  let playButton, newButton, guessForm, guessInput, infoDiv, historyDiv, errorsDiv, statCorrectSpan, statAttemptsSpan;

  // Utilities
  const log = (...args) => console.log("[spordle]", ...args);
  const warn = (...args) => console.warn("[spordle]", ...args);
  const err = (...args) => console.error("[spordle]", ...args);

  function $(id) { return document.getElementById(id); }

  function setInfo(msg, persist=false) {
    if (!infoDiv) return;
    infoDiv.textContent = msg || "";
    // If message should auto-clear and there's an existing timeout, clear it first
    if (!persist) return;
    // persist = message should stay (we will clear on next action or after timeout where needed)
  }

  function setTimedInfo(msg, ms=MESSAGE_DISPLAY_MS) {
    if (!infoDiv) return;
    clearPendingTimeout();
    infoDiv.textContent = msg || "";
    state.pendingTimeoutId = setTimeout(() => {
      infoDiv.textContent = "";
      state.pendingTimeoutId = null;
    }, ms);
  }

  function clearPendingTimeout() {
    if (state.pendingTimeoutId) {
      clearTimeout(state.pendingTimeoutId);
      state.pendingTimeoutId = null;
    }
  }

  function setError(msg) {
    if (!errorsDiv) return;
    errorsDiv.textContent = msg || "";
  }

  function clearError() {
    if (!errorsDiv) return;
    errorsDiv.textContent = "";
  }

  function renderHistory() {
    if (!historyDiv) return;
    historyDiv.innerHTML = "";
    for (let i=0;i<state.history.length;i++){
      const h = state.history[i];
      const el = document.createElement("div");
      el.className = "history-item";
      const ratioText = (h.ratio !== undefined && h.ratio !== null) ? ` (${h.ratio}%)` : "";
      el.textContent = `${i+1}. ${h.guess} — ${h.accepted ? "✅" : "❌"}${ratioText}`;
      historyDiv.appendChild(el);
    }
    renderStats();
  }

  function renderStats() {
    if (!statCorrectSpan || !statAttemptsSpan) return;
    statCorrectSpan.textContent = state.stats.correctSongs;
    const avg = state.stats.correctSongs > 0
      ? (state.stats.totalAttemptsForCorrectSongs / state.stats.correctSongs).toFixed(2)
      : "—";
    statAttemptsSpan.textContent = avg;
  }

  // Fetch a seed track from server
  function fetchSeed() {
    clearError();
    clearPendingTimeout();
    setInfo("Fetching new track...");
    fetch("/api/seed-track")
      .then(r => r.json())
      .then(data => {
        if (data.needs_auth) {
          setError("Please connect your Spotify account (go to landing page).");
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
        updatePlayButtonState();
        renderHistory();
        setInfo(""); // clear the "Fetching" text; UI can show artist hint only on 3rd guess
        log("Loaded track", state.track);
      })
      .catch(e => {
        setError("Network error while fetching track: " + e);
        setInfo("");
        err(e);
      });
  }

  // Play snippet by asking backend to start playback on user's active device.
  function playSnippet() {
    clearError();
    clearPendingTimeout();
    if (!state.track) { setError("No track loaded. Click New song."); return; }
    if (state.playing) { setError("Snippet already playing — please wait."); return; }

    const duration = SNIPPET_LENGTHS[Math.min(state.round, SNIPPET_LENGTHS.length - 1)];
    setInfo(`Requesting ${duration}s on your active Spotify device...`);
    state.playing = true;
    updatePlayButtonState();

    fetch("/api/play-snippet", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ uri: state.track.uri, duration })
    })
    .then(r => r.json())
    .then(j => {
      state.playing = false;
      updatePlayButtonState();
      if (j.error) {
        setError(j.error);
        setInfo("");
        return;
      }
      // show a transient message (non-persistent) to prompt guess
      setInfo(`Played ${duration}s. Make a guess!`);
    })
    .catch(e => {
      state.playing = false;
      updatePlayButtonState();
      setError("Network error during play: " + e);
      setInfo("");
      err(e);
    });
  }

  function updatePlayButtonState() {
    if (!playButton) return;
    playButton.disabled = !!state.playing;
    playButton.textContent = state.playing ? "Playing…" : "Play snippet";
  }

  // Guess submission logic with 5-guess limit, hints on guesses 3-5, 5s persistent messages
  function submitGuess(ev) {
    ev && ev.preventDefault && ev.preventDefault();
    clearError();
    clearPendingTimeout();
    if (!state.track) { setError("No track loaded."); return; }
    const guess = (guessInput && guessInput.value || "").trim();
    if (!guess) return;

    setInfo("Checking guess...");
    fetch("/api/check-guess", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
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
      if (guessInput) guessInput.value = "";

      // Hint only on guesses 3-5 (state.round is 0-indexed; show hint before increasing round)
      if (state.round >= 2 && state.round < 5) {
        setInfo(`Hint: Artist(s) — ${state.track.artists.join(", ")}`);
      }

      if (res.accepted) {
        const attemptNumber = Math.min(state.round + 1, SNIPPET_LENGTHS.length);
        state.stats.correctSongs += 1;
        state.stats.totalAttemptsForCorrectSongs += attemptNumber;
        renderStats();
        // Show persistent success message for 5s, then fetch next
        setTimedInfo(`✅ Correct! "${state.track.name}" — guessed on attempt #${attemptNumber}. Total correct: ${state.stats.correctSongs}`, MESSAGE_DISPLAY_MS);
        // after MESSAGE_DISPLAY_MS, fetch next
        setTimeout(() => { fetchSeed(); }, MESSAGE_DISPLAY_MS);
        // reset per-song state immediately so UI is ready after fetch
        state.round = 0;
        state.history = [];
      } else {
        // incorrect guess
        state.round++;
        if (state.round >= 5) {
          // Lost this song
          setTimedInfo(`❌ Max guesses reached. The song was "${state.track.name}" by ${state.track.artists.join(", ")}`, MESSAGE_DISPLAY_MS);
          setTimeout(() => { fetchSeed(); }, MESSAGE_DISPLAY_MS);
          state.round = 0;
          state.history = [];
        } else {
          const snippetDuration = SNIPPET_LENGTHS[Math.min(state.round, SNIPPET_LENGTHS.length - 1)];
          // show next snippet message (non-persistent) for user, do not auto-play
          setInfo(`❌ Wrong. Next snippet will be ${snippetDuration}s.`);
        }
      }
    })
    .catch(e => {
      setError("Network error checking guess: " + e);
      setInfo("");
      err(e);
    });
  }

  // Attach event listeners defensively
  function attachHandlers() {
    if (playButton) {
      playButton.addEventListener("click", (e) => { e && e.preventDefault && e.preventDefault(); playSnippet(); });
    } else warn("playButton missing, cannot attach click.");

    if (newButton) {
      newButton.addEventListener("click", (e) => { e && e.preventDefault && e.preventDefault(); fetchSeed(); });
    } else warn("newButton missing, cannot attach click.");

    if (guessForm) {
      guessForm.addEventListener("submit", submitGuess);
    } else warn("guessForm missing, cannot attach submit.");
  }

  // Sanity-check DOM elements exist
  function findElements() {
    playButton = $("play-snippet");
    newButton  = $("fetch-new");
    guessForm  = $("guess-form");
    guessInput = $("guess-input");
    infoDiv    = $("info");
    historyDiv = $("history");
    errorsDiv  = $("errors");
    statCorrectSpan = $("stat-correct");
    statAttemptsSpan = $("stat-attempts");

    const ids = [
      ["play-snippet", playButton],
      ["fetch-new", newButton],
      ["guess-form", guessForm],
      ["guess-input", guessInput],
      ["info", infoDiv],
      ["history", historyDiv],
      ["errors", errorsDiv],
      ["stat-correct", statCorrectSpan],
      ["stat-attempts", statAttemptsSpan]
    ];
    ids.forEach(([name, el]) => {
      if (!el) warn(`Missing element with id="${name}" — app will not function fully.`);
      else log(`Found element id="${name}"`);
    });
  }

  // Initialize app after DOM ready
  function init() {
    try {
      findElements();
      attachHandlers();
      renderStats();

      // Quick session check then fetch a seed
      fetch("/api/session-info")
        .then(r => r.json())
        .then(si => {
          if (si.needs_auth) {
            setError("Please Connect Spotify on landing page first.");
            setInfo("");
          } else {
            fetchSeed();
          }
        })
        .catch(e => {
          // still try to fetch seed; if it fails server will respond with correct error
          log("session-info fetch error (continuing):", e);
          fetchSeed();
        });

      log("Spordle frontend initialized");
    } catch (e) {
      err("Initialization error:", e);
    }
  }

  // Wait for DOMContentLoaded before init (handles scripts placed in head)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    // DOM already ready
    init();
  }

})();
