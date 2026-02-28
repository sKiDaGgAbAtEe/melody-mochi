import { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, get, onValue, update } from "firebase/database";

// ─── Firebase ─────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyArCp_Qw7E-Jj1m-CnvPDpjzCcBUTSv8o8",
  authDomain: "melody-mochi.firebaseapp.com",
  databaseURL: "https://melody-mochi-default-rtdb.firebaseio.com",
  projectId: "melody-mochi",
  storageBucket: "melody-mochi.firebasestorage.app",
  messagingSenderId: "611870525798",
  appId: "1:611870525798:web:195efb7e98312ab0f5a0a7",
};
const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

// ─── YouTube API ──────────────────────────────────────────────────
const YT_KEY = "AIzaSyDUNbILLR6WNLX9MGUFs5KMqNXoqg3pVgk";

function extractPlaylistId(input) {
  const m = input.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : input.trim();
}

async function fetchPlaylistTracks(playlistId) {
  let tracks = [], pageToken = "";
  do {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${playlistId}&key=${YT_KEY}${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    for (const item of data.items || []) {
      const s = item.snippet;
      if (s.title === "Private video" || s.title === "Deleted video") continue;
      tracks.push({
        id: s.resourceId.videoId,
        name: s.title,
        artist: s.videoOwnerChannelTitle || "",
        thumbnail: s.thumbnails?.medium?.url || s.thumbnails?.default?.url || null,
      });
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return tracks;
}

// ─── Answer matching ──────────────────────────────────────────────
function normalize(str) {
  return str.toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\[.*?\]/g, "")
    .replace(/mv|m\/v|official|video|lyrics|audio|hd|4k/gi, "")
    .replace(/[^\w\s가-힣]/g, "")
    .replace(/\s+/g, " ").trim();
}
function isCorrectAnswer(input, track) {
  const n = normalize(input);
  if (n.length < 2) return false;
  const candidates = [normalize(track.name), normalize(track.artist)];
  return candidates.some(c => c.includes(n) || n.includes(c));
}

// ─── Room helpers ─────────────────────────────────────────────────
function makeRoomCode() { return Math.random().toString(36).slice(2, 6).toUpperCase(); }
function makePlayerId() { return Math.random().toString(36).slice(2, 10); }

const REVEAL_LEVELS = [2, 4, 7, 10, 15, 30]; // seconds
const LEVEL_LABELS = ["2s", "4s", "7s", "10s", "15s", "30s"];

// ─── Firebase room ops ────────────────────────────────────────────
async function createRoom(hostName, tracks) {
  const code = makeRoomCode();
  const hostId = makePlayerId();
  const slim = [...tracks].sort(() => Math.random() - 0.5).slice(0, Math.min(tracks.length, 10)).map(t => ({
    id: t.id, name: t.name, artist: t.artist, thumbnail: t.thumbnail || null,
  }));
  await set(ref(db, `rooms/${code}`), {
    code, hostId, status: "lobby",
    round: 0, levelIdx: 0, phase: "bid",
    tracks: slim,
    scores: { [hostId]: 0 },
    players: { [hostId]: { name: hostName, joinedAt: Date.now() } },
    turnOrder: [hostId], currentTurnIdx: 0,
    lastAnswer: null, lastCorrect: null, lastAnswerBy: null,
    updatedAt: Date.now(),
  });
  return { code, playerId: hostId };
}

async function joinRoom(code, playerName) {
  const snap = await get(ref(db, `rooms/${code}`));
  if (!snap.exists()) throw new Error("Room not found. Check the code.");
  const room = snap.val();
  if (room.status === "results") throw new Error("This game has already ended.");
  const playerId = makePlayerId();
  await update(ref(db, `rooms/${code}/players/${playerId}`), { name: playerName, joinedAt: Date.now() });
  await update(ref(db, `rooms/${code}/scores`), { [playerId]: 0 });
  await update(ref(db, `rooms/${code}`), { turnOrder: [...(room.turnOrder || []), playerId] });
  return { playerId, room };
}

async function updateRoom(code, patch) {
  await update(ref(db, `rooms/${code}`), { ...patch, updatedAt: Date.now() });
}

function useRoom(code) {
  const [room, setRoom] = useState(null);
  useEffect(() => {
    if (!code) return;
    return onValue(ref(db, `rooms/${code}`), snap => setRoom(snap.exists() ? snap.val() : null));
  }, [code]);
  return room;
}

// ══════════════════════════════════════════════════════════════════
// STYLES
// ══════════════════════════════════════════════════════════════════
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;700&display=swap');

  :root {
    --bg: #060608;
    --surface: #0e0e12;
    --surface2: #18181f;
    --border: #2a2a35;
    --accent: #ff3d6e;
    --accent2: #ff9500;
    --accent3: #00d4ff;
    --text: #f2f0ff;
    --muted: #7a7a90;
    --correct: #00e676;
    --wrong: #ff3d6e;
    --radius: 12px;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: 'DM Sans', sans-serif; min-height: 100vh; }

  .app {
    min-height: 100vh;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 20px; position: relative; overflow: hidden;
    width: 100%;
  }

  /* Animated noise background */
  .app::before {
    content: ''; position: fixed; inset: -50%;
    width: 200%; height: 200%;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E");
    pointer-events: none; z-index: 0; opacity: 0.4;
  }

  .orb { position: fixed; border-radius: 50%; filter: blur(120px); opacity: 0.2; pointer-events: none; z-index: 0; }
  .orb1 { width: 500px; height: 500px; background: radial-gradient(circle, #ff3d6e, transparent); top: -150px; right: -100px; animation: float1 12s ease-in-out infinite; }
  .orb2 { width: 400px; height: 400px; background: radial-gradient(circle, #00d4ff, transparent); bottom: -100px; left: -100px; animation: float2 15s ease-in-out infinite; }
  .orb3 { width: 300px; height: 300px; background: radial-gradient(circle, #ff9500, transparent); top: 40%; left: 40%; animation: float3 10s ease-in-out infinite; }

  @keyframes float1 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-30px,40px)} }
  @keyframes float2 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(40px,-30px)} }
  @keyframes float3 { 0%,100%{transform:translate(0,0)} 33%{transform:translate(20px,-20px)} 66%{transform:translate(-20px,20px)} }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 20px;
    padding: 36px;
    width: 100%; max-width: 500px;
    position: relative; z-index: 1;
    box-shadow: 0 0 0 1px rgba(255,255,255,0.03), 0 40px 80px rgba(0,0,0,0.6);
    animation: cardIn 0.4s cubic-bezier(0.34,1.56,0.64,1);
  }

  @keyframes cardIn { from{opacity:0;transform:translateY(20px) scale(0.97)} to{opacity:1;transform:none} }

  .logo {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 3.2rem; letter-spacing: 2px;
    background: linear-gradient(135deg, #ff3d6e 0%, #ff9500 50%, #ff3d6e 100%);
    background-size: 200% auto;
    -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
    text-align: center; line-height: 1;
    animation: shimmer 3s linear infinite;
  }
  @keyframes shimmer { to { background-position: 200% center; } }

  .subtitle { text-align: center; color: var(--muted); font-size: 0.78rem; letter-spacing: 4px; text-transform: uppercase; margin-bottom: 32px; margin-top: 4px; }

  .btn {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    width: 100%; padding: 14px 20px; border-radius: 10px; border: none;
    font-family: 'DM Sans', sans-serif; font-size: 0.95rem; font-weight: 700;
    cursor: pointer; transition: all 0.2s; letter-spacing: 0.3px;
    position: relative; overflow: hidden;
  }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn:active:not(:disabled) { transform: scale(0.97); }

  .btn-primary { background: var(--accent); color: white; box-shadow: 0 4px 20px rgba(255,61,110,0.4); }
  .btn-primary:hover:not(:disabled) { box-shadow: 0 4px 30px rgba(255,61,110,0.6); filter: brightness(1.1); }
  .btn-secondary { background: var(--surface2); color: var(--text); border: 1px solid var(--border); }
  .btn-secondary:hover:not(:disabled) { border-color: var(--accent); }
  .btn-ghost { background: transparent; color: var(--muted); border: 1px solid var(--border); }
  .btn-ghost:hover:not(:disabled) { color: var(--text); border-color: var(--muted); }
  .btn-sm { width: auto; padding: 9px 18px; font-size: 0.85rem; }

  .stack { display: flex; flex-direction: column; gap: 10px; }
  .row { display: flex; gap: 8px; align-items: center; }

  .input {
    width: 100%; background: var(--surface2); border: 1px solid var(--border);
    border-radius: 10px; padding: 12px 16px; color: var(--text);
    font-family: 'DM Sans', sans-serif; font-size: 0.95rem; outline: none; transition: border-color 0.2s;
  }
  .input:focus { border-color: var(--accent); }
  .input::placeholder { color: var(--muted); }

  .label { font-size: 0.75rem; letter-spacing: 2px; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; display: block; }
  .field { display: flex; flex-direction: column; }

  .tabs { display: flex; background: var(--surface2); border-radius: 10px; padding: 4px; gap: 4px; margin-bottom: 16px; }
  .tab { flex: 1; padding: 9px; border-radius: 7px; border: none; background: transparent; color: var(--muted); cursor: pointer; font-size: 0.82rem; font-family: 'DM Sans', sans-serif; font-weight: 700; transition: all 0.2s; }
  .tab.active { background: var(--surface); color: var(--text); }

  .notice { background: rgba(0,212,255,0.05); border: 1px solid rgba(0,212,255,0.15); border-radius: 10px; padding: 12px 16px; font-size: 0.82rem; color: var(--accent3); line-height: 1.6; }
  .error-box { background: rgba(255,61,110,0.08); border: 1px solid rgba(255,61,110,0.25); border-radius: 10px; padding: 12px 16px; font-size: 0.82rem; color: var(--wrong); }

  .loading { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 32px; }
  .spinner { width: 36px; height: 36px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Game */
  .round-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .round-label { font-size: 0.75rem; letter-spacing: 2px; text-transform: uppercase; color: var(--muted); }
  .score-chip { background: var(--surface2); border: 1px solid var(--border); border-radius: 100px; padding: 5px 14px; font-size: 0.8rem; font-weight: 700; color: var(--accent); }

  .turn-bar { background: linear-gradient(135deg, rgba(255,61,110,0.12), rgba(255,149,0,0.08)); border: 1px solid rgba(255,61,110,0.2); border-radius: 10px; padding: 10px 16px; text-align: center; margin-bottom: 16px; }
  .your-turn-text { font-weight: 700; color: var(--accent); font-size: 0.95rem; }
  .their-turn-text { color: var(--muted); font-size: 0.88rem; }
  .their-turn-text strong { color: var(--text); }

  /* YouTube player - small visible corner player so audio works */
  .yt-hidden { position: fixed; bottom: 16px; right: 16px; width: 160px; height: 90px; border-radius: 8px; overflow: hidden; z-index: 999; opacity: 1; border: 1px solid var(--border); }

  /* Reveal bar */
  .reveal-bar { display: flex; gap: 5px; margin: 20px 0 6px; }
  .reveal-seg { flex: 1; height: 5px; border-radius: 3px; background: var(--surface2); border: 1px solid var(--border); transition: all 0.3s; }
  .reveal-seg.lit { background: linear-gradient(90deg, var(--accent), var(--accent2)); border-color: var(--accent); box-shadow: 0 0 8px rgba(255,61,110,0.5); }
  .reveal-meta { display: flex; justify-content: space-between; font-size: 0.7rem; color: var(--muted); margin-bottom: 20px; }

  /* Play button */
  .play-wrap { display: flex; justify-content: center; margin: 8px 0 24px; }
  .play-btn {
    width: 76px; height: 76px; border-radius: 50%; border: none;
    background: var(--accent); color: white; font-size: 1.8rem;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: transform 0.15s, box-shadow 0.2s;
    box-shadow: 0 0 0 8px rgba(255,61,110,0.1), 0 0 40px rgba(255,61,110,0.3);
  }
  .play-btn:hover { transform: scale(1.08); box-shadow: 0 0 0 12px rgba(255,61,110,0.15), 0 0 60px rgba(255,61,110,0.5); }
  .play-btn:active { transform: scale(0.95); }
  .play-btn.playing { animation: pulse 1.2s ease-in-out infinite; }
  .play-btn:disabled { opacity: 0.3; cursor: not-allowed; transform: none; }
  @keyframes pulse { 0%,100%{box-shadow:0 0 0 8px rgba(255,61,110,0.1),0 0 40px rgba(255,61,110,0.3)} 50%{box-shadow:0 0 0 16px rgba(255,61,110,0.05),0 0 80px rgba(255,61,110,0.6)} }

  /* Bid grid */
  .bid-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; margin: 12px 0 20px; }
  .bid-btn { background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; padding: 11px 6px; color: var(--muted); font-size: 0.85rem; font-weight: 700; cursor: pointer; transition: all 0.15s; font-family: 'DM Sans', sans-serif; }
  .bid-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .bid-btn.selected { border-color: var(--accent); background: rgba(255,61,110,0.12); color: var(--accent); }
  .bid-btn:disabled { opacity: 0.4; cursor: default; }

  /* Answer row */
  .answer-row { display: flex; gap: 8px; margin-top: 12px; }
  .answer-row .input { flex: 1; }

  /* Result */
  .result-card { text-align: center; padding: 20px; border-radius: 14px; margin-bottom: 16px; animation: pop 0.35s cubic-bezier(0.34,1.56,0.64,1); }
  @keyframes pop { from{transform:scale(0.75);opacity:0} to{transform:scale(1);opacity:1} }
  .result-ok { background: rgba(0,230,118,0.08); border: 1px solid rgba(0,230,118,0.25); }
  .result-no { background: rgba(255,61,110,0.08); border: 1px solid rgba(255,61,110,0.25); }
  .result-headline { font-family: 'Bebas Neue', sans-serif; font-size: 2rem; letter-spacing: 2px; }
  .result-ok .result-headline { color: var(--correct); }
  .result-no .result-headline { color: var(--wrong); }
  .result-sub { font-size: 0.82rem; margin-top: 4px; color: var(--muted); }

  .track-card { display: flex; align-items: center; gap: 14px; background: var(--surface2); border: 1px solid var(--border); border-radius: 12px; padding: 14px; margin-top: 12px; }
  .track-thumb { width: 54px; height: 54px; border-radius: 8px; object-fit: cover; flex-shrink: 0; background: var(--surface); }
  .track-name { font-weight: 700; font-size: 0.92rem; line-height: 1.4; }
  .track-artist { color: var(--muted); font-size: 0.8rem; margin-top: 2px; }

  /* Scoreboard */
  .scoreboard { display: flex; flex-direction: column; gap: 7px; }
  .score-row { display: flex; align-items: center; gap: 12px; background: var(--surface2); border: 1px solid var(--border); border-radius: 9px; padding: 10px 14px; transition: border-color 0.2s; }
  .score-row.me { border-color: rgba(255,61,110,0.35); }
  .score-rank { font-family: 'Bebas Neue', sans-serif; font-size: 1.1rem; width: 26px; color: var(--muted); }
  .score-rank.g { color: #ffd700; } .score-rank.s { color: #c0c0c0; } .score-rank.b { color: #cd7f32; }
  .score-name { flex: 1; font-weight: 600; font-size: 0.9rem; }
  .score-pts { color: var(--accent); font-weight: 700; font-size: 0.9rem; }

  /* Lobby */
  .room-code { font-family: 'Bebas Neue', sans-serif; font-size: 3.5rem; letter-spacing: 12px; text-align: center; color: var(--accent3); line-height: 1; padding: 8px 0; }
  .players-list { display: flex; flex-direction: column; gap: 7px; max-height: 200px; overflow-y: auto; margin: 10px 0; }
  .player-row { display: flex; align-items: center; gap: 10px; background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; font-size: 0.88rem; }
  .pdot { width: 7px; height: 7px; border-radius: 50%; background: var(--correct); box-shadow: 0 0 6px var(--correct); flex-shrink: 0; }
  .tag { background: rgba(255,61,110,0.12); border: 1px solid rgba(255,61,110,0.25); border-radius: 4px; padding: 2px 8px; font-size: 0.68rem; color: var(--accent); letter-spacing: 1px; text-transform: uppercase; margin-left: auto; }
  .copy-btn { background: var(--surface2); border: 1px solid var(--border); border-radius: 6px; padding: 5px 12px; font-size: 0.75rem; color: var(--muted); cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.15s; white-space: nowrap; }
  .copy-btn:hover { color: var(--accent3); border-color: var(--accent3); }

  .waiting-hint { text-align: center; padding: 20px 0 8px; color: var(--muted); font-size: 0.85rem; }
  .waiting-name { font-family: 'Bebas Neue', sans-serif; font-size: 1.6rem; color: var(--accent3); letter-spacing: 1px; }

  .status-row { display: flex; align-items: center; gap: 8px; font-size: 0.75rem; color: var(--muted); margin-bottom: 20px; text-transform: uppercase; letter-spacing: 1px; }
  .sdot { width: 6px; height: 6px; border-radius: 50%; background: var(--correct); box-shadow: 0 0 5px var(--correct); }

  h3 { font-family: 'Bebas Neue', sans-serif; font-size: 1.5rem; letter-spacing: 1px; margin-bottom: 16px; }
  h4 { font-size: 0.72rem; font-weight: 700; color: var(--muted); letter-spacing: 2px; text-transform: uppercase; margin-bottom: 10px; }

  .mt-sm{margin-top:8px} .mt-md{margin-top:16px} .mt-lg{margin-top:24px}
  .mb-sm{margin-bottom:8px} .mb-md{margin-bottom:16px}
  .tc{text-align:center} .tm{color:var(--muted);font-size:0.83rem}
`;

// ══════════════════════════════════════════════════════════════════
// YouTube iframe player hook
// ══════════════════════════════════════════════════════════════════
function useYTPlayer(containerId) {
  const playerRef = useRef(null);
  const readyRef = useRef(false);

  useEffect(() => {
    if (window.YT && window.YT.Player) {
      initPlayer();
    } else {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
      window.onYouTubeIframeAPIReady = initPlayer;
    }
    function initPlayer() {
      playerRef.current = new window.YT.Player(containerId, {
        height: "90", width: "160",
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, modestbranding: 1 },
        events: {
          onReady: (e) => {
            readyRef.current = true;
            e.target.unMute();
            e.target.setVolume(85);
            e.target.stopVideo();
          }
        }
      });
    }
    return () => { try { playerRef.current?.destroy(); } catch(e) {} };
  }, []);

  const playFrom = (videoId, startSec, durationSec, onEnd) => {
    if (!readyRef.current || !playerRef.current) return;
    playerRef.current.loadVideoById({ videoId, startSeconds: startSec });
    playerRef.current.setVolume(85);
    setTimeout(() => {
      try { playerRef.current?.pauseVideo(); } catch(e) {}
      onEnd?.();
    }, durationSec * 1000);
  };

  const stop = () => { try { playerRef.current?.pauseVideo(); } catch(e) {} };

  return { playFrom, stop, ready: readyRef };
}

// ══════════════════════════════════════════════════════════════════
// SCREENS
// ══════════════════════════════════════════════════════════════════

function HomeScreen({ onMode, onJoin }) {
  const [tab, setTab] = useState("play");
  const [joinCode, setJoinCode] = useState("");
  const [joinName, setJoinName] = useState("");
  const [joining, setJoining] = useState(false);
  const [err, setErr] = useState(null);

  // Auto-fill from invite link
  useEffect(() => {
    const auto = sessionStorage.getItem("autoJoin");
    if (auto) { setJoinCode(auto); setTab("join"); sessionStorage.removeItem("autoJoin"); }
  }, []);

  const handleJoin = async () => {
    if (!joinCode.trim() || !joinName.trim()) return;
    setJoining(true); setErr(null);
    try {
      const { playerId } = await joinRoom(joinCode.toUpperCase(), joinName.trim());
      onJoin({ code: joinCode.toUpperCase(), playerId, playerName: joinName.trim() });
    } catch(e) { setErr(e.message); }
    finally { setJoining(false); }
  };

  return (
    <div className="card">
      <div className="logo">MELODY MOCHI</div>
      <div className="subtitle">K-POP • NAME THAT TUNE</div>
      <div className="tabs">
        <button className={`tab ${tab==="play"?"active":""}`} onClick={()=>setTab("play")}>Play</button>
        <button className={`tab ${tab==="join"?"active":""}`} onClick={()=>setTab("join")}>Join Room</button>
      </div>
      {tab === "play" && (
        <div className="stack">
          <button className="btn btn-primary" onClick={()=>onMode("solo")}>🎧 Solo Mode</button>
          <button className="btn btn-secondary" onClick={()=>onMode("create")}>🎤 Create Room</button>
        </div>
      )}
      {tab === "join" && (
        <div className="stack">
          <div className="field">
            <label className="label">Your name</label>
            <input className="input" placeholder="Enter your name…" value={joinName} onChange={e=>setJoinName(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Room Code</label>
            <input className="input" placeholder="XXXX" value={joinCode}
              onChange={e=>setJoinCode(e.target.value.toUpperCase())} maxLength={4}
              style={{letterSpacing:"8px",fontFamily:"'Bebas Neue',sans-serif",fontSize:"1.8rem",textAlign:"center"}}
              onKeyDown={e=>e.key==="Enter"&&handleJoin()} />
          </div>
          {err && <div className="error-box">{err}</div>}
          <button className="btn btn-primary" onClick={handleJoin}
            disabled={joining||joinCode.length<4||!joinName.trim()}>
            {joining ? "Joining…" : "Join Room →"}
          </button>
        </div>
      )}
    </div>
  );
}

function SourceScreen({ onReady, onBack, title = "Load Playlist" }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [preview, setPreview] = useState(null);

  const load = async () => {
    setErr(null); setLoading(true);
    try {
      const id = extractPlaylistId(url);
      if (!id) throw new Error("Couldn't find a playlist ID in that URL.");
      const tracks = await fetchPlaylistTracks(id);
      if (!tracks.length) throw new Error("No videos found in that playlist.");
      setPreview(tracks);
    } catch(e) { setErr(e.message); }
    finally { setLoading(false); }
  };

  if (preview) return (
    <div className="card">
      <h3>✅ Playlist Ready</h3>
      <div className="notice mb-md">Found <strong>{preview.length}</strong> tracks. Up to 10 will be used per game.</div>
      <div className="players-list mb-md">
        {preview.slice(0,6).map(t=>(
          <div className="player-row" key={t.id}>
            {t.thumbnail && <img src={t.thumbnail} width={36} height={36} style={{borderRadius:5,objectFit:"cover"}} alt="" />}
            <span style={{flex:1,fontSize:"0.82rem",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.name}</span>
          </div>
        ))}
        {preview.length>6&&<div className="tm tc">…and {preview.length-6} more</div>}
      </div>
      <div className="stack">
        <button className="btn btn-primary" onClick={()=>onReady(preview)}>Let's Play →</button>
        <button className="btn btn-ghost" onClick={()=>setPreview(null)}>← Different playlist</button>
      </div>
    </div>
  );

  return (
    <div className="card">
      <h3>{title}</h3>
      <div className="notice mb-md">
        Paste any YouTube playlist URL. Works best with K-pop playlists where each video title is the song name!
      </div>
      <div className="field mb-md">
        <label className="label">YouTube Playlist URL</label>
        <input className="input" placeholder="https://youtube.com/playlist?list=…"
          value={url} onChange={e=>setUrl(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&url.trim()&&load()} />
      </div>
      {err && <div className="error-box mb-md">{err}</div>}
      <div className="stack">
        <button className="btn btn-primary" onClick={load} disabled={loading||!url.trim()}>
          {loading ? "Loading…" : "Load Playlist"}
        </button>
        <button className="btn btn-ghost" onClick={onBack}>← Back</button>
      </div>
    </div>
  );
}

function CreateLobbyScreen({ onBack, onGameStart }) {
  const [step, setStep] = useState("name");
  const [hostName, setHostName] = useState("");
  const [tracks, setTracks] = useState([]);
  const [roomInfo, setRoomInfo] = useState(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState(null);
  const [copied, setCopied] = useState(false);
  const room = useRoom(roomInfo?.code);

  const handleTracksReady = async (t) => {
    setTracks(t); setCreating(true);
    try {
      const info = await createRoom(hostName.trim(), t);
      setRoomInfo(info); setStep("lobby");
    } catch(e) { setErr(e.message); }
    finally { setCreating(false); }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}#join=${roomInfo.code}`);
    setCopied(true); setTimeout(()=>setCopied(false), 2000);
  };

  if (step === "name") return (
    <div className="card">
      <h3>🎤 Create Room</h3>
      <div className="field mb-md">
        <label className="label">Your name</label>
        <input className="input" placeholder="Enter your name…" value={hostName}
          onChange={e=>setHostName(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&hostName.trim()&&setStep("source")} autoFocus />
      </div>
      <div className="stack">
        <button className="btn btn-primary" onClick={()=>setStep("source")} disabled={!hostName.trim()}>Next: Pick Playlist →</button>
        <button className="btn btn-ghost" onClick={onBack}>← Back</button>
      </div>
    </div>
  );

  if (step === "source") return (
    <SourceScreen title="Pick Playlist" onReady={handleTracksReady} onBack={()=>setStep("name")} />
  );

  if (creating) return (
    <div className="card"><div className="loading"><div className="spinner" /><div className="tm">Creating room…</div></div></div>
  );

  const players = room ? Object.entries(room.players || {}) : [];

  return (
    <div className="card">
      <div className="row mb-md" style={{justifyContent:"space-between"}}>
        <h3 style={{margin:0}}>Lobby</h3>
        <button className="copy-btn" onClick={copyLink}>{copied?"✓ Copied!":"Copy invite link"}</button>
      </div>
      <div className="tc mb-sm"><span className="tm" style={{fontSize:"0.72rem",letterSpacing:3}}>ROOM CODE</span></div>
      <div className="room-code">{roomInfo?.code}</div>
      <div className="tc tm mb-md" style={{fontSize:"0.75rem"}}>Share code or invite link with friends</div>
      <h4>Players ({players.length})</h4>
      <div className="players-list mb-md">
        {players.map(([id,p])=>(
          <div className="player-row" key={id}>
            <div className="pdot" />
            {p.name}
            {id===roomInfo.playerId&&<span className="tag">You · Host</span>}
          </div>
        ))}
        {players.length===1&&<div className="tm tc" style={{padding:8,fontSize:"0.78rem"}}>Waiting for friends to join…</div>}
      </div>
      {err&&<div className="error-box mb-md">{err}</div>}
      <div className="stack">
        <button className="btn btn-primary" onClick={()=>onGameStart({code:roomInfo.code,playerId:roomInfo.playerId,playerName:hostName,isHost:true})} disabled={players.length<1}>
          Start Game ({players.length} player{players.length!==1?"s":""}) →
        </button>
        <button className="btn btn-ghost" onClick={onBack}>← Cancel</button>
      </div>
    </div>
  );
}

function WaitingScreen({ code, playerId }) {
  const room = useRoom(code);
  if (!room) return <div className="card"><div className="loading"><div className="spinner" /></div></div>;
  const players = Object.entries(room.players || {});
  return (
    <div className="card">
      <h3>Waiting to start…</h3>
      <div className="room-code" style={{fontSize:"2rem",letterSpacing:8}}>{code}</div>
      <h4 className="mt-md">Players ({players.length})</h4>
      <div className="players-list mb-md">
        {players.map(([id,p])=>(
          <div className="player-row" key={id}>
            <div className="pdot" />{p.name}
            {id===playerId&&<span className="tag">You</span>}
            {id===room.hostId&&id!==playerId&&<span className="tag">Host</span>}
          </div>
        ))}
      </div>
      <div className="notice">The host will start the game — sit tight! 🎵</div>
    </div>
  );
}

// ─── Shared game UI pieces ────────────────────────────────────────
function RevealBar({ levelIdx }) {
  return (
    <>
      <div className="reveal-bar">
        {REVEAL_LEVELS.map((_,i)=><div key={i} className={`reveal-seg ${i<=levelIdx?"lit":""}`} />)}
      </div>
      <div className="reveal-meta">
        <span>{LEVEL_LABELS[levelIdx]} revealed</span>
        <span>{REVEAL_LEVELS.length-1-levelIdx} more levels</span>
      </div>
    </>
  );
}

function TrackReveal({ track }) {
  if (!track) return null;
  return (
    <div className="track-card">
      {track.thumbnail&&<img className="track-thumb" src={track.thumbnail} alt="" />}
      <div>
        <div className="track-name">{track.name}</div>
        {track.artist&&<div className="track-artist">{track.artist}</div>}
      </div>
    </div>
  );
}

function ScoreBoard({ scores, players, myId }) {
  const sorted = Object.entries(scores).sort(([,a],[,b])=>b-a);
  const ranks = ["g","s","b"];
  const rankLabels = ["①","②","③"];
  return (
    <div className="scoreboard">
      {sorted.map(([id,pts],i)=>(
        <div className={`score-row ${id===myId?"me":""}`} key={id}>
          <div className={`score-rank ${ranks[i]||""}`}>{rankLabels[i]||`${i+1}.`}</div>
          <div className="score-name">{players?.[id]?.name||id}{id===myId?" (you)":""}</div>
          <div className="score-pts">{pts} pts</div>
        </div>
      ))}
    </div>
  );
}

// ─── Multiplayer Game ─────────────────────────────────────────────
function MultiGameScreen({ code, playerId, playerName, onDone }) {
  const room = useRoom(code);
  const { playFrom, stop } = useYTPlayer("yt-player");
  const [playing, setPlaying] = useState(false);
  const [answer, setAnswer] = useState("");
  const stopRef = useRef(stop);
  stopRef.current = stop;

  useEffect(() => { return () => stopRef.current?.(); }, []);

  useEffect(() => {
    setAnswer(""); setPlaying(false); stopRef.current?.();
  }, [room?.round, room?.phase]);

  useEffect(() => {
    if (room?.status === "results") onDone(room.scores, room.players);
  }, [room?.status]);

  if (!room) return <div className="card"><div className="loading"><div className="spinner" /></div></div>;

  const track = room.tracks?.[room.round];
  const turnOrder = room.turnOrder || [];
  const currentId = turnOrder[room.currentTurnIdx % turnOrder.length];
  const isMyTurn = currentId === playerId;
  const currentName = room.players?.[currentId]?.name || "?";
  const levelIdx = room.levelIdx ?? 0;
  const phase = room.phase || "bid";
  const totalRounds = room.tracks?.length || 0;

  const doPlay = () => {
    if (!track?.id) return;
    setPlaying(true);
    playFrom(track.id, 15, REVEAL_LEVELS[levelIdx], () => setPlaying(false));
  };

  const doStop = () => { stop(); setPlaying(false); };

  const handleBid = async (i) => {
    if (!isMyTurn) return;
    await updateRoom(code, { levelIdx: i });
  };

  const handleRevealMore = async () => {
    if (!isMyTurn) return;
    const next = Math.min(levelIdx+1, REVEAL_LEVELS.length-1);
    await updateRoom(code, { levelIdx: next });
  };

  const handleGuess = async () => {
    if (!isMyTurn) return;
    await updateRoom(code, { phase: "guess" });
  };

  const handleSubmit = async () => {
    if (!answer.trim()) return;
    const ok = isCorrectAnswer(answer, track);
    const pts = ok ? REVEAL_LEVELS.length - levelIdx : 0;
    const newScore = (room.scores?.[playerId]||0) + pts;
    await updateRoom(code, {
      phase: "result", lastAnswer: answer, lastCorrect: ok,
      lastAnswerBy: playerId, [`scores/${playerId}`]: newScore,
    });
  };

  const handleNext = async () => {
    const nextRound = room.round + 1;
    if (nextRound >= totalRounds) {
      await updateRoom(code, { status: "results" });
    } else {
      const nextTurnIdx = (room.currentTurnIdx+1) % turnOrder.length;
      await updateRoom(code, { round: nextRound, levelIdx: 0, phase: "bid", lastAnswer: null, lastCorrect: null, currentTurnIdx: nextTurnIdx });
    }
  };

  return (
    <>
      <div id="yt-player" className="yt-hidden" />
      <div className="card">
        <div className="round-header">
          <span className="round-label">Round {room.round+1} / {totalRounds}</span>
          <span className="score-chip">{room.scores?.[playerId]||0} pts</span>
        </div>

        <div className="turn-bar">
          {isMyTurn
            ? <div className="your-turn-text">🎤 Your turn!</div>
            : <div className="their-turn-text">🎵 <strong>{currentName}</strong>'s turn</div>
          }
        </div>

        <RevealBar levelIdx={levelIdx} />

        {phase !== "result" && (
          <div className="play-wrap">
            <button className={`play-btn ${playing?"playing":""}`}
              onClick={playing?doStop:doPlay} disabled={!track?.id}>
              {playing?"⏹":"▶"}
            </button>
          </div>
        )}

        {phase === "bid" && (
          <>
            <h4>How much audio do you need?</h4>
            <div className="bid-grid">
              {REVEAL_LEVELS.map((_,i)=>(
                <button key={i} className={`bid-btn ${levelIdx===i?"selected":""}`}
                  onClick={()=>handleBid(i)} disabled={!isMyTurn}>
                  {LEVEL_LABELS[i]}
                </button>
              ))}
            </div>
            {isMyTurn ? (
              <div className="stack">
                <button className="btn btn-primary" onClick={handleGuess}>I'm ready to guess →</button>
                <button className="btn btn-ghost" onClick={handleRevealMore} disabled={levelIdx>=REVEAL_LEVELS.length-1}>Reveal more audio</button>
              </div>
            ) : (
              <div className="waiting-hint">
                <div className="waiting-name">{currentName}</div>
                <div>is deciding…</div>
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
                  <input className="input" placeholder="Song title or artist…" value={answer}
                    onChange={e=>setAnswer(e.target.value)}
                    onKeyDown={e=>e.key==="Enter"&&answer.trim()&&handleSubmit()} autoFocus />
                  <button className="btn btn-primary btn-sm" onClick={handleSubmit} disabled={!answer.trim()}>✓</button>
                </div>
                <button className="btn btn-ghost mt-md" style={{width:"100%"}} onClick={handleRevealMore}
                  disabled={levelIdx>=REVEAL_LEVELS.length-1}>Give me more audio</button>
              </>
            ) : (
              <div className="waiting-hint">
                <div className="waiting-name">{currentName}</div>
                <div>is typing their answer…</div>
              </div>
            )}
          </>
        )}

        {phase === "result" && (
          <>
            <div className={`result-card ${room.lastCorrect?"result-ok":"result-no"}`}>
              <div className="result-headline">{room.lastCorrect?"정답! 🎉":"틀렸어요 😅"}</div>
              <div className="result-sub">
                {room.lastCorrect
                  ? `${room.players?.[room.lastAnswerBy]?.name} got it! +${REVEAL_LEVELS.length-levelIdx} pts`
                  : `${room.players?.[room.lastAnswerBy]?.name} guessed: "${room.lastAnswer}"`}
              </div>
            </div>
            <TrackReveal track={track} />
            <div className="mt-md mb-md">
              <h4>Scores</h4>
              <ScoreBoard scores={room.scores||{}} players={room.players} myId={playerId} />
            </div>
            <button className="btn btn-primary" onClick={handleNext}>
              {room.round+1>=totalRounds?"See Final Results →":"Next Round →"}
            </button>
          </>
        )}
      </div>
    </>
  );
}

// ─── Solo Game ────────────────────────────────────────────────────
function SoloGameScreen({ tracks, onDone }) {
  const total = Math.min(tracks.length, 10);
  const shuffled = useRef([...tracks].sort(()=>Math.random()-0.5).slice(0,total));
  const [round, setRound] = useState(0);
  const [levelIdx, setLevelIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [phase, setPhase] = useState("bid");
  const [answer, setAnswer] = useState("");
  const [correct, setCorrect] = useState(null);
  const [score, setScore] = useState(0);
  const { playFrom, stop } = useYTPlayer("yt-player-solo");

  const track = shuffled.current[round];

  useEffect(() => { return () => stop(); }, []);

  const doPlay = () => {
    setPlaying(true);
    playFrom(track.id, 15, REVEAL_LEVELS[levelIdx], ()=>setPlaying(false));
  };
  const doStop = () => { stop(); setPlaying(false); };

  const submit = () => {
    doStop();
    const ok = isCorrectAnswer(answer, track);
    setCorrect(ok);
    if (ok) setScore(s=>s+(REVEAL_LEVELS.length-levelIdx));
    setPhase("result");
  };

  const next = () => {
    doStop();
    if (round+1>=total) { onDone({Solo:score+(correct?0:0)}, null); return; }
    setRound(r=>r+1); setLevelIdx(0); setPhase("bid"); setAnswer(""); setCorrect(null);
  };

  return (
    <>
      <div id="yt-player-solo" className="yt-hidden" />
      <div className="card">
        <div className="round-header">
          <span className="round-label">Round {round+1} / {total}</span>
          <span className="score-chip">{score} pts</span>
        </div>

        <RevealBar levelIdx={levelIdx} />

        {phase !== "result" && (
          <div className="play-wrap">
            <button className={`play-btn ${playing?"playing":""}`}
              onClick={playing?doStop:doPlay} disabled={!track?.id}>
              {playing?"⏹":"▶"}
            </button>
          </div>
        )}

        {phase === "bid" && (
          <>
            <h4>How much audio do you need?</h4>
            <div className="bid-grid">
              {REVEAL_LEVELS.map((_,i)=>(
                <button key={i} className={`bid-btn ${levelIdx===i?"selected":""}`}
                  onClick={()=>setLevelIdx(i)}>{LEVEL_LABELS[i]}</button>
              ))}
            </div>
            <div className="stack mt-md">
              <button className="btn btn-primary" onClick={()=>setPhase("guess")}>I'm ready to guess →</button>
              <button className="btn btn-ghost" onClick={()=>setLevelIdx(i=>Math.min(i+1,REVEAL_LEVELS.length-1))}
                disabled={levelIdx>=REVEAL_LEVELS.length-1}>Reveal more audio</button>
            </div>
          </>
        )}

        {phase === "guess" && (
          <>
            <h4>What's the song?</h4>
            <div className="answer-row">
              <input className="input" placeholder="Song title or artist…" value={answer}
                onChange={e=>setAnswer(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&answer.trim()&&submit()} autoFocus />
              <button className="btn btn-primary btn-sm" onClick={submit} disabled={!answer.trim()}>✓</button>
            </div>
            <button className="btn btn-ghost mt-md" style={{width:"100%"}}
              onClick={()=>setLevelIdx(i=>Math.min(i+1,REVEAL_LEVELS.length-1))}
              disabled={levelIdx>=REVEAL_LEVELS.length-1}>Give me more audio</button>
          </>
        )}

        {phase === "result" && (
          <>
            <div className={`result-card ${correct?"result-ok":"result-no"}`}>
              <div className="result-headline">{correct?"정답! 🎉":"틀렸어요 😅"}</div>
              <div className="result-sub">
                {correct?`+${REVEAL_LEVELS.length-levelIdx} points · ${LEVEL_LABELS[levelIdx]} hint`:"Better luck next round!"}
              </div>
            </div>
            <TrackReveal track={track} />
            <button className="btn btn-primary mt-md" onClick={next}>
              {round+1>=total?"See Final Results →":"Next Round →"}
            </button>
          </>
        )}
      </div>
    </>
  );
}

// ─── Results ──────────────────────────────────────────────────────
function ResultsScreen({ scores, players, onRestart }) {
  const sorted = Object.entries(scores).sort(([,a],[,b])=>b-a);
  const ranks = ["g","s","b"];
  const medals = ["🥇","🥈","🥉"];
  return (
    <div className="card">
      <div className="logo" style={{marginBottom:6}}>게임 끝!</div>
      <div className="subtitle">Game Over</div>
      <h3>🏆 Final Scores</h3>
      <div className="scoreboard mb-md">
        {sorted.map(([id,pts],i)=>(
          <div className={`score-row ${ranks[i]||""}`} key={id}
            style={i===0?{borderColor:"rgba(255,215,0,0.4)",background:"rgba(255,215,0,0.04)"}:{}}>
            <div className={`score-rank ${ranks[i]||""}`}>{medals[i]||`${i+1}.`}</div>
            <div className="score-name">{players?.[id]?.name||id}</div>
            <div className="score-pts">{pts} pts</div>
          </div>
        ))}
      </div>
      <button className="btn btn-primary" onClick={onRestart}>Play Again</button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// ROOT
// ══════════════════════════════════════════════════════════════════
export default function App() {
  const [screen, setScreen] = useState("home");
  const [mode, setMode] = useState(null);
  const [soloTracks, setSoloTracks] = useState([]);
  const [multiInfo, setMultiInfo] = useState(null);
  const [finalScores, setFinalScores] = useState({});
  const [finalPlayers, setFinalPlayers] = useState(null);

  // Handle invite link
  useEffect(() => {
    const hash = window.location.hash;
    const m = hash.match(/#join=([A-Z0-9]{4})/i);
    if (m) {
      sessionStorage.setItem("autoJoin", m[1].toUpperCase());
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const handleMode = (m) => { setMode(m); setScreen(m === "solo" ? "source" : "create"); };

  const handleJoin = ({ code, playerId, playerName }) => {
    setMultiInfo({ code, playerId, playerName, isHost: false });
    setScreen("waiting");
  };

  const handleGameStart = (info) => { setMultiInfo(info); setScreen("multigame"); };

  const handleDone = (scores, players) => {
    setFinalScores(scores); setFinalPlayers(players);
    setScreen("results");
  };

  const restart = () => {
    setScreen("home"); setMode(null); setSoloTracks([]);
    setMultiInfo(null); setFinalScores({}); setFinalPlayers(null);
  };

  // Watch for game start in waiting room
  const waitingRoom = useRoom(screen === "waiting" ? multiInfo?.code : null);
  useEffect(() => {
    if (screen === "waiting" && waitingRoom?.status === "playing") setScreen("multigame");
  }, [waitingRoom?.status, screen]);

  return (
    <>
      <style>{css}</style>
      <div className="app">
        <div className="orb orb1" /><div className="orb orb2" /><div className="orb orb3" />

        {screen === "home" && <HomeScreen onMode={handleMode} onJoin={handleJoin} />}
        {screen === "source" && <SourceScreen onReady={t=>{setSoloTracks(t);setScreen("sologame");}} onBack={()=>setScreen("home")} />}
        {screen === "create" && <CreateLobbyScreen onBack={()=>setScreen("home")} onGameStart={handleGameStart} />}
        {screen === "waiting" && <WaitingScreen code={multiInfo?.code} playerId={multiInfo?.playerId} />}
        {screen === "multigame" && <MultiGameScreen code={multiInfo?.code} playerId={multiInfo?.playerId} playerName={multiInfo?.playerName} onDone={handleDone} />}
        {screen === "sologame" && <SoloGameScreen tracks={soloTracks} onDone={handleDone} />}
        {screen === "results" && <ResultsScreen scores={finalScores} players={finalPlayers} onRestart={restart} />}
      </div>
    </>
  );
}
