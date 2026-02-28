import { useState, useEffect, useRef, useCallback } from "react";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, get, onValue, update, remove } from "firebase/database";

// ─── Firebase ─────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyArCp_Qw7E-Jj1m-CnvPDpjzCcBUTSv8o8",
  authDomain: "melody-mochi.firebaseapp.com",
  databaseURL: "https://melody-mochi-default-rtdb.firebaseio.com",
  projectId: "melody-mochi",
  storageBucket: "melody-mochi.firebasestorage.app",
  messagingSenderId: "611870525798",
  appId: "1:611870525798:web:195efb7e98312ab0f5a0a7",
  measurementId: "G-T2ST6DQYNL"
};
const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

// ─── Spotify Config ───────────────────────────────────────────────
// TODO: Replace with your Spotify Client ID from developer.spotify.com
const CLIENT_ID = "YOUR_SPOTIFY_CLIENT_ID";
const REDIRECT_URI = window.location.origin + window.location.pathname;
const SCOPES = ["playlist-read-private", "playlist-read-collaborative"].join(" ");

// ─── Snippet reveal levels (ms) ──────────────────────────────────
const REVEAL_LEVELS = [350, 700, 1400, 2800, 5600, 15000];
const LEVEL_LABELS = ["0.35s", "0.7s", "1.4s", "2.8s", "5.6s", "15s"];

