# app.py
"""
Guessify / Spordle backend (single-file Flask app)

Features:
- Spotify OAuth via Spotipy
- seed-track avoids repeating tracks within the Flask session
- /instructions page (served from static/instructions.html) shown after login
- persistent per-user stats (SQLite via SQLAlchemy)
- rapidfuzz for fuzzy matching
- title normalization to ignore parentheticals, "feat." parts, remasters, etc.
- serves index/instructions/game pages from static/
"""
import os
import time
import random
import re
from flask import Flask, redirect, url_for, session, request, jsonify
from spotipy import Spotify
from spotipy.oauth2 import SpotifyOAuth
from rapidfuzz import fuzz

# SQLAlchemy
from sqlalchemy import create_engine, Column, Integer, String
from sqlalchemy.orm import declarative_base, sessionmaker, scoped_session

# ---------- Config ----------
app = Flask(__name__, static_folder="static", static_url_path="/static")
app.secret_key = os.environ.get("FLASK_SECRET", "dev-secret-change-me")

SPOTIFY_CLIENT_ID = os.environ.get("SPOTIFY_CLIENT_ID")
SPOTIFY_CLIENT_SECRET = os.environ.get("SPOTIFY_CLIENT_SECRET")
SPOTIFY_REDIRECT_URI = os.environ.get("SPOTIFY_REDIRECT_URI")

SCOPE = "user-read-playback-state user-modify-playback-state user-read-currently-playing user-top-read user-read-recently-played user-read-email"

if not (SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET and SPOTIFY_REDIRECT_URI):
    raise RuntimeError("Please set SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and SPOTIFY_REDIRECT_URI environment variables")

# DB (SQLite by default)
DB_URL = os.environ.get("DATABASE_URL", "sqlite:///spordle.db")
engine = create_engine(DB_URL, connect_args={"check_same_thread": False} if DB_URL.startswith("sqlite") else {})
Base = declarative_base()
SessionLocal = scoped_session(sessionmaker(bind=engine))

# ---------- Models ----------
class UserStats(Base):
    __tablename__ = "user_stats"
    spotify_user_id = Column(String, primary_key=True, index=True)
    correct_songs = Column(Integer, default=0, nullable=False)
    total_attempts_for_correct = Column(Integer, default=0, nullable=False)
    songs_played = Column(Integer, default=0, nullable=False)

Base.metadata.create_all(bind=engine)

# ---------- Helpers ----------
def get_spotify():
    token_info = session.get("token_info")
    if not token_info:
        return None
    access_token = token_info.get("access_token")
    if not access_token:
        return None
    return Spotify(auth=access_token)

def normalize_title(t: str) -> str:
    """Normalize a track title: lowercase, remove parentheticals/brackets/braces,
    remove feat/ft/featuring suffixes, remove trailing '- ...' sections, remove punctuation,
    collapse whitespace."""
    if not t:
        return ""
    s = t.lower()
    # remove parenthesis, brackets, braces content
    s = re.sub(r'\([^)]*\)', ' ', s)
    s = re.sub(r'\[[^\]]*\]', ' ', s)
    s = re.sub(r'\{[^}]*\}', ' ', s)
    # remove "feat", "ft", "featuring" and anything after them
    s = re.sub(r'\b(?:feat|ft|featuring)\b[.:]?\s*.*$', ' ', s)
    # remove content after hyphen/en-dash/em-dash (common remaster/version info)
    s = re.split(r'\s[-–—]\s', s)[0]
    # remove punctuation except word characters and spaces
    s = re.sub(r'[^\w\s]', ' ', s)
    # collapse whitespace
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def _collect_candidate_tracks(sp):
    """Collect tracks from currently playing, recently played, and top tracks.
    Returns shuffled list of unique track dicts (spotipy track objects)."""
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

# ---------- Routes: static pages ----------
@app.route("/")
def index():
    # serve static/index.html
    return app.send_static_file("index.html")

@app.route("/instructions")
def instructions():
    # requires login; if not logged in, redirect to index
    if "token_info" not in session:
        return redirect(url_for("index"))
    return app.send_static_file("instructions.html")

@app.route("/game")
def game():
    if "token_info" not in session:
        return redirect(url_for("index"))
    return app.send_static_file("game.html")

# login flow (opens Spotify auth page)
@app.route("/login")
def login():
    sp_oauth = SpotifyOAuth(client_id=SPOTIFY_CLIENT_ID,
                            client_secret=SPOTIFY_CLIENT_SECRET,
                            redirect_uri=SPOTIFY_REDIRECT_URI,
                            scope=SCOPE)
    auth_url = sp_oauth.get_authorize_url()
    return redirect(auth_url)

# callback exchanges code for token and redirects to instructions page
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
    # store token info in session for get_spotify()
    session["token_info"] = token_info
    # fetch user id if possible (for persisted stats)
    sp = get_spotify()
    if sp:
        try:
            profile = sp.current_user()
            session["spotify_user_id"] = profile.get("id")
        except Exception:
            session["spotify_user_id"] = None
    # initialize session-tracking containers
    session.setdefault("played_tracks", [])
    session.pop("current_track", None)
    # redirect user to instructions page (new step)
    return redirect(url_for("instructions"))

@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("index"))

# ---------- API endpoints ----------
@app.route("/api/session-info")
def session_info():
    if "token_info" not in session:
        return jsonify({"needs_auth": True})
    return jsonify({"needs_auth": False})

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
        # mark as played in this Flask session
        played.append(track_id)
        session["played_tracks"] = played
        return jsonify({
            "id": track_id,
            "name": track.get("name"),
            "artists": session["current_track"]["artists"],
            "uri": track.get("uri")
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/play-snippet", methods=["POST"])
def play_snippet():
    sp = get_spotify()
    if not sp:
        return jsonify({"needs_auth": True})
    data = request.get_json(force=True)
    track_uri = data.get("uri")
    try:
        duration = int(data.get("duration", 5))
    except Exception:
        duration = 5
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

@app.route("/api/check-guess", methods=["POST"])
def check_guess():
    data = request.get_json(force=True)
    guess_raw = (data.get("guess", "") or "").strip()
    current = session.get("current_track")
    correct_title_raw = ""
    if current:
        correct_title_raw = current.get("name", "")
    else:
        correct_title_raw = data.get("correct_title", "")

    if not guess_raw or not correct_title_raw:
        return jsonify({"error": "missing-guess-or-correct-title"}), 400

    # Normalize both guess and correct title to ignore parentheticals etc.
    guess_norm = normalize_title(guess_raw)
    correct_norm = normalize_title(correct_title_raw)
    if not guess_norm:
        guess_norm = guess_raw.lower()
    if not correct_norm:
        correct_norm = correct_title_raw.lower()

    score = fuzz.ratio(guess_norm, correct_norm)
    target = 93 if len(correct_norm) > 4 else 88
    accepted = score >= target

    return jsonify({
        "accepted": bool(accepted),
        "guess": guess_raw,
        "ratio": int(score) if hasattr(score, "__int__") else score,
        "correct_title_raw": correct_title_raw,
        "correct_normalized": correct_norm
    })

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

# ---------- Run ----------
if __name__ == "__main__":
    app.run(debug=True)
