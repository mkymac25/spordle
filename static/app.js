let currentTrack = null;

// Fetch a new track
async function seedTrack() {
    const resp = await fetch("/api/seed-track");
    if (resp.status === 404) {
        alert("No more tracks available!");
        return;
    }
    const data = await resp.json();
    currentTrack = data;
    document.getElementById("track-artists").innerText = "Artists: " + data.artists.join(", ");
    document.getElementById("guess-input").value = "";
    document.getElementById("feedback").innerText = "";
}

async function submitGuess() {
    const guess = document.getElementById("guess-input").value;
    if (!currentTrack) return alert("No track loaded!");
    const resp = await fetch("/api/check-guess", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({guess: guess, correct_title: currentTrack.name})
    });
    const data = await resp.json();
    if (data.accepted) {
        document.getElementById("feedback").innerText = `Correct! It was "${data.correct_title_raw}"`;
        await fetch("/api/report-result", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({accepted: true, attempts: 1, track_id: currentTrack.id})
        });
        seedTrack();
    } else {
        document.getElementById("feedback").innerText = "Incorrect, try again!";
    }
}

// Initialize
document.addEventListener("DOMContentLoaded", () => {
    seedTrack();
    document.getElementById("guess-btn").addEventListener("click", submitGuess);
});
