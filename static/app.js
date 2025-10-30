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
    const guess = document.getElementById("guess-input").value.trim();
    if (!guess || !currentTrack) return;

    const res = await fetch("/api/check-guess", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({guess: guess})
    });
    const data = await res.json();
    const fb = document.getElementById("feedback");
    if (data.accepted) {
        fb.textContent = `Correct! 🎉 The song was "${data.correct_title_raw}"`;
        await fetchTrack(); // next track
        document.getElementById("guess-input").value = "";
    } else {
        fb.textContent = `Wrong! Try again.`;
    }
}

document.getElementById("play-btn").addEventListener("click", playSnippet);
document.getElementById("guess-btn").addEventListener("click", submitGuess);

window.onload = fetchTrack;
