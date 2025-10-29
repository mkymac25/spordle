# app.py
"""
Spordle backend with:
- Spotify OAuth (Spotipy)
- Avoid repeating tracks in the current Flask session (session['played_tracks'])
- /api/session-played-count: returns session played count + stored user stats
- /api/report-result: report result (accepted/failed) and attempts -> updates persistent stats (SQLite)
- Uses rapidfuzz for fuzzy matching (no python-Levenshtein C build)
"""
import os
import time
import random
from flask import Flask, redirect, url_for, session, request, render_template, jsonify
from spotipy import Spotify
from spotipy.oauth2 import SpotifyOAuth

# use rapidfuzz instead of fuzzywuzzy
from rapidfuzz import fuzz

# SQLAlchemy for persistence
from sqlalchemy import create_engine, Column, Integer, String
from sqlalchemy.orm import declarative_base, sessionmaker, scoped_session

# ----------------- Config -----------------
app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET", "dev-secret-change-me")

SPOTIFY_CLIENT_ID = os.environ.get("SPOTIFY_CLIENT_ID")
SPOTIFY_CLIENT_SECRET = os.environ.get("SPOTIFY_CLIENT_SECRET")
SPOTIFY_REDIRECT_URI = os.environ.get("SPOTIFY_REDIRECT_URI")

# scopes for playback and user info
SCOPE = "user-read-playback-state user-modify-playback-state user-read-currently-playing user-top-read user-read-recently-played user-read-email"

if not SPOTIFY_CLIENT_ID or not SPOTIFY_CLIENT_SECRET or not SPOTIFY_REDIRECT_URI:
    raise RuntimeError("Set SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and SPOTIFY_REDIRECT_URI environment variables")

# SQLite DB (file in project root) by default; override with DATABASE_URL env var for Postgres etc.
DB_URL = os.environ.get("DATABASE_URL", "sqlite:///spordle.db")
engine = create_engine(DB_URL, connect_args={"check_same_thread": False} if DB_URL.startswith("sqlite") else {})
Base = declarative_base()
SessionLocal = scoped_session(sessionmaker(bind=engine))

# ----------------- Models -----------------
class UserStats(Base):
    __tablename__ = "user_stats"
    spotify_user_id = Column(String, primary_key=True, index=True)
    correct_songs = Column(Integer, default=0, nullable=False)
    total_attempts_for_correct = Column(Integer, default=0, nullable=False)
    songs_played = Column(Integer, default=0, nullable=False)

Base.metadata.create_all(bind=engine)

# ----------------- Spotify helpers -----------------
def get_spotify():
    token_info = session.get("token_info")
    if not token_info:
        return None
    access_token = token_info.get("access_token")
    if not access_token:
        return None
    return Spotify(auth=access_token)

# ----------------- Pages & Auth -----------------
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
    token_info = sp_oauth.get_access_token(code)
    session["token_info"] = token_info

    # Get spotify user id for persisted stats
    sp = get_spotify()
    try:
        profile = sp.current_user()
        user_id = profile.get("id")
        session["spotify_user_id"] = user_id
    except Exception:
        session["spotify_user_id"] = None

    # initialize session played_tracks
    session.setdefault("played_tracks", [])
    session.pop("current_track", None)
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

@app.route("/api/session-info")
def session_info():
    if "token_info" not in session:
        return jsonify({"needs_auth": True})
    return jsonify({"needs_auth": False})

# ----------------- Track collection and seeding -----------------
def _collect_candidate_tracks(sp):
    """
    Build candidate track list from currently playing, recently played, and top tracks.
    Returns list of track dicts (spotipy track objects).
    """
    candidates = {}
    # currently playing
    try:
        cur = sp.current_user_playing_track()
        if cur and cur.get("item"):
            t = cur["item"]
            if t and t.get("id"):
                candidates[t["id"]] = t
    except Exception:
        pass

    # recently played
    try:
        rp = sp.current_user_recently_played(limit=50)
        for it in rp.get("items", []):
            t = it.get("track")
            if t and t.get("id"):
                candidates.setdefault(t["id"], t)
    except Exception:
        pass

    # top tracks
    try:
        top = sp.current_user_top_tracks(limit=50, time_range="medium_term")
        for t in top.get("items", []):
            if t and t.get("id"):
                candidates.setdefault(t["id"], t)
    except Exception:
        pass

    cand_list = list(candidates.values())
    random.shuffle(cand_list)
    return cand_list

