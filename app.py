# app.py
"""
Guessify backend (serves HTML from templates/):
- Uses rapidfuzz for fuzzy matching
- Avoids repeating tracks in session
- Persists user stats via SQLite (SQLAlchemy)
- Shows instructions page after Spotify login
- Skips tracks without Latin (English) letters
- Stores normalized match_title (parentheticals removed) for matching
"""
import os
import time
import random
import re
from flask import Flask, redirect, url_for, session, request, jsonify, render_template
from spotipy import Spotify
from spotipy.oauth2 import SpotifyOAuth
from rapidfuzz import fuzz

# SQLAlchemy
from sqlalchemy import create_engine, Column, Integer, String
from sqlalchemy.orm import declarative_base, sessionmaker, scoped_session

# ---------- Config ----------
app = Flask(__name__, static_folder="static", static_url_path="/static", template_folder="templates")
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

def has_latin_characters(text: str) -> bool:
    """Return True if the text contains at least one ASCII letter (A-Z / a-z)."""
    if not text:
        return False
    return bool(re.search(r'[A-Za-z]', text))

def normalize_title(t: str) -> str:
    """
    Normalize a track title for matching:
    - lowercase
    - remove bracketed/parenthetical content
    - remove common 'feat' sections (feat/ft/featuring and following text)
    - remove trailing hyphenated/remaster/version info
    - strip punctuation, collapse whitespace
    """
    if not t:
        return ""
    s = t.lower()

    # remove parenthesis, brackets, braces and their contents
    s = re.sub(r'\([^)]*\)', ' ', s)
    s = re.sub(r'\[[^\]]*\]', ' ', s)
    s = re.sub(r'\{[^}]*\}', ' ', s)

    # remove "feat", "ft", "featuring" and anything after them (common patterns)
    s = re.sub(r'\b(?:feat|ft|featuring)\b[.:]?\s*.*$', ' ', s)

    # remove content after hyphen or en-dash/em-dash (often remix/edition info)
    s = re.split(r'\s[-–—]\s', s)[0]

    # remove punctuation we don't want (keep letters/numbers and spaces)
    s = re.sub(r'[^\w\s]', ' ', s)

    # collapse whitespace and strip
    s = re.sub(r'\s+', ' ', s).strip()

    return s

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

    cand_list = list(candidates.values())
    random.shuffle(cand_list)
    return cand_list

# ---------- Routes: templates ----------
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/instructions")
def instructions():
    if "token_info" not in session:
        return redirect(url_for("index"))
    return render_template("instructions.html")

@app.route("/game")
def game():
    if "token_info" not in session:
        return redirect(url_for("index"))
    return render_template("game.html")

