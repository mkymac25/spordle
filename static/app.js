// static/app.js
(() => {
  const SNIPPETS = [1, 2, 3, 5, 7];
  const MAX_GUESSES = 5;
  const STARTUP_WAIT_MS = 5000; // 5 seconds buffer after loading a new track

  let currentTrack = null;
  // guesses is array of { text: string, accepted: boolean|null }
  let guesses = [];
  let guessCount = 0;
  let snippetIndex = 0; // which guess we're currently on
  let snippetPlaying = false;
  let waitingForSnippet = false;

  // DOM refs (set on DOMContentLoaded)
  let playBtn = null;
  let playContainer = null;
  let guessInput = null;
  let submitBtn = null;
  let feedbackEl = null;
  let guessesList = null;
  let logoutBtn = null;

  // restore the Play Snippet button inside playContainer and wire it up
  function restorePlayButton(initialLabel = `Play ${SNIPPETS[0]}s Snippet`) {
    if (!playContainer) return;
    playContainer.innerHTML = ''; // clear whatever's there
    const btn = document.createElement('button');
    btn.id = 'playSnippet';
    btn.className = 'btn primary';
    btn.disabled = true; // will be enabled after prepare wait
    btn.textContent = initialLabel;
    playContainer.appendChild(btn);

    // update the reference and attach listener
    playBtn = document.getElementById('playSnippet');
    if (playBtn) {
      playBtn.addEventListener('click', playSnippet);
    }
  }

  // fetch a new seed track and reset state
  async function fetchTrack() {
    // ensure the play button is present (restore if it was replaced)
    restorePlayButton();

    setPlayDisabled(true, "Loading...");
    try {
      const res = await fetch("/api/seed-track");
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        feedbackEl.textContent = err.error || "No tracks available.";
        setPlayDisabled(true, "Unavailable");
        currentTrack = null;
        return;
      }
      currentTrack = await res.json();
      guesses = [];
      guessCount = 0;
      snippetIndex = 0;
      renderGuesses();
      feedbackEl.textContent = "";

      // wait a short buffer before enabling snippet button
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
      currentTrack = null;
    }
  }

  function setPlayDisabled(disabled, label) {
    if (!playBtn) return;
    playBtn.disabled = !!disabled;
    if (label !== undefined) playBtn.textContent = label;
    playBtn.classList.toggle("disabled", !!disabled);
  }

  // re-render the guesses list with emojis
  function renderGuesses() {
    if (!guessesList) return;
    guessesList.innerHTML = "";
    guesses.forEach((g, i) => {
      const li = document.createElement("li");
      li.className = "guess-item";
      const mark = g.accepted === true ? " ✅" : (g.accepted === false ? " ❌" : "");
      li.textContent = `${i + 1}. ${g.text}${mark}`;
      guessesList.appendChild(li);
    });
  }

  // play current snippet (does NOT advance snippetIndex)
  async function playSnippet() {
    if (!currentTrack || snippetPlaying || waitingForSnippet) return;
    snippetPlaying = true;

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
        console.error("play-snippet error:", data);
        feedbackEl.textContent = "Could not play snippet: " + (data.error || res.statusText);
      } else {
        // snippet finished (backend paused)
        feedbackEl.textContent = `Snippet finished (${duration}s).`;
        // keep snippetIndex unchanged — user can replay same snippet
        setPlayDisabled(false, `Play ${SNIPPETS[idx]}s Snippet`);
      }
    } catch (err) {
      console.error("play-snippet network error", err);
      feedbackEl.textContent = "Network error while requesting snippet.";
      setPlayDisabled(false, `Play ${SNIPPETS[Math.min(snippetIndex, SNIPPETS.length - 1)]}s Snippet`);
    } finally {
      snippetPlaying = false;
    }
  }

  // request backend to start full playback (position 0) and not auto-pause
  async function playFull() {
    if (!currentTrack) return;
    // Replace the play button with the song title & artist (also disables it visually)
    replacePlayWithSongTitle();

    feedbackEl.textContent = "Starting full playback on your Spotify device...";
    try {
      const res = await fetch("/api/play-snippet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uri: currentTrack.uri, full: true })
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("play-full error:", data);
        feedbackEl.textContent = "Could not start full playback: " + (data.error || res.statusText);
      } else {
        feedbackEl.textContent = "Playing full song on your Spotify device...";
      }
    } catch (err) {
      console.error("play-full network error", err);
      feedbackEl.textContent = "Network error while requesting full playback.";
    }
  }

  // submit a guess; advance snippet only when guess is incorrect
  async function submitGuess() {
    if (!guessInput || !currentTrack) return;
    const text = guessInput.value.trim();
    if (!text) return;

    // clear and focus
    guessInput.value = "";
    guessInput.focus();

    let data;
    try {
      const res = await fetch("/api/check-guess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guess: text })
      });
      data = await res.json();
      if (!res.ok) {
        console.error("/api/check-guess error:", data);
        feedbackEl.textContent = data.error || "Error checking guess";
        return;
      }
    } catch (err) {
      console.error("check-guess network error", err);
      feedbackEl.textContent = "Network error while checking guess.";
      return;
    }

    // store guess result (accepted true/false)
    guesses.push({ text: text, accepted: !!data.accepted });
    guessCount++;
    renderGuesses();

    if (data.accepted) {
      feedbackEl.innerHTML = `✅ Correct! The song was "<strong>${escapeHtml(data.correct_title_raw)}</strong>"`;
      // replace Play button with title/artist
      replacePlayWithSongTitle();
      // play full song from start
      await playFull();
      // report result
      reportResult(true, guessCount, currentTrack.id).catch(console.error);
      setTimeout(fetchTrack, 6000);
      return;
    }

    // incorrect guess: advance snippet index (so next wrong guess will request longer snippet)
    if (snippetIndex < SNIPPETS.length - 1) snippetIndex++;

    if (guessCount >= MAX_GUESSES) {
      // out of guesses
      feedbackEl.innerHTML = `❌ Out of guesses. The song was "<strong>${escapeHtml(data.correct_title_raw)}</strong>"`;
      // show title/artist
      replacePlayWithSongTitle();
      await playFull();
      reportResult(false, guessCount, currentTrack.id).catch(console.error);
      setTimeout(fetchTrack, 6000);
      return;
    }

    const remaining = MAX_GUESSES - guessCount;
    feedbackEl.textContent = `❌ Incorrect — ${remaining} guess${remaining === 1 ? "" : "es"} left.`;
    // play button label should reflect current snippet duration (no auto-increment on playing)
    setPlayDisabled(false, `Play ${SNIPPETS[Math.min(snippetIndex, SNIPPETS.length - 1)]}s Snippet`);
  }

  // Replace the play button inside the playContainer with title & artist text
  function replacePlayWithSongTitle() {
    if (!playContainer || !currentTrack) return;
    const title = currentTrack.name || "";
    const artists = (currentTrack.artists || []).join(", ");
    const span = document.createElement("div");
    span.className = "song-title-display";
    span.innerHTML = `<div class="song-title-text">${escapeHtml(title)}</div><div class="song-artist-text">${escapeHtml(artists)}</div>`;
    // replace contents of playContainer
    playContainer.innerHTML = "";
    playContainer.appendChild(span);
    // ensure playBtn reference is cleared (so no accidental clicks)
    playBtn = null;
  }

  // send result to backend
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

  // hookup DOM and events
  document.addEventListener("DOMContentLoaded", () => {
    playContainer = document.getElementById("playContainer");
    guessInput = document.getElementById("guessInput");
    submitBtn = document.getElementById("submitGuess");
    feedbackEl = document.getElementById("feedback");
    guessesList = document.getElementById("guessesList");
    logoutBtn = document.getElementById("logoutBtn");

    if (!playContainer || !guessInput || !submitBtn || !feedbackEl || !guessesList) {
      console.error("Missing DOM elements required by app.js");
      return;
    }

    // create initial play button
    restorePlayButton();

    // wire inputs
    submitBtn.addEventListener("click", submitGuess);
    guessInput.addEventListener("keyup", (e) => { if (e.key === "Enter") submitGuess(); });

    // initial load
    fetchTrack();
  });

  // Expose for debugging
  window._guessify = { fetchTrack, playSnippet, submitGuess, playFull };
})();
