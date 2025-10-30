let currentTrack = null;

async function fetchTrack() {
    const res = await fetch("/api/seed-track");
    if (!res.ok) {
        document.getElementById("track-name").textContent = "No tracks available!";
        return;
    }
    const data = await res.json();
    currentTrack = data;
    document.getElementById("track-name").textContent = data.name;
    document.getElementById("track-artists").textContent = data.artists.join(", ");

    // Clear previous guesses
    document.getElementById("guesses-list").innerHTML = "";
    document.getElementById("feedback").textContent = "";
    document.getElementById("guess-input").value = "";
}

async function playSnippet() {
    if (!currentTrack) return;

    const duration = 5; // seconds
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

    // Add guess to guesses list
    const li = document.createElement("li");
    li.textContent = guess + (data.accepted ? " ✅" : " ❌");
    document.getElementById("guesses-list").appendChild(li);

    const fb = document.getElementById("feedback");
    if (data.accepted) {
        fb.textContent = `Correct! 🎉 The song was "${data.correct_title_raw}"`;
        await fetchTrack(); // next track
    } else {
        fb.textContent = `Wrong! Try again.`;
    }

    guessInput.value = "";
    guessInput.focus();
}

// Event listeners
document.getElementById("play-btn").addEventListener("click", playSnippet);
document.getElementById("guess-btn").addEventListener("click", submitGuess);

// Enter key submission
document.getElementById("guess-input").addEventListener("keyup", function(e) {
    if (e.key === "Enter") submitGuess();
});

window.onload = fetchTrack;
