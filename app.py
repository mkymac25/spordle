from flask import Flask, redirect, url_for, session, request, render_template, jsonify
from spotipy import Spotify
from spotipy.oauth2 import SpotifyOAuth
import os
import random
import time

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET", "supersecretkey")  # set a strong secret in Render

# Spotify OAuth setup
SPOTIFY_CLIENT_ID = os.environ.get("SPOTIFY_CLIENT_ID")
SPOTIFY_CLIENT_SECRET = os.environ.get("SPOTIFY_CLIENT_SECRET")
SPOTIFY_REDIRECT_URI = os.environ.get("SPOTIFY_REDIRECT_URI")

SCOPE = "user-read-playback-state user-modify-playback-state user-read-currently-playing user-top-read"

def get_spotify():
    if "token_info" not in session:
        return None
    return Spotify(auth=session["token_info"]["access_token"])

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
    token_info = sp_oauth.get_access_token(code)
    session["token_info"] = token_info
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

# API: get session info
@app.route("/api/session-info")
def session_info():
    if "token_info" not in session:
        return jsonify({"needs_auth": True})
    return jsonify({"needs_auth": False})

# API: get a random top track
@app.route("/api/seed-track")
def seed_track():
    sp = get_spotify()
    if not sp:
        return jsonify({"needs_auth": True})
    results = sp.current_user_top_tracks(limit=50, time_range="medium_term")
    tracks = results["items"]
    if not tracks:
        return jsonify({"error": "no-tracks-found"})
    track = random.choice(tracks)
    track_data = {
        "name": track["name"],
        "artists": [artist["name"] for artist in track["artists"]],
        "uri": track["uri"]
    }
    return jsonify(track_data)

# API: play snippet on active device
@app.route("/api/play-snippet", methods=["POST"])
def play_snippet():
    sp = get_spotify()
    if not sp:
        return jsonify({"needs_auth": True})

    data = request.json
    track_uri = data.get("uri")
    duration = int(data.get("duration", 5))

    # get active device
    devices = sp.devices().get("devices", [])
    active = next((d for d in devices if d.get("is_active")), None)
    if not active:
        return jsonify({"error": "no-active-device"})

    device_id = active["id"]
    # start playback
    sp.start_playback(device_id=device_id, uris=[track_uri], position_ms=0)
    time.sleep(duration)
    sp.pause_playback(device_id=device_id)

    return jsonify({"status": "played"})

# API: check guess (fuzzy match)
from fuzzywuzzy import fuzz
@app.route("/api/check-guess", methods=["POST"])
def check_guess():
    sp = get_spotify()
    if not sp:
        return jsonify({"needs_auth": True})

    data = request.json
    guess = data.get("guess", "").lower()
    correct_title = data.get("correct_title", "").lower()
    score = fuzz.ratio(guess, correct_title)
    accepted = score >= 90
    return jsonify({"guess": guess, "accepted": accepted, "ratio": score, "correct_title": correct_title})

if __name__ == "__main__":
    app.run(debug=True)
