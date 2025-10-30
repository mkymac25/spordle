const audio = document.getElementById('audio');
const playBtn = document.getElementById('playSnippet');
const submitBtn = document.getElementById('submitGuess');
const feedback = document.getElementById('feedback');
const progress = document.querySelector('.progress');

let currentSnippet = 0; // starts at first snippet
const snippetDurations = [1, 2, 3, 4, 5, 6]; // seconds Heardle-style
let snippetStart = 0;
let snippetEnd = snippetDurations[currentSnippet];
let playing = false;

// Set your song URL here dynamically
audio.src = "/static/audio/currentSong.mp3";

function playSnippet() {
    if (!playing) {
        snippetStart = 0;
        snippetEnd = snippetDurations[currentSnippet];
        audio.currentTime = snippetStart;
        audio.play();
        playing = true;

        audio.ontimeupdate = () => {
            if (audio.currentTime >= snippetEnd) {
                audio.pause();
                progress.style.width = '100%';
                playing = false;
                currentSnippet = Math.min(currentSnippet + 1, snippetDurations.length - 1);
            } else {
                let percent = ((audio.currentTime - snippetStart) / (snippetEnd - snippetStart)) * 100;
                progress.style.width = `${percent}%`;
            }
        };
    }
}

playBtn.addEventListener('click', playSnippet);

submitBtn.addEventListener('click', () => {
    let guess = document.getElementById('guessInput').value.trim().toLowerCase();
    guess = guess.replace(/\(.*?\)/g, '').trim(); // remove parenthesis text
    feedback.textContent = `You guessed: ${guess}`;
    // TODO: Add your answer checking logic here
});
