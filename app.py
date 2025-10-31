# app.py
import os
import time
import re
from urllib.parse import urlencode
from flask import Flask, session, redirect, request, jsonify, render_template
import requests
from difflib import SequenceMatcher

# Optional: prefer rapidfuzz if installed (faster)
try:
    from rapidfuzz import fuzz as rapid_fuzz
    HAVE_RAPIDFUZZ = True
except Exception:
    HAVE_RAPIDFUZZ = False

# ---------------- CONFIG ----------------
SPOTIFY_CLIENT_ID = os.environ.get("SPOTIFY_CLIENT_ID", "")
SPOTIFY_CLIENT_SECRET = os.environ.get("SPOTIFY_CLIENT_SECRET", "")
REDIRECT_URI = os.environ.get("SPOTIFY_REDIRECT_URI", "http://localhost:5000/callback")
FLASK_SECRET = os.environ.get("FLASK_SECRET", "dev-secret-change-me")
SCOPE = "user-read-currently-playing user-read-recently-played user-top-read"
SNIPPET_LENGTHS = [1, 2, 5, 7, 10]
# ----------------------------------------

if not SPOTIFY_CLIENT_ID or not SPOTIFY_CLIENT_SECRET:
    raise RuntimeError("Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET environment variables")

app = Flask(__name__, template_folder="templates", static_folder="static")
app.secret_key = FLASK_SECRET

AUTH_URL = "https://accounts.spotify.com/authorize"
TOKEN_URL = "https://accounts.spotify.com/api/token"
API_BASE = "https://api.spotify.com/v1"


def make_auth_url():
    params = {
        "client_id": SPOTIFY_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPE,
        "show_dialog": "true",
    }
    return f"{AUTH_URL}?{urlencode(params)}"


@app.route("/")
def index():
    # serve main page
    return render_template("index.html")


@app.route("/login")
def login():
    return redirect(make_auth_url())


@app.route("/callback")
def callback():
    """Exchange authorization code for access token and store in session."""
    code = request.args.get("code")
    error = request.args.get("error")
    if error:
        return f"Spotify auth error: {error}", 400
    if not code:
        return "Missing code from Spotify", 400

    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": REDIRECT_URI,
        "client_id": SPOTIFY_CLIENT_ID,
        "client_secret": SPOTIFY_CLIENT_SECRET,
    }
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    resp = requests.post(TOKEN_URL, data=data, headers=headers)
    resp.raise_for_status()
    token_data = resp.json()

    session["access_token"] = token_data["access_token"]
    session["refresh_token"] = token_data.get("refresh_token")
    session["expires_at"] = int(time.time()) + token_data.get("expires_in", 3600)

    return redirect("/")


def ensure_token():
    """Refresh token if expired (basic)."""
    if "access_token" not in session:
        return False
    if session.get("expires_at", 0) - 60 < time.time():
        data = {
            "grant_type": "refresh_token",
            "refresh_token": session["refresh_token"],
            "client_id": SPOTIFY_CLIENT_ID,
            "client_secret": SPOTIFY_CLIENT_SECRET,
        }
        r = requests.post(TOKEN_URL, data=data)
        r.raise_for_status()
        token = r.json()
        session["access_token"] = token["access_token"]
        session["expires_at"] = int(time.time()) + token.get("expires_in", 3600)
    return True


def api_get(path, params=None):
    """Helper to call Spotify API with current access_token."""
    ensure_token()
    headers = {"Authorization": f"Bearer {session['access_token']}"}
    r = requests.get(f"{API_BASE}{path}", headers=headers, params=params)
    if r.status_code == 401:
        # token problem -> clear session to force reauth
        session.pop("access_token", None)
        session.pop("refresh_token", None)
        session.pop("expires_at", None)
        raise Exception("Unauthorized - please /login again")
    r.raise_for_status()
    return r.json()


def normalize_text(s: str) -> str:
    if not s:
        return ""
    s = s.lower().strip()
    s = re.sub(r"[^a-z0-9\s]", "", s)
    s = re.sub(r"\s+", " ", s)
    return s


def similarity(a: str, b: str) -> float:
    """Return similarity ratio 0..1. Prefer rapidfuzz if available."""
    if not a or not b:
        return 0.0
    if HAVE_RAPIDFUZZ:
        # rapidfuzz.ratio returns 0..100
        return rapid_fuzz.ratio(a, b) / 100.0
    else:
        return SequenceMatcher(None, normalize_text(a), normalize_text(b)).ratio()


