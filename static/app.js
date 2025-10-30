let currentTrack = null;
let guessCount = 0;
const maxGuesses = 5;
const snippetDurations = [1, 2, 3, 5, 7];
let snippetIndex = 0;
let snippetPlaying = false;
let waitingForSnippet = false;

const playSnippetBtn = document.getElementById("playSnippet");
const guessInput = document.getElementById("guessInput");
const submitGuessBtn = document.getElementById("submitGuess");
const guessesList = document.getElementById("guessesList");
const message = document.getElementById("message");
const logoutBtn = document.getElementById("logoutBtn");

async function loadNextTrack() {
  disableSnippetButton("Loading...");
  const res = await fetch("/api/seed-track");
  if (!res.ok) {
    message.textContent = "No more tracks available or error.";
    disableSnippetButton("Unavailable");
    return;
  }

  currentTrack = await res.json();
  guessCount = 0;
  snippetIndex = 0;
  guessesList.innerHTML = "";
  message.textContent = "";

  // Wait 5 seconds before enabling snippet button
  waitingForSnippet = true;
  disableSnippetButton("Preparing...");
  setTimeout(() => {
    waitingForSnippet = false;
    enableSnippetButton("Play 1s Snippet");
  }, 5000);
}

function disableSnippetButton(text) {
  playSnippetBtn.disabled = true;
  playSnippetBtn.textContent = text;
  playSnippetBtn.classList.add("opacity-50", "cursor-not-allowed");
}

function enableSnippetButton(text) {
  playSnippetBtn.disabled = false;
  playSnippetBtn.textContent = text;
  playSnippetBtn.classList.remove("opacity-50", "cursor-not-allowed");
}

playSnippetBtn.addEventListener("click", async () => {
  if (!currentTrack || snippetPlaying || waitingForSnippet) return;
  snippetPlaying = true;

  const duration = snippetDurations[Math.min(snippetIndex, snippetDurations.length - 1)];
  disableSnippetButton(`Playing ${duration}s...`);

  const res = await fetch("/api/play-snippet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uri: currentTrack.uri, duration }),
  });

  if (!res.ok) {
    message.textContent = "Error playing snippet. Make sure Spotify is open.";
  }

  snippetIndex++;
  if (snippetIndex < snippetDurations.length) {
    enableSnippetButton(`Play ${snippetDurations[snippetIndex]}s Snippet`);
  } else {
    enableSnippetButton("Replay 7s Snippet");
  }

  snippetPlaying = false;
});

async function submitGuess() {
  const guess = guessInput.value.trim();
  if (!guess || !currentTrack) return;

  const res = await fetch("/api/check-guess", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guess }),
  });

  const data = await res.json();
  guessInput.value = "";
  const guessItem = document.createElement("li");
  guessItem.textContent = guess;
  guessesList.appendChild(guessItem);

  guessCount++;

  if (data.accepted) {
    message.textContent = `✅ Correct! ${currentTrack.name} – ${currentTrack.artists.join(", ")}`;
    playFullTrack();
  } else if (guessCount >= maxGuesses) {
    message.textContent = `❌ Out of guesses! The song was ${currentTrack.name} – ${currentTrack.artists.join(", ")}.`;
    playFullTrack();
  } else {
    message.textContent = `Wrong guess (${guessCount}/${maxGuesses})`;
  }
}

async function playFullTrack() {
  disableSnippetButton("Playing full song...");
  await fetch("/api/play-snippet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uri: currentTrack.uri, duration: 30 }), // play full song (adjust duration if you like)
  });

  setTimeout(() => loadNextTrack(), 3000);
}

submitGuessBtn.addEventListener("click", submitGuess);

// Allow pressing Enter to submit
guessInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitGuess();
});

logoutBtn.addEventListener("click", () => {
  window.location.href = "/logout";
});

// Initial load
loadNextTrack();
