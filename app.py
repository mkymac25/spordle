# app.py
"""
Full Flask app for Spordle with separate landing (/) and game (/game) routes.
- Uses Spotify Authorization Code flow (server-side token exchange).
- Stores minimal session info (access token, refresh token, current_track).
- Uses preview_url playback on frontend (no Premium required).
- Optional: rapidfuzz is used if installed for faster fuzzy matching.
"""
import os
import time
import re
from urllib.parse import urlencode
from flask import Flask, session, redirect, request, jsonify, render_template
import requests
from difflib import SequenceMatcher

# Optional: prefer rapidfuzz if installed (faster fuzzy matching)
try:
    from rapidfuzz import fuzz as rapid_fuzz
    HAVE_RAPIDFUZZ = True
except Exception:
    HAVE_RAPIDFUZZ = False

# ---------------- CONFIG ----------------
# Expect these in environment (Render / Railway / local .env)
SPOTIFY_CLIENT_ID = os.environ.get("SPOTIFY_CLIENT_ID", "")
SPOTIFY_CLIENT_SECRET = os.environ.get("SPOTIFY_CLIENT_SECRET", "")
# Example: "http://localhost:5000/callback" for local dev, or production "https://your.app/callback"
REDIRECT_URI = os.environ.get("SPOTIFY_REDIRECT_URI", "http://localhost:5000/callback")
# Secret used by Flask to sign session cookies. Set in env and keep private.
FLASK_SECRET = os.environ.get("FLASK_SECRET", "change-me-in-production")
# Scopes required to read currently/recently played and top tracks.
SCOPE = "user-read-currently-playing user-read-recently-played user-top-read"
# Snippet progression used by frontend; server uses length for round limits
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


# ---------- Routes for pages ----------
@app.route("/")
def index():
    """Landing page. Basic CTA to connect with Spotify."""
    return render_template("index.html")


@app.route("/game")
def game():
    """Game page. Require an authorized session; otherwise redirect to /login."""
    if "access_token" not in session:
        return redirect("/login")
    return render_template("game.html")


@app.route("/login")
def login():
    """Send the user to Spotify's authorization page."""
    return redirect(make_auth_url())


@app.route("/callback")
def callback():
    """OAuth callback: exchange code for tokens and store them in session, then redirect to /game."""
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

    # store tokens and expiry in server-side session (Flask cookie signed with FLASK_SECRET)
    session["access_token"] = token_data["access_token"]
    session["refresh_token"] = token_data.get("refresh_token")
    session["expires_at"] = int(time.time()) + token_data.get("expires_in", 3600)

    return redirect("/game")


# ---------- Spotify helper functions ----------
def ensure_token():
    """
    Refresh the access token if it's near expiry.
    Returns False if no access_token currently stored.
    """
    if "access_token" not in session:
        return False
    if session.get("expires_at", 0) - 60 < time.time():
        data = {
            "grant_type": "refresh_token",
            "refresh_token": session.get("refresh_token"),
            "client_id": SPOTIFY_CLIENT_ID,
            "client_secret": SPOTIFY_CLIENT_SECRET,
        }
        r = requests.post(TOKEN_URL, data=data)
        r.raise_for_status()
        token = r.json()
        session["access_token"] = token["access_token"]
        # refresh responses sometimes omit expires_in; default to 3600 if missing
        session["expires_at"] = int(time.time()) + token.get("expires_in", 3600)
    return True


def api_get(path, params=None):
    """Simple wrapper for GET requests to Spotify Web API using stored access token."""
    ensure_token()
    headers = {"Authorization": f"Bearer {session['access_token']}"}
    r = requests.get(f"{API_BASE}{path}", headers=headers, params=params)
    # If token invalid/expired in a way that refresh didn't fix, clear session to force reauth
    if r.status_code == 401:
        session.pop("access_token", None)
        session.pop("refresh_token", None)
        session.pop("expires_at", None)
        raise Exception("Unauthorized - please /login again")
    r.raise_for_status()
    return r.json()


# ---------- Matching utilities ----------
def normalize_text(s: str) -> str:
    if not s:
        return ""
    s = s.lower().strip()
    s = re.sub(r"[^a-z0-9\s]", "", s)
    s = re.sub(r"\s+", " ", s)
    return s


def similarity(a: str, b: str) -> float:
    """Return similarity 0..1 between two strings. Prefer rapidfuzz if available."""
    if not a or not b:
        return 0.0
    if HAVE_RAPIDFUZZ:
        return rapid_fuzz.ratio(a, b) / 100.0
    else:
        return SequenceMatcher(None, normalize_text(a), normalize_text(b)).ratio()


# ---------- API endpoints (used by frontend JS) ----------
@app.route("/api/seed-track")
def seed_track():
    """
    Choose a seed track that has a preview_url.
    Preference order: currently-playing -> recently-played -> top tracks.
    Returns JSON with id, name, artists, preview_url, duration_ms.
    """
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

        # 2) recently played (search for preview_url)
        if not track:
            rp = api_get("/me/player/recently-played", params={"limit": 50})
            for it in rp.get("items", []):
                t = it.get("track")
                if t and t.get("preview_url"):
                    track = t
                    break

        # 3) fallback: top tracks
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

        # store minimal answer server-side for checking guesses
        session["current_track"] = {"id": response["id"], "name": response["name"], "artists": response["artists"]}
        session["round"] = 0
        return jsonify(response)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/check-guess", methods=["POST"])
def check_guess():
    """
    Accepts JSON: { "guess": "..." }
    Returns JSON with match metadata and whether the guess was accepted.
    """
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

    # advance round if incorrect (server-side)
    session["round"] = min(session.get("round", 0) + (0 if accepted else 1), len(SNIPPET_LENGTHS) - 1)
    return jsonify(result)


@app.route("/api/session-info")
def session_info():
    """Return minimal session info for frontend hydration."""
    if "current_track" not in session:
        return jsonify({"has_track": False})
    return jsonify({"has_track": True, "round": session.get("round", 0)})


@app.route("/logout")
def logout():
    session.clear()
    return redirect("/")


# ---------- Run ----------
if __name__ == "__main__":
    # Debug server for local development only. Use gunicorn in production.
    app.run(debug=True)
