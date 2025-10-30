document.addEventListener('DOMContentLoaded', () => {
    let audio = null;
    let currentSong = null;
    let currentIndex = 0;

    // Example songs array, replace with backend data
    let songs = [
        { title: "Reawaker (feat. Felix from Stray Kids)", preview_url: "https://p.scdn.co/mp3-preview/example1.mp3" },
        { title: "Another Song", preview_url: "https://p.scdn.co/mp3-preview/example2.mp3" }
    ];

    function cleanTitle(title) {
        return title.replace(/\(.*?\)/g, '').trim().toLowerCase();
    }

    function hasEnglishLetters(title) {
        return /[a-zA-Z]/.test(title);
    }

    function loadNextSong() {
        if (currentIndex >= songs.length) {
            document.getElementById('song-title').innerText = "Game Over!";
            if (audio) audio.pause();
            return;
        }

        currentSong = songs[currentIndex];

        // Skip songs without English letters
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

        audio = new Audio(currentSong.preview_url);
    }

    document.getElementById('play-snippet').addEventListener('click', () => {
        if (!audio) return;

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
        document.getElementById('guess-input').value = '';
    });

    // Load the first song
    loadNextSong();
});