# Login / Callback
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

    # fetch user id if possible (for persisted stats)
    sp = get_spotify()
    if sp:
        try:
            profile = sp.current_user()
            session["spotify_user_id"] = profile.get("id")
        except Exception:
            session["spotify_user_id"] = None

    # initialize session containers
    session.setdefault("played_tracks", [])
    session.pop("current_track", None)

    # show instructions first
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
    """
    Returns a track that:
    - contains at least one Latin/English letter
    - has not been played in this session
    If none available, returns {"error":"no-more-tracks"} with 404.
    """
    sp = get_spotify()
    if not sp:
        return jsonify({"needs_auth": True})

    played = session.get("played_tracks", [])
    try:
        candidates = _collect_candidate_tracks(sp)

        # filter out tracks without Latin letters and those already played
        new_candidates = [
            t for t in candidates
            if t.get("id") not in played and has_latin_characters(t.get("name", ""))
        ]

        if not new_candidates:
            return jsonify({"error": "no-more-tracks"}), 404

        # pick one track
        track = random.choice(new_candidates)
        track_id = track.get("id")
        title_raw = track.get("name", "") or ""
        title_match = normalize_title(title_raw)

        # store both display title and matchable title in session
        session["current_track"] = {
            "id": track_id,
            "name": title_raw,
            "match_title": title_match,   # normalized, parentheticals removed, etc.
            "artists": [a.get("name") for a in track.get("artists", [])],
            "uri": track.get("uri")
        }

        # mark as played
        played.append(track_id)
        session["played_tracks"] = played

        return jsonify({
            "id": track_id,
            "name": title_raw,
            "artists": session["current_track"]["artists"],
            "uri": track.get("uri"),
            # include normalized match title for debugging (frontend may ignore)
            "match_title": title_match
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/play-snippet", methods=["POST"])
def play_snippet():
    """
    Play a snippet on the user's active Spotify device.

    Request JSON:
      { "uri": "<track_uri>", "duration": <seconds>, "full": <bool> }

    Behavior:
      - If "full" is true: start playback at position 0 and DO NOT pause (plays full song).
      - Otherwise: try to stop any playback first, start playback at position 0, WAIT until playback actually starts (poll),
        then sleep for duration seconds, then pause.
    """
    sp = get_spotify()
    if not sp:
        return jsonify({"needs_auth": True})
    data = request.get_json(force=True) or {}
    track_uri = data.get("uri")
    full = bool(data.get("full", False))
    try:
        duration = int(data.get("duration", 0))
    except Exception:
        duration = 0

    devices = sp.devices().get("devices", [])
    active = next((d for d in devices if d.get("is_active")), None)
    if not active:
        return jsonify({"error": "no-active-device"}), 400
    device_id = active["id"]

    try:
        # Force stop existing playback first (best-effort)
        try:
            sp.pause_playback(device_id=device_id)
            # tiny delay to allow device to acknowledge
            time.sleep(0.15)
        except Exception:
            # ignore errors pausing; continue
            pass

        # Start playback from the VERY beginning
        sp.start_playback(device_id=device_id, uris=[track_uri], position_ms=0)

        if full:
            # don't pause — play the full track
            return jsonify({"status": "playing_full"})

        # wait up to N seconds for playback to actually start (progress > X ms)
        started = False
        wait_seconds = 5.0
        poll_interval = 0.2
        waited = 0.0
        while waited < wait_seconds:
            state = sp.current_playback()
            if state and state.get("is_playing") and (state.get("progress_ms", 0) > 200):
                started = True
                break
            time.sleep(poll_interval)
            waited += poll_interval

        # If playback never started, still attempt the snippet sleep/pause but warn
        if not started:
            # fall back: short sleep to give Spotify some time
            time.sleep(0.5)

        # fallback duration default
        if duration <= 0:
            duration = 5

        time.sleep(duration)
        sp.pause_playback(device_id=device_id)
        return jsonify({"status": "played_snippet", "duration": duration, "started": started})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/check-guess", methods=["POST"])
def check_guess():
    data = request.get_json(force=True)
    guess_raw = (data.get("guess", "") or "").strip()
    current = session.get("current_track")
    correct_title_raw = ""
    correct_match = ""

    if current:
        correct_title_raw = current.get("name", "")
        correct_match = current.get("match_title", "") or normalize_title(correct_title_raw)
    else:
        correct_title_raw = data.get("correct_title", "")
        correct_match = normalize_title(correct_title_raw)

    if not guess_raw or not correct_title_raw:
        return jsonify({"error": "missing-guess-or-correct-title"}), 400

    # Normalize the user's guess the same way (so parentheticals in guess are also ignored)
    guess_norm = normalize_title(guess_raw)
    if not guess_norm:
        guess_norm = guess_raw.lower()

    # Use the precomputed correct_match for matching
    score = fuzz.ratio(guess_norm, correct_match)
    target = 93 if len(correct_match) > 4 else 88
    accepted = score >= target

    return jsonify({
        "accepted": bool(accepted),
        "guess": guess_raw,
        "ratio": int(score) if hasattr(score, "__int__") else score,
        "correct_title_raw": correct_title_raw,
        "correct_normalized": correct_match
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

# ---------- Debug helper (optional) ----------
@app.route("/_list_static")
def _list_static():
    import os
    static_dir = app.static_folder or "static"
    files = []
    for root, dirs, filenames in os.walk(static_dir):
        for f in filenames:
            files.append(os.path.relpath(os.path.join(root, f), static_dir))
    return jsonify({"files": sorted(files)})

# ---------- Run ----------
if __name__ == "__main__":
    app.run(debug=True)
