// static/app.js (robust + persistence reporting)
// - Waits for DOMContentLoaded
// - Uses /api/session-played-count to show session played and persisted stats
// - Calls /api/report-result when a song is won or lost

(() => {
  "use strict";

  const SNIPPET_LENGTHS = [1, 2, 5, 7, 10];
  const MESSAGE_DISPLAY_MS = 5000;

  let state = {
    track: null,
    round: 0,
    history: [],
    stats: {
      // local mirror of persisted stats (kept in sync from server responses)
      correctSongs: 0,
      totalAttemptsForCorrectSongs: 0,
      songsPlayedPersisted: 0
    },
    playing: false,
    pendingTimeoutId: null
  };

  // DOM refs
  let playButton, newButton, guessForm, guessInput, infoDiv, historyDiv, errorsDiv;
  let statPlayedSpan, statCorrectSpan, statAttemptsSpan;

  const log = (...args) => console.log("[spordle]", ...args);
  const warn = (...args) => console.warn("[spordle]", ...args);
  const err = (...args) => console.error("[spordle]", ...args);

  function $(id) { return document.getElementById(id); }

  function setInfo(msg) { if (infoDiv) infoDiv.textContent = msg || ""; }
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
  function setError(msg) { if (errorsDiv) errorsDiv.textContent = msg || ""; }
  function clearError() { if (errorsDiv) errorsDiv.textContent = ""; }

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
  }

  function renderStatsLocalAndPersisted(serverStats) {
    // serverStats is optional; if provided, update local mirror
    if (serverStats) {
      state.stats.correctSongs = serverStats.correctSongs || 0;
      state.stats.totalAttemptsForCorrectSongs = serverStats.totalAttemptsForCorrect || 0;
      state.stats.songsPlayedPersisted = serverStats.songsPlayed || 0;
    }
    if (statCorrectSpan) statCorrectSpan.textContent = state.stats.correctSongs;
    if (statAttemptsSpan) {
      const avg = state.stats.correctSongs > 0
        ? (state.stats.totalAttemptsForCorrectSongs / state.stats.correctSongs).toFixed(2)
        : "—";
      statAttemptsSpan.textContent = avg;
    }
  }

  function updatePlayedCount(n) {
    if (statPlayedSpan) statPlayedSpan.textContent = n;
  }

  // Query session/play count & persisted stats
  function refreshSessionAndPersistedStats() {
    fetch("/api/session-played-count")
      .then(r => r.json())
      .then(j => {
        if (j.needs_auth) {
          setError("Please connect Spotify on the landing page.");
          return;
        }
        updatePlayedCount(j.session_played || 0);
        if (j.user_stats) {
          renderStatsLocalAndPersisted(j.user_stats);
        }
      })
      .catch(e => {
        warn("session-played-count fetch failed:", e);
      });
  }

  // Fetch a seed track
  function fetchSeed() {
    clearError();
    clearPendingTimeout();
    setInfo("Fetching new track...");
    fetch("/api/seed-track")
      .then(r => {
        if (r.status === 404) {
          // possibly no-more-tracks
          return r.json().then(j => { throw j; });
        }
        return r.json();
      })
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
        updatePlayButtonState();
        renderHistory();
        setInfo(""); // hint logic shows artist later if needed
        refreshSessionAndPersistedStats();
        log("Loaded track", state.track);
      })
      .catch(errObj => {
        // if server returned no-more-tracks, show friendly message
        if (errObj && errObj.error === "no-more-tracks") {
          setError("No more unplayed tracks available in this session.");
          setInfo("");
        } else {
          setError("Network error while fetching track.");
          setInfo("");
        }
      });
  }

  // Report result to backend for persistence
  function reportResultToServer(accepted, attempts) {
    if (!state.track) return;
    fetch("/api/report-result", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ track_id: state.track.id || state.track.uri, accepted: !!accepted, attempts: attempts || 0 })
    })
      .then(r => r.json())
      .then(j => {
        if (j && j.user_stats) {
          // update local mirror and UI
          renderStatsLocalAndPersisted(j.user_stats);
        }
        refreshSessionAndPersistedStats();
      })
      .catch(e => {
        warn("report-result failed:", e);
      });
  }

  // Play snippet
  function playSnippet() {
    clearError();
    clearPendingTimeout();
    if (!state.track) { setError("No track loaded — click New song."); return; }
    if (state.playing) { setError("Snippet already playing — wait."); return; }
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
      setInfo(`Played ${duration}s. Make a guess!`);
    })
    .catch(e => {
      state.playing = false;
      updatePlayButtonState();
      setError("Network error during play: " + e);
      setInfo("");
    });
  }

  function updatePlayButtonState() {
    if (!playButton) return;
    playButton.disabled = !!state.playing;
    playButton.textContent = state.playing ? "Playing…" : "Play snippet";
  }

  // Submit guess
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

      // Hint on guesses 3-5
      if (state.round >= 2 && state.round < 5) {
        setInfo(`Hint: Artist(s) — ${state.track.artists.join(", ")}`);
      }

      if (res.accepted) {
        const attemptNumber = Math.min(state.round + 1, SNIPPET_LENGTHS.length);
        // report to server before moving on
        reportResultToServer(true, attemptNumber);
        setTimedInfo(`✅ Correct! "${state.track.name}" — guessed on attempt #${attemptNumber}.`, MESSAGE_DISPLAY_MS);
        // after message, load next
        setTimeout(() => { fetchSeed(); }, MESSAGE_DISPLAY_MS);
        state.round = 0;
        state.history = [];
      } else {
        state.round++;
        if (state.round >= 5) {
          // report a failed song (attempts = 5)
          reportResultToServer(false, 5);
          setTimedInfo(`❌ Max guesses reached. The song was "${state.track.name}" by ${state.track.artists.join(", ")}`, MESSAGE_DISPLAY_MS);
          setTimeout(() => { fetchSeed(); }, MESSAGE_DISPLAY_MS);
          state.round = 0;
          state.history = [];
        } else {
          const snippetDuration = SNIPPET_LENGTHS[Math.min(state.round, SNIPPET_LENGTHS.length - 1)];
          setInfo(`❌ Wrong. Next snippet will be ${snippetDuration}s.`);
        }
      }
    })
    .catch(e => {
      setError("Network error checking guess: " + e);
      setInfo("");
    });
  }

  // Attach handlers
  function attachHandlers() {
    if (playButton) playButton.addEventListener("click", (e)=>{ e && e.preventDefault && e.preventDefault(); playSnippet();});
    if (newButton)  newButton.addEventListener("click", (e)=>{ e && e.preventDefault && e.preventDefault(); fetchSeed();});
    if (guessForm)  guessForm.addEventListener("submit", submitGuess);
  }

  function findElements() {
    playButton = $("play-snippet");
    newButton  = $("fetch-new");
    guessForm  = $("guess-form");
    guessInput = $("guess-input");
    infoDiv    = $("info");
    historyDiv = $("history");
    errorsDiv  = $("errors");
    statPlayedSpan = $("stat-played");
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
      ["stat-played", statPlayedSpan],
      ["stat-correct", statCorrectSpan],
      ["stat-attempts", statAttemptsSpan]
    ];
    ids.forEach(([name, el]) => {
      if (!el) warn(`Missing element with id="${name}" — app will not function fully.`);
      else log(`Found element id="${name}"`);
    });
  }

  function init() {
    try {
      findElements();
      attachHandlers();
      // initial stats
      renderStatsLocalAndPersisted(null);
      refreshSessionAndPersistedStats(); // fills UI
      // load a track
      fetchSeed();
      log("Spordle frontend initialized");
    } catch (e) {
      err("Initialization error:", e);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
