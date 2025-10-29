# Spordle — Wordle-for-Songs (Spotify)

A small Flask + JS web app that connects to Spotify, selects a track from your account (currently playing / recently played / top tracks), and plays progressively longer audio snippets from the track's `preview_url` while you guess the song title.

## Features
- Spotify OAuth (Authorization Code)
- Uses `preview_url` MP3 (no Spotify Premium required)
- Fuzzy matching with `rapidfuzz` (or built-in fallback)
- Simple Wordle-like progressive snippet rounds

## Quickstart (local dev)

1. Clone the repo:
   ```bash
   git clone <your-repo-url>
   cd <repo-name>
