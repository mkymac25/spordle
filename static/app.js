// static/js/app.js
// Frontend logic: seed track, play snippet (via backend), submit guesses,
// show guesses list, enforce 5 guesses, reveal song on correct or out-of-guesses,
// and request backend to play the full song from the beginning when finished.

let currentTrack = null;
let guessesCount = 0;
const maxGuesses = 5;

async function fetchTrack() {
    const res = await fetch("/api/seed-track");
    if (!res.ok) {
        document.getElementById("track-name").textContent = "No tracks available!";
        return;
    }
    const data = await res.json();
    currentTrack = data;
    guessesCount = 0;

    document.getElementById("song-info").style.display = "none";
    document.getElementById("track-name").textContent = data.name;
    document.getElementById("track-artists").textContent = data.artists.join(", ");

    // Clear previous guesses
    document.getElementById("guesses-list").innerHTML = "";
    document.getElementById("feedback").textContent = "";
    document.getElementById("guess-input").value = "";
    document.getElementById("guess-input").disabled = false;
    document.getElementById("guess-btn").disabled = false;
}

async function playSnippet() {
    if (!currentTrack) return;

    const duration = 5; // seconds
    try {
        const res = await fetch("/api/play-snippet", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({uri: currentTrack.uri, duration: duration, full: false})
        });
        const data = await res.json();
        if (data.error) {
            console.error("play-snippet error:", data.error);
            alert("Error playing snippet: " + data.error);
        }
    } catch (err) {
        console.error("Network/play-snippet error:", err);
        alert("Error contacting server to play snippet.");
    }
}

async function playFullSong() {
    if (!currentTrack) return;

    try {
        const res = await fetch("/api/play-snippet", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            // request full playback (backend will NOT auto-pause)
            body: JSON.stringify({uri: currentTrack.uri, full: true})
        });
        const data = await res.json();
        if (data.error) {
            console.error("play-full error:", data.error);
            alert("Error playing full song: " + data.error);
        }
    } catch (err) {
        console.error("Network/play-full error:", err);
        alert("Error contacting server to play full song.");
    }
}

async function submitGuess() {
    const guessInput = document.getElementById("guess-input");
    const guess = guessInput.value.trim();
    if (!guess || !currentTrack) return;

    const res = await fetch("/api/check-guess", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({guess: guess})
    });
    const data = await res.json();

    // Add guess to list
    guessesCount++;
    const li = document.createElement("li");
    li.textContent = guess + (data.accepted ? " ✅" : " ❌");
    document.getElementById("guesses-list").appendChild(li);

    const fb = document.getElementById("feedback");

    // Correct guess or max guesses reached
    if (data.accepted || guessesCount >= maxGuesses) {
        fb.textContent = data.accepted
            ? `Correct! 🎉 The song was "${data.correct_title_raw}"`
            : `Out of guesses! The song was "${data.correct_title_raw}"`;

        // Show song info (title/artist)
        document.getElementById("song-info").style.display = "block";

        // Disable input
        guessInput.disabled = true;
        document.getElementById("guess-btn").disabled = true;

        // Play full song from start on user's active Spotify device
        await playFullSong();

        // Report result to backend (attempts can be guessesCount)
        try {
            await fetch("/api/report-result", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({accepted: !!data.accepted, attempts: guessesCount, track_id: currentTrack.id})
            });
        } catch (err) {
            console.error("report-result error:", err);
        }

        // After a short delay, load next track
        setTimeout(fetchTrack, 5000);
    } else {
        fb.textContent = `Wrong! You have ${maxGuesses - guessesCount} guesses left.`;
        guessInput.value = "";
        guessInput.focus();
    }
}

// Event listeners
document.addEventListener("DOMContentLoaded", () => {
    const playBtn = document.getElementById("play-btn");
    const guessBtn = document.getElementById("guess-btn");
    const guessInput = document.getElementById("guess-input");

    playBtn.addEventListener("click", playSnippet);
    guessBtn.addEventListener("click", submitGuess);

    // Enter key submits guess
    guessInput.addEventListener("keyup", function(e) {
        if (e.key === "Enter") submitGuess();
    });

    // Load the first track
    fetchTrack();
});