# ---------------- Stats helpers ----------------
def ensure_stats():
    """Initialize per-session stats if missing."""
    if "stats" not in session:
        session["stats"] = {
            "games_played": 0,
            "songs_guessed_correct": 0,
            "songs_guessed_incorrect": 0,
            "guesses_total": 0,
            "recent": []
        }
    return session["stats"]


@app.route("/api/seed-track")
def seed_track():
    """Return a track that has a preview_url. Prefer currently playing -> recently played -> top tracks."""
    if "access_token" not in session:
        return jsonify({"needs_auth": True, "login_url": "/login"})
    try:
        # 1) currently playing
        r = requests.get(f"{API_BASE}/me/player/currently-playing",
                         headers={"Authorization": f"Bearer {session['access_token']}"})
        track = None
        if r.status_code == 200:
            obj = r.json()
            track = obj.get("item")

        # 2) recently played (try to find preview)
        if not track:
            rp = api_get("/me/player/recently-played", params={"limit": 50})
            for it in rp.get("items", []):
                t = it.get("track")
                if t and t.get("preview_url"):
                    track = t
                    break

        # 3) top tracks fallback
        if not track:
            top = api_get("/me/top/tracks", params={"limit": 50, "time_range": "medium_term"})
            for t in top.get("items", []):
                if t.get("preview_url"):
                    track = t
                    break

        if not track or not track.get("preview_url"):
            return jsonify({"error": "no-track-with-preview"}), 404

        response = {
            "id": track["id"],
            "name": track["name"],
            "artists": [a["name"] for a in track["artists"]],
            "preview_url": track.get("preview_url"),
            "duration_ms": track.get("duration_ms"),
        }

        # store minimal correct answer server-side
        session["current_track"] = {"id": response["id"], "name": response["name"], "artists": response["artists"]}
        # start a new game song
        stats = ensure_stats()
        stats["games_played"] = stats.get("games_played", 0) + 1
        session["stats"] = stats
        session["round"] = 0
        return jsonify(response)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/check-guess", methods=["POST"])
def check_guess():
    """Accept JSON {guess: "..."} and return matching result."""
    if "current_track" not in session:
        return jsonify({"error": "no-track-loaded"}), 400
    data = request.get_json(force=True)
    guess = (data.get("guess", "") if data else "").strip()
    track = session["current_track"]
    correct_title = track["name"]
    artist_hint = ", ".join(track["artists"][:2])

    g_n = normalize_text(guess)
    t_n = normalize_text(correct_title)

    exact = g_n == t_n
    substring = (g_n in t_n) or (t_n in g_n)
    ratio = similarity(guess, correct_title)
    accepted = exact or substring or (ratio >= 0.75)

    result = {
        "guess": guess,
        "accepted": accepted,
        "exact": exact,
        "substring": substring,
        "ratio": ratio,
        "correct_title": correct_title if accepted else None,
        "artist_hint": artist_hint
    }

    # update stats
    stats = ensure_stats()
    stats["guesses_total"] = stats.get("guesses_total", 0) + 1
    if accepted:
        stats["songs_guessed_correct"] = stats.get("songs_guessed_correct", 0) + 1
    else:
        stats["songs_guessed_incorrect"] = stats.get("songs_guessed_incorrect", 0) + 1

    # add to recent (keep only last 10)
    recent = stats.get("recent", [])
    recent.insert(0, {"title": correct_title, "accepted": accepted})
    stats["recent"] = recent[:10]

    session["stats"] = stats

    # advance round if incorrect (server-side)
    session["round"] = min(session.get("round", 0) + (0 if accepted else 1), len(SNIPPET_LENGTHS) - 1)
    return jsonify(result)


@app.route("/api/stats")
def api_stats():
    """Return per-session stats (simple)."""
    stats = session.get("stats", {
        "games_played": 0,
        "songs_guessed_correct": 0,
        "songs_guessed_incorrect": 0,
        "guesses_total": 0,
        "recent": []
    })
    return jsonify(stats)


@app.route("/api/session-info")
def session_info():
    if "current_track" not in session:
        return jsonify({"has_track": False})
    return jsonify({"has_track": True, "round": session.get("round", 0)})


@app.route("/logout")
def logout():
    session.clear()
    return redirect("/")


if __name__ == "__main__":
    app.run(debug=True)
