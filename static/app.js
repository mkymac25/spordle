let currentTrack = null;
let attempts = 0;

async function checkGuess() {
    const guess = document.getElementById("guess-input").value.trim();
    if (!guess || !currentTrack) return;

    const resp = await fetch("/api/check-guess", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({guess: guess})
    });
    const data = await resp.json();

    attempts++;
    if (data.accepted) {
        document.getElementById("feedback").innerText = `✅ Correct! The song was "${data.correct_title_raw}"`;
        reportResult(true);
    } else {
        document.getElementById("feedback").innerText = `❌ Incorrect. Try again!`;
    }
}

async function seedTrack() {
    const resp = await fetch("/api/seed-track");
    if (resp.status === 404) {
        alert("No more tracks available!");
        return;
    }
    const data = await resp.json();
    currentTrack = data;
    attempts = 0;

    document.getElementById("track-artists").innerText =
        "Artists: " + data.artists.join(", ");
    document.getElementById("guess-input").value = "";
    document.getElementById("feedback").innerText = "";

    // Play snippet via Spotify API on the user's active device
    fetch("/api/play-snippet", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({uri: currentTrack.uri, duration: 5})
    }).catch(err => {
        console.error("Error playing snippet:", err);
    });
}

async function reportResult(accepted) {
    if (!currentTrack) return;
    await fetch("/api/report-result", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({accepted: accepted, attempts: attempts, track_id: currentTrack.id})
    });
}

// Event listeners
document.getElementById("guess-btn").addEventListener("click", checkGuess);
document.getElementById("next-btn").addEventListener("click", seedTrack);
document.getElementById("guess-input").addEventListener("keyup", function(event) {
    if (event.key === "Enter") checkGuess();
});

// Load first track on page load
window.addEventListener("load", seedTrack);
