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

    const duration = 5;
    const res = await fetch("/api/play-snippet", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({uri: currentTrack.uri, duration: duration})
    });
    const data = await res.json();
    if (data.error) {
        alert("Error playing snippet: " + data.error);
    }
}

async function playFullSong() {
    if (!currentTrack) return;
    const res = await fetch("/api/play-snippet", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({uri: currentTrack.uri, duration: 0}) // 0 = play full
    });
    const data = await res.json();
    if (data.error) {
        alert("Error playing full song: " + data.error);
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

        // Show song info
        document.getElementById("song-info").style.display = "block";

        // Disable input
        guessInput.disabled = true;
        document.getElementById("guess-btn").disabled = true;

        // Play full song
        await playFullSong();

        // After a short delay, load next track
        setTimeout(fetchTrack, 5000);
    } else {
        fb.textContent = `Wrong! You have ${maxGuesses - guessesCount} guesses left.`;
        guessInput.value = "";
        guessInput.focus();
    }
}

// Event listeners
document.getElementById("play-btn").addEventListener("click", playSnippet);
document.getElementById("guess-btn").addEventListener("click", submitGuess);

document.getElementById("guess-input").addEventListener("keyup", function(e) {
    if (e.key === "Enter") submitGuess();
});

window.onload = fetchTrack;
