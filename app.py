# app.py
"""
Flask backend for Spordle (full-track playback via Spotify active device).
This version avoids repeating any track that was already played in the current session.
"""
import os
import time
import random
from flask import Flask, redirect, url_for, session, request, render_template, jsonify
from spotipy import Spotify
from spotipy.oauth2 import SpotifyOAuth
from fuzzywuzzy import fuzz

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET", "dev-secret-change-me")  # override in production

# Spotify OAuth configuration (set these env vars on Render)
SPOTIFY_CLIENT_ID = os.environ.get("SPOTIFY_CLIENT_ID")
SPOTIFY_CLIENT_SECRET = os.environ.get("SPOTIFY_CLIENT_SECRET")
SPOTIFY_REDIRECT_URI = os.environ.get("SPOTIFY_REDIRECT_URI")

# Scopes needed for playback and user tracks
SCOPE = "user-read-playback-state user-modify-playback-state user-read-currently-playing user-top-read user-read-recently-played"

if not SPOTIFY_CLIENT_ID or not SPOTIFY_CLIENT_SECRET or not SPOTIFY_REDIRECT_URI:
    raise RuntimeError("Set SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and SPOTIFY_REDIRECT_URI environment variables")

# Helper to create Spotify client from session token
def get_spotify():
    token_info = session.get("token_info")
    if not token_info:
        return None
    access_token = token_info.get("access_token")
    if not access_token:
        return None
    return Spotify(auth=access_token)

# Routes: pages
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/login")
def login():
    sp_oauth = SpotifyOAuth(client_id=SPOTIFY_CLIENT_ID,
                            client_secret=SPOTIFY_CLIENT_SECRET,
                            redirect_uri=SPOTIFY_REDIRECT_URI,
                            scope=SCOPE)
    auth_url = sp_oauth.get_authorize_url()
    return redirect(auth_url)

@app.route("/callback")
def callback():
    sp_oauth = SpotifyOAuth(client_id=SPOTIFY_CLIENT_ID,
                            client_secret=SPOTIFY_CLIENT_SECRET,
                            redirect_uri=SPOTIFY_REDIRECT_URI,
                            scope=SCOPE)
    code = request.args.get("code")
    if not code:
        return "Missing code", 400
    # Exchange code for token info (Spotipy helper)
    token_info = sp_oauth.get_access_token(code)
    # token_info contains access_token, refresh_token, expires_in, etc.
    session["token_info"] = token_info
    # initialize played_tracks if not present
    session.setdefault("played_tracks", [])
    return redirect(url_for("game"))

@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("index"))

@app.route("/game")
def game():
    if "token_info" not in session:
        return redirect(url_for("index"))
    return render_template("game.html")

# API endpoints
@app.route("/api/session-info")
def session_info():
    if "token_info" not in session:
        return jsonify({"needs_auth": True})
    return jsonify({"needs_auth": False})

def _collect_candidate_tracks(sp):
    """
    Return a list of track objects (dict) collected from:
    - currently playing (if any)
    - recently played (limit 50)
    - top tracks (limit 50)
    Avoid duplicates in the returned list (by track id), keep order random-ish.
    """
    candidates = {}
    # 1) currently playing
    try:
        cur = sp.current_user_playing_track()
        if cur and cur.get("item"):
            t = cur["item"]
            if t and t.get("id"):
                candidates[t["id"]] = t
    except Exception:
        pass

    # 2) recently played
    try:
        rp = sp.current_user_recently_played(limit=50)
        for it in rp.get("items", []):
            t = it.get("track")
            if t and t.get("id"):
                candidates.setdefault(t["id"], t)
    except Exception:
        pass

    # 3) top tracks
    try:
        top = sp.current_user_top_tracks(limit=50, time_range="medium_term")
        for t in top.get("items", []):
            if t and t.get("id"):
                candidates.setdefault(t["id"], t)
    except Exception:
        pass

    # Convert to list and shuffle to avoid same order each time
    cand_list = list(candidates.values())
    random.shuffle(cand_list)
    return cand_list

@app.route("/api/seed-track")
def seed_track():
    """
    Returns a track (name, artists array, uri, id) that was NOT played previously in this session.
    If all candidate tracks are exhausted, returns {"error": "no-more-tracks"} with status 404.
    If the user needs to authenticate, returns {"needs_auth": True}.
    """
    sp = get_spotify()
    if not sp:
        return jsonify({"needs_auth": True})

    played = session.get("played_tracks", [])

    try:
        candidates = _collect_candidate_tracks(sp)
        # Filter out any tracks already played this session
        new_candidates = [t for t in candidates if t.get("id") not in played]

        # If none available, return no-more-tracks
        if not new_candidates:
            return jsonify({"error": "no-more-tracks"}), 404

        # Pick one
        track = random.choice(new_candidates)

        # Save minimal info for checking guesses and to mark as played
        track_id = track.get("id")
        session["current_track"] = {
            "id": track_id,
            "name": track.get("name"),
            "artists": [a.get("name") for a in track.get("artists", [])],
            "uri": track.get("uri")
        }

        # Append to played list and save
        played.append(track_id)
        session["played_tracks"] = played

        response = {
            "id": track_id,
            "name": track.get("name"),
            "artists": session["current_track"]["artists"],
            "uri": track.get("uri")
        }
        return jsonify(response)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/play-snippet", methods=["POST"])
def play_snippet():
    sp = get_spotify()
    if not sp:
        return jsonify({"needs_auth": True})
    data = request.get_json(force=True)
    track_uri = data.get("uri")
    duration = int(data.get("duration", 5))
    # find active device
    devices = sp.devices().get("devices", [])
    active = next((d for d in devices if d.get("is_active")), None)
    if not active:
        return jsonify({"error": "no-active-device"}), 400
    device_id = active["id"]
    try:
        sp.start_playback(device_id=device_id, uris=[track_uri], position_ms=0)
        # Sleep in background thread handled synchronously here; fine for prototype
        time.sleep(duration)
        sp.pause_playback(device_id=device_id)
        return jsonify({"status": "played"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/check-guess", methods=["POST"])
def check_guess():
    data = request.get_json(force=True)
    guess = (data.get("guess", "") or "").strip()
    # Prefer to use server-side stored correct title if present
    current = session.get("current_track")
    correct_title = ""
    if current:
        correct_title = current.get("name", "")
    else:
        correct_title = data.get("correct_title", "")

    if not guess or not correct_title:
        return jsonify({"error": "missing-guess-or-correct-title"}), 400

    # Fuzzy match (you can tweak thresholds)
    score = fuzz.ratio(guess.lower(), correct_title.lower())
    # dynamic threshold: shorter titles allow slightly lower threshold
    target = 93 if len(correct_title) > 4 else 88
    accepted = score >= target

    return jsonify({
        "accepted": accepted,
        "guess": guess,
        "ratio": score
    })

if __name__ == "__main__":
    app.run(debug=True)