// ─── Spotify PKCE Auth ────────────────────────────────────────────
async function sha256(plain) {
  const data = new TextEncoder().encode(plain);
  return window.crypto.subtle.digest("SHA-256", data);
}
function base64urlencode(a) {
  return btoa(String.fromCharCode(...new Uint8Array(a)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
async function generateCodeChallenge(verifier) {
  return base64urlencode(await sha256(verifier));
}
function generateCodeVerifier() {
  const array = new Uint32Array(56);
  window.crypto.getRandomValues(array);
  return Array.from(array, d => d.toString(36)).join("").slice(0, 128);
}
async function initiateSpotifyAuth() {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  sessionStorage.setItem("pkce_verifier", verifier);
  const params = new URLSearchParams({
    response_type: "code", client_id: CLIENT_ID,
    scope: SCOPES, redirect_uri: REDIRECT_URI,
    code_challenge_method: "S256", code_challenge: challenge,
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}
async function exchangeCodeForToken(code) {
  const verifier = sessionStorage.getItem("pkce_verifier");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code,
      redirect_uri: REDIRECT_URI, client_id: CLIENT_ID,
      code_verifier: verifier,
    }),
  });
  return res.json();
}

// ─── Spotify API ──────────────────────────────────────────────────
async function spotifyFetch(path, token) {
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Spotify error ${res.status}`);
  return res.json();
}
async function searchKpopTracks(query, token) {
  const q = query ? `${query} genre:k-pop` : "genre:k-pop year:2020-2025";
  const data = await spotifyFetch(
    `/search?q=${encodeURIComponent(q)}&type=track&limit=50&market=US`, token
  );
  return (data.tracks?.items || []).filter(t => t.preview_url);
}
async function getPlaylistTracks(playlistId, token) {
  let tracks = [], url =
    `/playlists/${playlistId}/tracks?limit=50&fields=next,items(track(id,name,artists,preview_url,album(images)))`;
  while (url) {
    const data = await spotifyFetch(url, token);
    tracks = [...tracks, ...(data.items || []).map(i => i.track).filter(t => t?.preview_url)];
    url = data.next ? data.next.replace("https://api.spotify.com/v1", "") : null;
  }
  return tracks;
}
function extractPlaylistId(input) {
  const m = input.match(/playlist\/([a-zA-Z0-9]+)/);
  return m ? m[1] : input.trim();
}

// ─── Answer matching ──────────────────────────────────────────────
function normalize(str) {
  return str.toLowerCase().replace(/[^\w\s가-힣]/g, "").replace(/\s+/g, " ").trim();
}
function isCorrectAnswer(input, track) {
  const n = normalize(input);
  const candidates = [
    track.name,
    ...(track.artists?.map(a => a.name) || []),
    `${track.name} ${track.artists?.[0]?.name || ""}`,
  ].map(normalize);
  return candidates.some(c => c.includes(n) || n.includes(c));
}

// ─── Room helpers ─────────────────────────────────────────────────
function makeRoomCode() {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}
function makePlayerId() {
  return Math.random().toString(36).slice(2, 10);
}

// ─── Spotify auth hook ────────────────────────────────────────────
function useSpotifyAuth() {
  const [token, setToken] = useState(() => sessionStorage.getItem("spotify_token") || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code && !token) {
      setLoading(true);
      exchangeCodeForToken(code)
        .then(data => {
          if (data.access_token) {
            sessionStorage.setItem("spotify_token", data.access_token);
            setToken(data.access_token);
            window.history.replaceState({}, "", window.location.pathname);
          } else {
            setError("Spotify auth failed: " + (data.error_description || "unknown error"));
          }
        })
        .catch(e => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, []);

  const logout = () => { sessionStorage.removeItem("spotify_token"); setToken(null); };
  return { token, loading, error, logout };
}

// ══════════════════════════════════════════════════════════════════
// STYLES
// ══════════════════════════════════════════════════════════════════
const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Noto+Sans+KR:wght@300;400;700&display=swap');

  :root {
    --bg: #0a0010;
    --surface: #12001f;
    --surface2: #1c0030;
    --border: #3d0060;
    --accent: #d400ff;
    --accent2: #ff2d78;
    --accent3: #00e5ff;
    --text: #f0e6ff;
    --muted: #9a80b0;
    --correct: #00e676;
    --wrong: #ff1744;
    --radius: 14px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: 'Noto Sans KR', sans-serif; min-height: 100vh; overflow-x: hidden; }
  .app { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; position: relative; }
  .app::before {
    content: ''; position: fixed; inset: 0;
    background-image: linear-gradient(rgba(212,0,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(212,0,255,0.07) 1px, transparent 1px);
    background-size: 40px 40px; pointer-events: none; z-index: 0;
  }
  .glow-orb { position: fixed; border-radius: 50%; filter: blur(80px); opacity: 0.35; pointer-events: none; z-index: 0; }
  .orb1 { width: 400px; height: 400px; background: #d400ff; top: -100px; left: -100px; animation: drift1 8s ease-in-out infinite; }
  .orb2 { width: 350px; height: 350px; background: #ff2d78; bottom: -80px; right: -80px; animation: drift2 10s ease-in-out infinite; }
  @keyframes drift1 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(40px,30px)} }
  @keyframes drift2 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-30px,-40px)} }

  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 32px; width: 100%; max-width: 520px; position: relative; z-index: 1; box-shadow: 0 0 60px rgba(212,0,255,0.12); }
  .logo { font-family: 'Black Han Sans', sans-serif; font-size: 2.8rem; letter-spacing: -1px; background: linear-gradient(135deg, var(--accent) 0%, var(--accent2) 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; text-align: center; line-height: 1; margin-bottom: 4px; }
  .subtitle { text-align: center; color: var(--muted); font-size: 0.85rem; letter-spacing: 3px; text-transform: uppercase; margin-bottom: 32px; }
  .btn { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 14px 20px; border-radius: 10px; border: none; font-family: 'Noto Sans KR', sans-serif; font-size: 0.95rem; font-weight: 700; cursor: pointer; transition: all 0.18s ease; letter-spacing: 0.5px; position: relative; overflow: hidden; }
  .btn::after { content: ''; position: absolute; inset: 0; background: white; opacity: 0; transition: opacity 0.18s; }
  .btn:hover::after { opacity: 0.07; }
  .btn:active { transform: scale(0.97); }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .btn-primary { background: linear-gradient(135deg, var(--accent), var(--accent2)); color: white; }
  .btn-secondary { background: var(--surface2); color: var(--text); border: 1px solid var(--border); }
  .btn-ghost { background: transparent; color: var(--muted); border: 1px solid var(--border); }
  .btn-sm { width: auto; padding: 8px 16px; font-size: 0.82rem; }
  .btn-spotify { background: #1DB954; color: #000; }
  .btn-danger { background: rgba(255,23,68,0.12); color: var(--wrong); border: 1px solid rgba(255,23,68,0.3); }

  .stack { display: flex; flex-direction: column; gap: 12px; }
  .row { display: flex; gap: 8px; align-items: center; }
  .input { width: 100%; background: var(--surface2); border: 1px solid var(--border); border-radius: 10px; padding: 12px 16px; color: var(--text); font-family: 'Noto Sans KR', sans-serif; font-size: 0.95rem; outline: none; transition: border-color 0.2s; }
  .input:focus { border-color: var(--accent); }
  .input::placeholder { color: var(--muted); }
  .label { font-size: 0.78rem; letter-spacing: 2px; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; display: block; }
  .field { display: flex; flex-direction: column; }
  .divider { display: flex; align-items: center; gap: 12px; color: var(--muted); font-size: 0.8rem; margin: 4px 0; }
  .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--border); }

  .round-info { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; font-size: 0.82rem; color: var(--muted); letter-spacing: 1px; text-transform: uppercase; }
  .score-pill { background: var(--surface2); border: 1px solid var(--border); border-radius: 100px; padding: 4px 14px; font-size: 0.8rem; color: var(--accent); font-weight: 700; }
  .reveal-track { display: flex; gap: 6px; margin: 20px 0; }
  .reveal-seg { flex: 1; height: 6px; border-radius: 3px; background: var(--surface2); border: 1px solid var(--border); transition: background 0.3s, border-color 0.3s; }
  .reveal-seg.active { background: linear-gradient(90deg, var(--accent), var(--accent2)); border-color: var(--accent); box-shadow: 0 0 8px var(--accent); }
  .play-btn-wrap { display: flex; justify-content: center; margin: 24px 0; }
  .play-btn { width: 80px; height: 80px; border-radius: 50%; border: none; background: linear-gradient(135deg, var(--accent), var(--accent2)); color: white; font-size: 2rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: transform 0.15s, box-shadow 0.15s; box-shadow: 0 0 30px rgba(212,0,255,0.4); }
  .play-btn:hover { transform: scale(1.08); box-shadow: 0 0 50px rgba(212,0,255,0.6); }
  .play-btn:active { transform: scale(0.95); }
  .play-btn.playing { animation: pulse 1s ease-in-out infinite; }
  .play-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
  @keyframes pulse { 0%,100%{box-shadow:0 0 30px rgba(212,0,255,0.4)} 50%{box-shadow:0 0 60px rgba(212,0,255,0.8),0 0 100px rgba(255,45,120,0.4)} }

  .bid-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 16px 0; }
  .bid-btn { background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; padding: 10px 6px; color: var(--text); font-size: 0.82rem; cursor: pointer; transition: all 0.15s; font-family: 'Noto Sans KR', sans-serif; text-align: center; }
  .bid-btn:hover { border-color: var(--accent); color: var(--accent); }
  .bid-btn.selected { border-color: var(--accent); background: rgba(212,0,255,0.15); color: var(--accent); box-shadow: 0 0 12px rgba(212,0,255,0.3); }

  .answer-row { display: flex; gap: 8px; margin-top: 16px; }
  .answer-row .input { flex: 1; }

  .result-banner { text-align: center; padding: 20px; border-radius: var(--radius); margin-bottom: 16px; animation: pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
  @keyframes pop { from{transform:scale(0.8);opacity:0} to{transform:scale(1);opacity:1} }
  .result-correct { background: rgba(0,230,118,0.1); border: 1px solid var(--correct); }
  .result-wrong { background: rgba(255,23,68,0.1); border: 1px solid var(--wrong); }
  .result-text { font-family: 'Black Han Sans', sans-serif; font-size: 1.6rem; }
  .result-correct .result-text { color: var(--correct); }
  .result-wrong .result-text { color: var(--wrong); }

  .track-reveal { display: flex; align-items: center; gap: 14px; background: var(--surface2); border: 1px solid var(--border); border-radius: 10px; padding: 12px; margin-top: 12px; }
  .track-art { width: 52px; height: 52px; border-radius: 6px; object-fit: cover; flex-shrink: 0; background: var(--surface); }
  .track-name { font-weight: 700; font-size: 0.95rem; line-height: 1.3; }
  .track-artist { color: var(--muted); font-size: 0.82rem; margin-top: 2px; }

  .room-code-display { font-family: 'Black Han Sans', sans-serif; font-size: 3rem; letter-spacing: 8px; text-align: center; background: linear-gradient(135deg, var(--accent), var(--accent3)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; padding: 12px 0; }
  .players-list { display: flex; flex-direction: column; gap: 8px; max-height: 220px; overflow-y: auto; margin: 12px 0; }
  .player-row { display: flex; align-items: center; gap: 10px; background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; font-size: 0.9rem; }
  .player-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--correct); box-shadow: 0 0 8px var(--correct); flex-shrink: 0; }
  .tag { background: rgba(212,0,255,0.15); border: 1px solid rgba(212,0,255,0.3); border-radius: 4px; padding: 2px 8px; font-size: 0.7rem; color: var(--accent); letter-spacing: 1px; text-transform: uppercase; margin-left: auto; }

  .scoreboard { display: flex; flex-direction: column; gap: 8px; }
  .score-row { display: flex; align-items: center; gap: 12px; background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; }
  .score-rank { font-family: 'Black Han Sans', sans-serif; font-size: 1.1rem; width: 28px; color: var(--muted); }
  .score-rank.gold { color: #ffd700; }
  .score-rank.silver { color: #c0c0c0; }
  .score-rank.bronze { color: #cd7f32; }
  .score-name { flex: 1; font-weight: 700; }
  .score-pts { color: var(--accent); font-weight: 700; }

  .status-bar { display: flex; align-items: center; gap: 8px; font-size: 0.78rem; color: var(--muted); margin-bottom: 20px; text-transform: uppercase; letter-spacing: 1px; }
  .status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--correct); box-shadow: 0 0 6px var(--correct); }

  .tabs { display: flex; background: var(--surface2); border-radius: 10px; padding: 4px; gap: 4px; margin-bottom: 16px; }
  .tab { flex: 1; padding: 8px; border-radius: 7px; border: none; background: transparent; color: var(--muted); cursor: pointer; font-size: 0.82rem; font-family: 'Noto Sans KR', sans-serif; font-weight: 700; letter-spacing: 0.5px; transition: all 0.2s; }
  .tab.active { background: var(--surface); color: var(--text); box-shadow: 0 0 10px rgba(212,0,255,0.2); }

  .notice { background: rgba(0,229,255,0.06); border: 1px solid rgba(0,229,255,0.2); border-radius: 8px; padding: 10px 14px; font-size: 0.8rem; color: var(--accent3); line-height: 1.5; }
  .error-box { background: rgba(255,23,68,0.08); border: 1px solid rgba(255,23,68,0.3); border-radius: 8px; padding: 10px 14px; font-size: 0.82rem; color: var(--wrong); }
  .loading { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 24px; }
  .spinner { width: 40px; height: 40px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to{transform:rotate(360deg)} }

  .waiting-banner { text-align: center; padding: 24px; color: var(--muted); font-size: 0.9rem; }
  .waiting-name { font-family: 'Black Han Sans', sans-serif; font-size: 1.4rem; color: var(--accent3); margin-bottom: 4px; }

  .text-center { text-align: center; }
  .text-muted { color: var(--muted); font-size: 0.85rem; }
  .mt-sm { margin-top: 8px; }
  .mt-md { margin-top: 16px; }
  .mt-lg { margin-top: 24px; }
  .mb-sm { margin-bottom: 8px; }
  .mb-md { margin-bottom: 16px; }
  h3 { font-family: 'Black Han Sans', sans-serif; font-size: 1.2rem; margin-bottom: 12px; }
  h4 { font-size: 0.85rem; font-weight: 700; color: var(--muted); letter-spacing: 1px; text-transform: uppercase; margin-bottom: 8px; }

  .copy-btn { background: var(--surface2); border: 1px solid var(--border); border-radius: 6px; padding: 4px 10px; font-size: 0.75rem; color: var(--muted); cursor: pointer; font-family: 'Noto Sans KR', sans-serif; transition: all 0.15s; }
  .copy-btn:hover { color: var(--accent); border-color: var(--accent); }

  .turn-indicator { background: linear-gradient(135deg, rgba(212,0,255,0.15), rgba(255,45,120,0.15)); border: 1px solid rgba(212,0,255,0.3); border-radius: 10px; padding: 10px 16px; text-align: center; margin-bottom: 16px; font-size: 0.9rem; }
  .your-turn { color: var(--accent); font-weight: 700; font-size: 1rem; }
`;

// ══════════════════════════════════════════════════════════════════
// FIREBASE ROOM HELPERS
// ══════════════════════════════════════════════════════════════════

async function createRoom(hostName, tracks) {
  const code = makeRoomCode();
  const hostId = makePlayerId();
  const shuffled = [...tracks].sort(() => Math.random() - 0.5).slice(0, Math.min(tracks.length, 10));

  // Strip down track data to essentials (Firebase has size limits)
  const slim = shuffled.map(t => ({
    id: t.id,
    name: t.name,
    artists: t.artists?.map(a => a.name) || [],
    preview_url: t.preview_url,
    image: t.album?.images?.[0]?.url || null,
  }));

  await set(ref(db, `rooms/${code}`), {
    code,
    hostId,
    status: "lobby",       // lobby | playing | results
    round: 0,
    levelIdx: 0,
    phase: "bid",          // bid | guess | result
    tracks: slim,
    scores: { [hostId]: 0 },
    players: {
      [hostId]: { name: hostName, joinedAt: Date.now() }
    },
    turnOrder: [hostId],
    currentTurnIdx: 0,
    lastAnswer: null,
    lastCorrect: null,
    updatedAt: Date.now(),
  });

  return { code, playerId: hostId };
}

async function joinRoom(code, playerName) {
  const roomRef = ref(db, `rooms/${code}`);
  const snap = await get(roomRef);
  if (!snap.exists()) throw new Error("Room not found. Check the code.");
  const room = snap.val();
  if (room.status === "results") throw new Error("This game has already ended.");

  const playerId = makePlayerId();
  await update(ref(db, `rooms/${code}/players/${playerId}`), {
    name: playerName, joinedAt: Date.now()
  });
  await update(ref(db, `rooms/${code}/scores`), { [playerId]: 0 });
  // Append to turn order
  const newOrder = [...(room.turnOrder || []), playerId];
  await update(ref(db, `rooms/${code}`), { turnOrder: newOrder });

  return { playerId, room };
}

async function startGame(code) {
  await update(ref(db, `rooms/${code}`), { status: "playing", updatedAt: Date.now() });
}

async function updateGameState(code, patch) {
  await update(ref(db, `rooms/${code}`), { ...patch, updatedAt: Date.now() });
}

function useRoom(code) {
  const [room, setRoom] = useState(null);
  useEffect(() => {
    if (!code) return;
    const roomRef = ref(db, `rooms/${code}`);
    const unsub = onValue(roomRef, snap => {
      setRoom(snap.exists() ? snap.val() : null);
    });
    return unsub;
  }, [code]);
  return room;
}

// ══════════════════════════════════════════════════════════════════
// SCREENS
// ══════════════════════════════════════════════════════════════════

// ─── Home ─────────────────────────────────────────────────────────
function HomeScreen({ token, onSpotifyLogin, authLoading, authError, onMode, onJoin }) {
  const [joinCode, setJoinCode] = useState("");
  const [joinName, setJoinName] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState(null);
  const [tab, setTab] = useState("play");

  const handleJoin = async () => {
    if (!joinCode.trim() || !joinName.trim()) return;
    setJoining(true);
    setJoinError(null);
    try {
      const { playerId, room } = await joinRoom(joinCode.toUpperCase(), joinName.trim());
      onJoin({ code: joinCode.toUpperCase(), playerId, playerName: joinName.trim(), room });
    } catch (e) {
      setJoinError(e.message);
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="card">
      <div className="logo">이름 그 노래</div>
      <div className="subtitle">K-pop • Name That Tune</div>

      {!token ? (
        <div className="stack">
          <div className="notice">
            Connect Spotify to load K-pop tracks with real audio previews. We only read playlists — never modify anything.
          </div>
          {authError && <div className="error-box">{authError}</div>}
          <button className="btn btn-spotify" onClick={onSpotifyLogin} disabled={authLoading}>
            {authLoading ? "Connecting…" : "🎵 Connect Spotify"}
          </button>
        </div>
      ) : (
        <>
          <div className="status-bar"><div className="status-dot" /> Spotify connected</div>
          <div className="tabs">
            <button className={`tab ${tab === "play" ? "active" : ""}`} onClick={() => setTab("play")}>Play</button>
            <button className={`tab ${tab === "join" ? "active" : ""}`} onClick={() => setTab("join")}>Join Room</button>
          </div>

          {tab === "play" && (
            <div className="stack">
              <button className="btn btn-primary" onClick={() => onMode("solo")}>🎧 Solo Mode</button>
              <button className="btn btn-secondary" onClick={() => onMode("create")}>🎤 Create Room</button>
            </div>
          )}

          {tab === "join" && (
            <div className="stack">
              <div className="field">
                <label className="label">Your name</label>
                <input className="input" placeholder="Enter your name…" value={joinName} onChange={e => setJoinName(e.target.value)} />
              </div>
              <div className="field">
                <label className="label">Room Code</label>
                <input className="input" placeholder="XXXX" value={joinCode}
                  onChange={e => setJoinCode(e.target.value.toUpperCase())} maxLength={4}
                  onKeyDown={e => e.key === "Enter" && handleJoin()}
                  style={{letterSpacing: "6px", fontFamily: "'Black Han Sans', sans-serif", fontSize: "1.4rem"}}
                />
              </div>
              {joinError && <div className="error-box">{joinError}</div>}
              <button className="btn btn-primary" onClick={handleJoin}
                disabled={joining || joinCode.length < 4 || !joinName.trim()}>
                {joining ? "Joining…" : "Join Room →"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Source Picker ────────────────────────────────────────────────
function SourceScreen({ token, onTracksReady, onBack }) {
  const [tab, setTab] = useState("playlist");
  const [playlistInput, setPlaylistInput] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);

  const load = async () => {
    setError(null); setLoading(true);
    try {
      let tracks;
      if (tab === "playlist") {
        tracks = await getPlaylistTracks(extractPlaylistId(playlistInput), token);
      } else {
        tracks = await searchKpopTracks(searchInput, token);
      }
      if (!tracks.length) throw new Error("No tracks with previews found. Try a different source.");
      setPreview(tracks);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  if (preview) return (
    <div className="card">
      <h3>✅ Tracks Ready</h3>
      <div className="notice mb-md">Found <strong>{preview.length}</strong> tracks with audio previews.</div>
      <div className="players-list mb-md">
        {preview.slice(0, 6).map(t => (
          <div className="player-row" key={t.id}>
            {t.album?.images?.[2] && <img src={t.album.images[2].url} width={32} height={32} style={{borderRadius:4}} alt="" />}
            <span style={{flex:1, fontSize:"0.85rem"}}><strong>{t.name}</strong> — {t.artists?.[0]?.name}</span>
          </div>
        ))}
        {preview.length > 6 && <div className="text-muted text-center">…and {preview.length - 6} more</div>}
      </div>
      <div className="stack">
        <button className="btn btn-primary" onClick={() => onTracksReady(preview)}>Let's Play →</button>
        <button className="btn btn-ghost" onClick={() => setPreview(null)}>← Change Source</button>
      </div>
    </div>
  );

  return (
    <div className="card">
      <h3>Song Source</h3>
      <div className="tabs">
        <button className={`tab ${tab === "playlist" ? "active" : ""}`} onClick={() => setTab("playlist")}>Playlist</button>
        <button className={`tab ${tab === "search" ? "active" : ""}`} onClick={() => setTab("search")}>Search K-pop</button>
      </div>
      {tab === "playlist" ? (
        <div className="field mb-md">
          <label className="label">Spotify Playlist URL or ID</label>
          <input className="input" placeholder="https://open.spotify.com/playlist/…" value={playlistInput} onChange={e => setPlaylistInput(e.target.value)} />
        </div>
      ) : (
        <div className="field mb-md">
          <label className="label">Artist or keyword (optional)</label>
          <input className="input" placeholder="BTS, BLACKPINK, aespa…" value={searchInput} onChange={e => setSearchInput(e.target.value)} />
          <div className="text-muted mt-sm">Leave blank for general K-pop.</div>
        </div>
      )}
      {error && <div className="error-box mb-md">{error}</div>}
      <div className="stack">
        <button className="btn btn-primary" onClick={load}
          disabled={loading || (tab === "playlist" && !playlistInput.trim())}>
          {loading ? "Loading…" : "Load Tracks"}
        </button>
        <button className="btn btn-ghost" onClick={onBack}>← Back</button>
      </div>
    </div>
  );
}

// ─── Create Room Lobby ────────────────────────────────────────────
function CreateLobbyScreen({ token, onBack, onGameStart }) {
  const [step, setStep] = useState("name"); // name | source | lobby
  const [hostName, setHostName] = useState("");
  const [tracks, setTracks] = useState([]);
  const [roomInfo, setRoomInfo] = useState(null); // { code, playerId }
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const room = useRoom(roomInfo?.code);

  const handleTracksReady = async (t) => {
    setTracks(t);
    setCreating(true);
    try {
      const info = await createRoom(hostName.trim(), t);
      setRoomInfo(info);
      setStep("lobby");
    } catch (e) { setError(e.message); }
    finally { setCreating(false); }
  };

  const handleStart = async () => {
    await startGame(roomInfo.code);
    onGameStart({ code: roomInfo.code, playerId: roomInfo.playerId, playerName: hostName, isHost: true });
  };

  const copyLink = () => {
    navigator.clipboard.writeText(`${window.location.href}#join=${roomInfo.code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (step === "name") return (
    <div className="card">
      <h3>🎤 Create Room</h3>
      <div className="field mb-md">
        <label className="label">Your name</label>
        <input className="input" placeholder="Enter your name…" value={hostName}
          onChange={e => setHostName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && hostName.trim() && setStep("source")} />
      </div>
      <div className="stack">
        <button className="btn btn-primary" onClick={() => setStep("source")} disabled={!hostName.trim()}>
          Next: Pick Songs →
        </button>
        <button className="btn btn-ghost" onClick={onBack}>← Back</button>
      </div>
    </div>
  );

  if (step === "source") return (
    <SourceScreen token={token} onTracksReady={handleTracksReady}
      onBack={() => setStep("name")} />
  );

  if (creating) return (
    <div className="card">
      <div className="loading"><div className="spinner" /><div className="text-muted">Creating room…</div></div>
    </div>
  );

  const players = room ? Object.entries(room.players || {}) : [];

  return (
    <div className="card">
      <div className="row mb-md" style={{justifyContent:"space-between"}}>
        <h3 style={{margin:0}}>🎤 Room</h3>
        <button className="copy-btn" onClick={copyLink}>{copied ? "✓ Copied!" : "Copy invite link"}</button>
      </div>
      <div className="text-center mb-sm"><div className="text-muted" style={{fontSize:"0.75rem",letterSpacing:2}}>ROOM CODE</div></div>
      <div className="room-code-display">{roomInfo?.code}</div>
      <div className="text-center text-muted mb-md" style={{fontSize:"0.78rem"}}>
        Share this code or the invite link with friends
      </div>
      <h4>Players ({players.length})</h4>
      <div className="players-list mb-md">
        {players.map(([id, p]) => (
          <div className="player-row" key={id}>
            <div className="player-dot" />
            {p.name}
            {id === roomInfo.playerId && <span className="tag">You • Host</span>}
          </div>
        ))}
        {players.length === 1 && (
          <div className="text-muted text-center" style={{padding:"8px",fontSize:"0.8rem"}}>
            Waiting for friends to join…
          </div>
        )}
      </div>
      {error && <div className="error-box mb-md">{error}</div>}
      <div className="stack">
        <button className="btn btn-primary" onClick={handleStart} disabled={players.length < 1}>
          Start Game ({players.length} player{players.length !== 1 ? "s" : ""}) →
        </button>
        <button className="btn btn-ghost" onClick={onBack}>← Cancel</button>
      </div>
    </div>
  );
}

// ─── Multiplayer Waiting Room (for joiner) ────────────────────────
function WaitingScreen({ code, playerId, playerName }) {
  const room = useRoom(code);
  if (!room) return (
    <div className="card"><div className="loading"><div className="spinner" /><div className="text-muted">Connecting…</div></div></div>
  );
  const players = Object.entries(room.players || {});
  return (
    <div className="card">
      <h3>Waiting for host to start…</h3>
      <div className="room-code-display" style={{fontSize:"1.6rem",letterSpacing:6}}>{code}</div>
      <h4 className="mt-md">Players ({players.length})</h4>
      <div className="players-list mb-md">
        {players.map(([id, p]) => (
          <div className="player-row" key={id}>
            <div className="player-dot" />
            {p.name}
            {id === playerId && <span className="tag">You</span>}
            {id === room.hostId && id !== playerId && <span className="tag">Host</span>}
          </div>
        ))}
      </div>
      <div className="notice">The host will start the game — sit tight! 🎵</div>
    </div>
  );
}

// ─── Multiplayer Game Screen ──────────────────────────────────────
function MultiGameScreen({ code, playerId, playerName, onDone }) {
  const room = useRoom(code);
  const audioRef = useRef(null);
  const timerRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [answer, setAnswer] = useState("");
  const [localLevelIdx, setLocalLevelIdx] = useState(0);

  // Sync localLevelIdx with Firebase when round changes
  useEffect(() => {
    if (room) setLocalLevelIdx(room.levelIdx ?? 0);
  }, [room?.round]);

  useEffect(() => {
    if (!room) return;
    if (room.status === "results") onDone(room.scores, room.players);
  }, [room?.status]);

  // Stop audio when round or phase changes
  useEffect(() => {
    stopAudio();
    setAnswer("");
  }, [room?.round, room?.phase]);

  if (!room) return (
    <div className="card"><div className="loading"><div className="spinner" /></div></div>
  );

  const track = room.tracks?.[room.round];
  const turnOrder = room.turnOrder || [];
  const currentTurnPlayerId = turnOrder[room.currentTurnIdx % turnOrder.length];
  const isMyTurn = currentTurnPlayerId === playerId;
  const currentPlayerName = room.players?.[currentTurnPlayerId]?.name || "?";
  const totalRounds = room.tracks?.length || 0;
  const levelIdx = room.levelIdx ?? 0;
  const phase = room.phase || "bid";

  const stopAudio = () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
    clearTimeout(timerRef.current);
    setPlaying(false);
  };

  const playSnippet = () => {
    if (!track?.preview_url) return;
    stopAudio();
    const audio = new Audio(track.preview_url);
    audio.currentTime = 3;
    audio.volume = 0.85;
    audio.play();
    audioRef.current = audio;
    setPlaying(true);
    timerRef.current = setTimeout(() => { audio.pause(); setPlaying(false); }, REVEAL_LEVELS[levelIdx]);
  };

  const handleRevealMore = async () => {
    const next = Math.min(levelIdx + 1, REVEAL_LEVELS.length - 1);
    setLocalLevelIdx(next);
    if (isMyTurn) await updateGameState(code, { levelIdx: next });
  };

  const handleBidSelect = async (i) => {
    setLocalLevelIdx(i);
    if (isMyTurn) await updateGameState(code, { levelIdx: i });
  };

  const handleReadyToGuess = async () => {
    if (!isMyTurn) return;
    await updateGameState(code, { phase: "guess" });
  };

  const handleSubmitAnswer = async () => {
    if (!answer.trim()) return;
    const ok = isCorrectAnswer(answer, track);
    const pts = ok ? REVEAL_LEVELS.length - levelIdx : 0;
    const newScore = (room.scores?.[playerId] || 0) + pts;
    await updateGameState(code, {
      phase: "result",
      lastAnswer: answer,
      lastCorrect: ok,
      lastAnswerBy: playerId,
      [`scores/${playerId}`]: newScore,
    });
  };

  const handleNextRound = async () => {
    if (!isMyTurn && phase === "result") return; // only host advances… actually let anyone
    const nextRound = room.round + 1;
    if (nextRound >= totalRounds) {
      await updateGameState(code, { status: "results" });
    } else {
      const nextTurnIdx = (room.currentTurnIdx + 1) % turnOrder.length;
      await updateGameState(code, {
        round: nextRound,
        levelIdx: 0,
        phase: "bid",
        lastAnswer: null,
        lastCorrect: null,
        currentTurnIdx: nextTurnIdx,
      });
    }
  };

  const scores = room.scores || {};
  const players = room.players || {};

  return (
    <div className="card">
      <div className="round-info">
        <span>Round {room.round + 1} / {totalRounds}</span>
        <span className="score-pill">{playerName}</span>
      </div>

      <div className="turn-indicator">
        {isMyTurn
          ? <div className="your-turn">🎤 Your turn!</div>
          : <div>🎵 <strong>{currentPlayerName}</strong>'s turn</div>
        }
      </div>

      <div className="reveal-track">
        {REVEAL_LEVELS.map((_, i) => (
          <div key={i} className={`reveal-seg ${i <= levelIdx ? "active" : ""}`} />
        ))}
      </div>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:"0.72rem",color:"var(--muted)",marginBottom:8}}>
        <span>{LEVEL_LABELS[levelIdx]} revealed</span>
        <span>{LEVEL_LABELS.length - 1 - levelIdx} more levels</span>
      </div>

      {phase !== "result" && (
        <div className="play-btn-wrap">
          <button className={`play-btn ${playing ? "playing" : ""}`}
            onClick={playing ? stopAudio : playSnippet}
            disabled={!track?.preview_url}>
            {playing ? "⏹" : "▶"}
          </button>
        </div>
      )}

      {phase === "bid" && (
        <>
          <h4>How much audio do you need?</h4>
          <div className="bid-grid">
            {REVEAL_LEVELS.map((_, i) => (
              <button key={i}
                className={`bid-btn ${levelIdx === i ? "selected" : ""}`}
                onClick={() => handleBidSelect(i)}
                disabled={!isMyTurn}>
                {LEVEL_LABELS[i]}
              </button>
            ))}
          </div>
          {isMyTurn ? (
            <div className="stack mt-md">
              <button className="btn btn-primary" onClick={handleReadyToGuess}>I'm ready to guess →</button>
              <button className="btn btn-ghost" onClick={handleRevealMore} disabled={levelIdx >= REVEAL_LEVELS.length - 1}>
                Reveal more audio
              </button>
            </div>
          ) : (
            <div className="waiting-banner">
              <div className="waiting-name">{currentPlayerName}</div>
              <div>is deciding how much audio they need…</div>
            </div>
          )}
        </>
      )}

      {phase === "guess" && (
        <>
          <h4>What's the song?</h4>
          {isMyTurn ? (
            <>
              <div className="answer-row">
                <input className="input" placeholder="Song title or artist…"
                  value={answer} onChange={e => setAnswer(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && answer.trim() && handleSubmitAnswer()}
                  autoFocus />
                <button className="btn btn-primary btn-sm" onClick={handleSubmitAnswer} disabled={!answer.trim()}>✓</button>
              </div>
              <button className="btn btn-ghost mt-md" style={{width:"100%"}} onClick={handleRevealMore}
                disabled={levelIdx >= REVEAL_LEVELS.length - 1}>
                Give me more audio
              </button>
            </>
          ) : (
            <div className="waiting-banner">
              <div className="waiting-name">{currentPlayerName}</div>
              <div>is typing their answer…</div>
            </div>
          )}
        </>
      )}

      {phase === "result" && (
        <>
          <div className={`result-banner ${room.lastCorrect ? "result-correct" : "result-wrong"}`}>
            <div className="result-text">{room.lastCorrect ? "정답! 🎉" : "틀렸어요 😅"}</div>
            <div style={{fontSize:"0.85rem",marginTop:4,color: room.lastCorrect ? "var(--correct)" : "var(--wrong)"}}>
              {room.lastCorrect
                ? `${room.players?.[room.lastAnswerBy]?.name} got it! +${REVEAL_LEVELS.length - levelIdx} pts`
                : `${room.players?.[room.lastAnswerBy]?.name} guessed: "${room.lastAnswer}"`}
            </div>
          </div>

          {track && (
            <div className="track-reveal">
              {track.image && <img className="track-art" src={track.image} alt="" />}
              <div>
                <div className="track-name">{track.name}</div>
                <div className="track-artist">{track.artists?.join(", ")}</div>
              </div>
            </div>
          )}

          <div className="scoreboard mt-md mb-md">
            <h4>Scores</h4>
            {Object.entries(scores).sort(([,a],[,b]) => b - a).map(([id, pts], i) => (
              <div className="score-row" key={id} style={id === playerId ? {borderColor:"rgba(212,0,255,0.4)"} : {}}>
                <div className={`score-rank ${i===0?"gold":i===1?"silver":i===2?"bronze":""}`}>
                  {i===0?"①":i===1?"②":i===2?"③":`${i+1}.`}
                </div>
                <div className="score-name">{players[id]?.name || id}{id === playerId ? " (you)" : ""}</div>
                <div className="score-pts">{pts} pts</div>
              </div>
            ))}
          </div>

          <button className="btn btn-primary" onClick={handleNextRound}>
            {room.round + 1 >= totalRounds ? "See Final Results →" : "Next Round →"}
          </button>
        </>
      )}
    </div>
  );
}

// ─── Solo Game Screen ─────────────────────────────────────────────
function SoloGameScreen({ tracks, onDone }) {
  const totalRounds = Math.min(tracks.length, 10);
  const shuffled = useRef([...tracks].sort(() => Math.random() - 0.5).slice(0, totalRounds));
  const [round, setRound] = useState(0);
  const [levelIdx, setLevelIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [phase, setPhase] = useState("bid");
  const [answer, setAnswer] = useState("");
  const [correct, setCorrect] = useState(null);
  const [score, setScore] = useState(0);
  const audioRef = useRef(null);
  const timerRef = useRef(null);

  const track = shuffled.current[round];

  const stopAudio = () => {
    audioRef.current?.pause();
    clearTimeout(timerRef.current);
    setPlaying(false);
  };

  const playSnippet = () => {
    stopAudio();
    const audio = new Audio(track.preview_url);
    audio.currentTime = 3; audio.volume = 0.85;
    audio.play();
    audioRef.current = audio;
    setPlaying(true);
    timerRef.current = setTimeout(() => { audio.pause(); setPlaying(false); }, REVEAL_LEVELS[levelIdx]);
  };

  const submitAnswer = () => {
    stopAudio();
    const ok = isCorrectAnswer(answer, track);
    setCorrect(ok);
    setPhase("result");
    if (ok) setScore(s => s + REVEAL_LEVELS.length - levelIdx);
  };

  const nextRound = () => {
    stopAudio();
    audioRef.current = null;
    if (round + 1 >= totalRounds) {
      onDone({ Solo: score + (correct ? REVEAL_LEVELS.length - levelIdx : 0) });
    } else {
      setRound(r => r + 1);
      setLevelIdx(0);
      setPhase("bid");
      setAnswer("");
      setCorrect(null);
    }
  };

  useEffect(() => () => stopAudio(), []);

  return (
    <div className="card">
      <div className="round-info">
        <span>Round {round + 1} / {totalRounds}</span>
        <span className="score-pill">{score} pts</span>
      </div>
      <div className="reveal-track">
        {REVEAL_LEVELS.map((_, i) => (
          <div key={i} className={`reveal-seg ${i <= levelIdx ? "active" : ""}`} />
        ))}
      </div>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:"0.72rem",color:"var(--muted)",marginBottom:8}}>
        <span>{LEVEL_LABELS[levelIdx]} revealed</span>
        <span>{LEVEL_LABELS.length - 1 - levelIdx} more levels</span>
      </div>

      {phase !== "result" && (
        <div className="play-btn-wrap">
          <button className={`play-btn ${playing ? "playing" : ""}`}
            onClick={playing ? stopAudio : playSnippet}
            disabled={!track?.preview_url}>
            {playing ? "⏹" : "▶"}
          </button>
        </div>
      )}

      {phase === "bid" && (
        <>
          <h4>How much audio do you need?</h4>
          <div className="bid-grid">
            {REVEAL_LEVELS.map((_, i) => (
              <button key={i} className={`bid-btn ${levelIdx === i ? "selected" : ""}`}
                onClick={() => setLevelIdx(i)}>{LEVEL_LABELS[i]}</button>
            ))}
          </div>
          <div className="stack mt-md">
            <button className="btn btn-primary" onClick={() => setPhase("guess")}>I'm ready to guess →</button>
            <button className="btn btn-ghost" onClick={() => setLevelIdx(i => Math.min(i + 1, REVEAL_LEVELS.length - 1))}
              disabled={levelIdx >= REVEAL_LEVELS.length - 1}>Reveal more audio</button>
          </div>
        </>
      )}

      {phase === "guess" && (
        <>
          <h4>What's the song?</h4>
          <div className="answer-row">
            <input className="input" placeholder="Song title or artist…" value={answer}
              onChange={e => setAnswer(e.target.value)}
              onKeyDown={e => e.key === "Enter" && answer.trim() && submitAnswer()} autoFocus />
            <button className="btn btn-primary btn-sm" onClick={submitAnswer} disabled={!answer.trim()}>✓</button>
          </div>
          <button className="btn btn-ghost mt-md" style={{width:"100%"}}
            onClick={() => setLevelIdx(i => Math.min(i + 1, REVEAL_LEVELS.length - 1))}
            disabled={levelIdx >= REVEAL_LEVELS.length - 1}>Give me more audio</button>
        </>
      )}

      {phase === "result" && (
        <>
          <div className={`result-banner ${correct ? "result-correct" : "result-wrong"}`}>
            <div className="result-text">{correct ? "정답! 🎉" : "틀렸어요 😅"}</div>
            <div style={{fontSize:"0.85rem",marginTop:4,color: correct?"var(--correct)":"var(--wrong)"}}>
              {correct ? `+${REVEAL_LEVELS.length - levelIdx} points · ${LEVEL_LABELS[levelIdx]} hint used` : "Better luck next round"}
            </div>
          </div>
          {track && (
            <div className="track-reveal">
              {track.album?.images?.[0] && <img className="track-art" src={track.album.images[0].url} alt="" />}
              <div>
                <div className="track-name">{track.name}</div>
                <div className="track-artist">{track.artists?.map(a => a.name).join(", ")}</div>
              </div>
            </div>
          )}
          <button className="btn btn-primary mt-md" onClick={nextRound}>
            {round + 1 >= totalRounds ? "See Final Results →" : "Next Round →"}
          </button>
        </>
      )}
    </div>
  );
}

// ─── Final Results ────────────────────────────────────────────────
function ResultsScreen({ scores, players, onRestart }) {
  const sorted = Object.entries(scores).sort(([,a],[,b]) => b - a);
  return (
    <div className="card">
      <div className="logo" style={{marginBottom:8}}>게임 끝!</div>
      <div className="subtitle">Game Over</div>
      <h3>🏆 Final Scores</h3>
      <div className="scoreboard mb-md">
        {sorted.map(([id, pts], i) => (
          <div className="score-row" key={id} style={i === 0 ? {borderColor:"#ffd700",background:"rgba(255,215,0,0.06)"} : {}}>
            <div className={`score-rank ${i===0?"gold":i===1?"silver":i===2?"bronze":""}`}>
              {i===0?"🥇":i===1?"🥈":i===2?"🥉":`${i+1}.`}
            </div>
            <div className="score-name">{players?.[id]?.name || id}</div>
            <div className="score-pts">{pts} pts</div>
          </div>
        ))}
      </div>
      <button className="btn btn-primary" onClick={onRestart}>Play Again</button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// ROOT APP
// ══════════════════════════════════════════════════════════════════
export default function App() {
  const { token, loading: authLoading, error: authError, logout } = useSpotifyAuth();
  const [screen, setScreen] = useState("home");
  const [mode, setMode] = useState(null);
  const [soloTracks, setSoloTracks] = useState([]);
  const [multiInfo, setMultiInfo] = useState(null); // { code, playerId, playerName, isHost }
  const [finalScores, setFinalScores] = useState({});
  const [finalPlayers, setFinalPlayers] = useState({});

  // Handle #join=XXXX in URL (invite link)
  useEffect(() => {
    const hash = window.location.hash;
    const m = hash.match(/#join=([A-Z0-9]{4})/);
    if (m) {
      window.history.replaceState({}, "", window.location.pathname);
      // Pre-fill join code by switching to join tab — handled in HomeScreen
      sessionStorage.setItem("autoJoin", m[1]);
    }
  }, []);

  const handleMode = (m) => { setMode(m); setScreen(m === "solo" ? "source" : "create"); };

  const handleJoin = ({ code, playerId, playerName }) => {
    setMultiInfo({ code, playerId, playerName, isHost: false });
    setScreen("waiting");
  };

  const handleGameStart = (info) => { setMultiInfo(info); setScreen("multigame"); };

  const handleSoloTracks = (t) => { setSoloTracks(t); setScreen("sologame"); };

  const handleGameDone = (scores, players) => {
    setFinalScores(scores);
    setFinalPlayers(players || { Solo: { name: "Solo" } });
    setScreen("results");
  };

  const restart = () => {
    setScreen("home"); setMode(null); setSoloTracks([]);
    setMultiInfo(null); setFinalScores({}); setFinalPlayers({});
  };

  // Poll for game start in waiting room
  const waitingRoom = useRoom(multiInfo?.code);
  useEffect(() => {
    if (screen === "waiting" && waitingRoom?.status === "playing") {
      setScreen("multigame");
    }
  }, [waitingRoom?.status, screen]);

  return (
    <>
      <style>{styles}</style>
      <div className="app">
        <div className="glow-orb orb1" />
        <div className="glow-orb orb2" />

        {authLoading ? (
          <div className="card"><div className="loading"><div className="spinner" /><div className="text-muted">Connecting to Spotify…</div></div></div>
        ) : screen === "home" ? (
          <HomeScreen token={token} onSpotifyLogin={initiateSpotifyAuth}
            authLoading={authLoading} authError={authError}
            onMode={handleMode} onJoin={handleJoin} />
        ) : screen === "source" ? (
          <SourceScreen token={token} onTracksReady={handleSoloTracks} onBack={() => setScreen("home")} />
        ) : screen === "create" ? (
          <CreateLobbyScreen token={token} onBack={() => setScreen("home")} onGameStart={handleGameStart} />
        ) : screen === "waiting" ? (
          <WaitingScreen code={multiInfo?.code} playerId={multiInfo?.playerId} playerName={multiInfo?.playerName} />
        ) : screen === "multigame" ? (
          <MultiGameScreen code={multiInfo?.code} playerId={multiInfo?.playerId}
            playerName={multiInfo?.playerName} onDone={handleGameDone} />
        ) : screen === "sologame" ? (
          <SoloGameScreen tracks={soloTracks} onDone={(s) => handleGameDone(s, null)} />
        ) : screen === "results" ? (
          <ResultsScreen scores={finalScores} players={finalPlayers} onRestart={restart} />
        ) : null}

        {token && screen === "home" && (
          <button className="btn btn-ghost btn-sm" style={{marginTop:12,width:"auto",position:"relative",zIndex:1}} onClick={logout}>
            Disconnect Spotify
          </button>
        )}
      </div>
    </>
  );
}