@app.route("/api/seed-track")
def seed_track():
    sp = get_spotify()
    if not sp:
        return jsonify({"needs_auth": True})

    played = session.get("played_tracks", [])

    try:
        candidates = _collect_candidate_tracks(sp)
        new_candidates = [t for t in candidates if t.get("id") not in played]

        if not new_candidates:
            return jsonify({"error": "no-more-tracks"}), 404

        track = random.choice(new_candidates)
        track_id = track.get("id")

        session["current_track"] = {
            "id": track_id,
            "name": track.get("name"),
            "artists": [a.get("name") for a in track.get("artists", [])],
            "uri": track.get("uri")
        }

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

# ----------------- Playback control -----------------
@app.route("/api/play-snippet", methods=["POST"])
def play_snippet():
    sp = get_spotify()
    if not sp:
        return jsonify({"needs_auth": True})
    data = request.get_json(force=True)
    track_uri = data.get("uri")
    duration = int(data.get("duration", 5))
    devices = sp.devices().get("devices", [])
    active = next((d for d in devices if d.get("is_active")), None)
    if not active:
        return jsonify({"error": "no-active-device"}), 400
    device_id = active["id"]
    try:
        sp.start_playback(device_id=device_id, uris=[track_uri], position_ms=0)
        time.sleep(duration)
        sp.pause_playback(device_id=device_id)
        return jsonify({"status": "played"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ----------------- Guess checking -----------------
@app.route("/api/check-guess", methods=["POST"])
def check_guess():
    data = request.get_json(force=True)
    guess = (data.get("guess", "") or "").strip()
    current = session.get("current_track")
    correct_title = ""
    if current:
        correct_title = current.get("name", "")
    else:
        correct_title = data.get("correct_title", "")

    if not guess or not correct_title:
        return jsonify({"error": "missing-guess-or-correct-title"}), 400

    # rapidfuzz returns float or int depending on call; use ratio which returns int-like float
    score = fuzz.ratio(guess.lower(), correct_title.lower())
    # thresholds (same idea as before)
    target = 93 if len(correct_title) > 4 else 88
    accepted = score >= target

    return jsonify({
        "accepted": bool(accepted),
        "guess": guess,
        "ratio": int(score) if hasattr(score, "__int__") else score
    })

# ----------------- Session & persistent stats endpoints -----------------
@app.route("/api/session-played-count")
def session_played_count():
    if "token_info" not in session:
        return jsonify({"needs_auth": True})
    played = session.get("played_tracks", [])
    session_count = len(played)
    spotify_user_id = session.get("spotify_user_id")
    user_stats = None
    if spotify_user_id:
        db = SessionLocal()
        us = db.query(UserStats).filter_by(spotify_user_id=spotify_user_id).first()
        if us:
            user_stats = {
                "correctSongs": us.correct_songs,
                "totalAttemptsForCorrect": us.total_attempts_for_correct,
                "songsPlayed": us.songs_played,
                "averageAttempts": (us.total_attempts_for_correct / us.correct_songs) if us.correct_songs > 0 else None
            }
        db.close()
    return jsonify({"session_played": session_count, "user_stats": user_stats})

@app.route("/api/report-result", methods=["POST"])
def report_result():
    if "token_info" not in session:
        return jsonify({"needs_auth": True}), 401
    spotify_user_id = session.get("spotify_user_id")
    if not spotify_user_id:
        return jsonify({"error": "user-id-missing"}), 400

    data = request.get_json(force=True)
    accepted = bool(data.get("accepted", False))
    attempts = int(data.get("attempts", 0))
    track_id = data.get("track_id")

    db = SessionLocal()
    us = db.query(UserStats).filter_by(spotify_user_id=spotify_user_id).first()
    if not us:
        us = UserStats(spotify_user_id=spotify_user_id, correct_songs=0, total_attempts_for_correct=0, songs_played=0)
        db.add(us)

    us.songs_played = (us.songs_played or 0) + 1
    if accepted:
        us.correct_songs = (us.correct_songs or 0) + 1
        us.total_attempts_for_correct = (us.total_attempts_for_correct or 0) + attempts

    db.commit()
    user_stats = {
        "correctSongs": us.correct_songs,
        "totalAttemptsForCorrect": us.total_attempts_for_correct,
        "songsPlayed": us.songs_played,
        "averageAttempts": (us.total_attempts_for_correct / us.correct_songs) if us.correct_songs > 0 else None
    }
    db.close()

    return jsonify({"ok": True, "user_stats": user_stats})

# ----------------- Run -----------------
if __name__ == "__main__":
    app.run(debug=True)
