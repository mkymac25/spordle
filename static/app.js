let audio = null;
let currentSong = null;

// Example: Load song list from backend
let songs = []; // backend should provide {title, preview_url}
let currentIndex = 0;

function cleanTitle(title) {
    // Remove parenthesis content and trim
    return title.replace(/\(.*?\)/g, '').trim().toLowerCase();
}

function hasEnglishLetters(title) {
    return /[a-zA-Z]/.test(title);
}

function loadNextSong() {
    if (currentIndex >= songs.length) {
        document.getElementById('song-title').innerText = "Game Over!";
        return;
    }
    currentSong = songs[currentIndex];
    
    if (!hasEnglishLetters(currentSong.title)) {
        currentIndex++;
        loadNextSong();
        return;
    }

    document.getElementById('song-title').innerText = "Guess the Song!";
    if (audio) {
        audio.pause();
        audio = null;
    }
}

document.getElementById('play-snippet').addEventListener('click', () => {
    if (!currentSong) return;

    if (!audio) {
        audio = new Audio(currentSong.preview_url);
    }

    if (audio.paused) {
        audio.currentTime = 0;
        audio.play();
    } else {
        audio.pause();
        audio.currentTime = 0;
    }
});

document.getElementById('submit-guess').addEventListener('click', () => {
    const input = document.getElementById('guess-input').value.toLowerCase().trim();
    const answer = cleanTitle(currentSong.title);

    if (input === answer) {
        document.getElementById('feedback').innerText = "Correct!";
    } else {
        document.getElementById('feedback').innerText = `Wrong! Answer: ${answer}`;
    }
    currentIndex++;
    loadNextSong();
});

// Initial load
loadNextSong();
