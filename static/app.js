// static/app.js (DEBUG VERSION)
// Replace your current app.js with this to quickly diagnose why buttons do nothing.
// It logs loading, checks DOM elements, attaches debug event handlers, and performs a test fetch.

console.log("[spordle-debug] app.js loaded at", new Date().toISOString());

// Helper safe-get
function $id(id) { return document.getElementById(id); }

// Check script tag presence
try {
  const scriptTag = document.querySelector("script[src*='app.js']");
  console.log("[spordle-debug] script tag present:", !!scriptTag, scriptTag && scriptTag.src);
} catch (e) {
  console.error("[spordle-debug] script tag check failed", e);
}

// Check DOM elements
const ids = ['play-snippet','fetch-new','guess-form','guess-input','info','history','errors','stat-correct','stat-attempts'];
ids.forEach(id => {
  const el = $id(id);
  console.log(`[spordle-debug] element #${id}:`, el ? "FOUND" : "MISSING");
});

// Attach debug handlers (always attach even if original logic broken)
const playBtn = $id('play-snippet');
if (playBtn) {
  playBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    console.log("[spordle-debug] play-snippet CLICK");
    // quick test network ping
    fetch("/api/session-info").then(r=>r.json()).then(j=>{
      console.log("[spordle-debug] /api/session-info response:", j);
      alert("Debug: /api/session-info returned: " + JSON.stringify(j));
    }).catch(err=>{
      console.error("[spordle-debug] /api/session-info fetch error:", err);
      alert("Debug: network fetch failed: " + err);
    });
  });
} else {
  console.warn("[spordle-debug] play button missing; cannot attach handler");
}

const newBtn = $id('fetch-new');
if (newBtn) {
  newBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    console.log("[spordle-debug] fetch-new CLICK");
    // Attempt to call seed-track
    fetch("/api/seed-track")
      .then(r => {
        console.log("[spordle-debug] /api/seed-track status", r.status);
        return r.json();
      })
      .then(j => console.log("[spordle-debug] /api/seed-track json:", j))
      .catch(err => console.error("[spordle-debug] /api/seed-track fetch failed:", err));
  });
} else {
  console.warn("[spordle-debug] new song button missing; cannot attach handler");
}

// Guess form attach
const guessForm = $id('guess-form');
if (guessForm) {
  guessForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    console.log("[spordle-debug] guess-form SUBMIT");
    const val = ($id('guess-input') && $id('guess-input').value) || "";
    console.log("[spordle-debug] guess value:", val);
    // test check-guess call (sends dummy correct_title if state missing)
    fetch("/api/check-guess", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ guess: val, correct_title: "test title for debug" })
    })
    .then(r => r.json())
    .then(j => console.log("[spordle-debug] /api/check-guess json:", j))
    .catch(err => console.error("[spordle-debug] /api/check-guess error:", err));
  });
} else {
  console.warn("[spordle-debug] guess form missing; cannot attach handler");
}

// Also check console for any runtime errors that happened before this script ran
window.addEventListener('error', (ev) => {
  console.error("[spordle-debug] window error event:", ev.message, ev.error);
});
window.addEventListener('unhandledrejection', (ev) => {
  console.error("[spordle-debug] unhandled rejection:", ev.reason);
});

console.log("[spordle-debug] debug script finished attaching handlers");
