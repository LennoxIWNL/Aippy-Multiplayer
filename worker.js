// ============================================================================
// worker.js — Generic async multiplayer backend for Aippy games
// ----------------------------------------------------------------------------
// A single-file Cloudflare Worker that gives ANY Aippy game:
//   - No-signup player accounts (UUID identity)
//   - A global leaderboard
//   - Friend lists with score comparison
//   - Async, turn-based matches (chess / cards / words / board-game style)
//
// This file is intentionally game-agnostic. It does not know or care what
// your game is. It stores whatever JSON your client sends and enforces only
// the rules that MUST live on the server (turn order, score-can-only-rise).
// Your game's actual logic stays in your Aippy client — see the Architecture
// section of the README.
//
// Bindings required (see the Setup Guide in the README):
//   env.GAME_USERS        KV namespace - player profiles
//   env.GAME_LEADERBOARD  KV namespace - cached top-N leaderboard
//   env.GAME_MATCHES      KV namespace - active match states
//
// Made by Lennox (@Lennox on Aippy) — built and proven on Pocket Pack Opener,
// then shared as a reusable template.
// ============================================================================

// ---------------------------------------------------------------------------
// Config — tweak these to taste, they are the only "knobs" in the file.
// ---------------------------------------------------------------------------
const LEADERBOARD_SIZE = 50;
const MATCH_TTL_SECONDS = 60 * 60 * 24; // matches auto-delete after 24h

// ---------------------------------------------------------------------------
// CORS — Aippy calls this Worker from the browser, so every response needs
// permissive CORS headers. Allowing all origins is fine for a public game API.
// ---------------------------------------------------------------------------
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function err(message, status = 400) {
  return json({ success: false, error: message }, status);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function randomName() {
  return "Player" + Math.random().toString(36).slice(2, 7).toUpperCase();
}

function matchCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let code = "";
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Leaderboard cache: recomputed on every score submission so reads are a
// single fast KV get.
// ---------------------------------------------------------------------------
async function rebuildLeaderboard(env, player) {
  const raw = await env.GAME_LEADERBOARD.get("global");
  let board = raw ? JSON.parse(raw) : [];

  board = board.filter((e) => e.userId !== player.userId);
  board.push({ userId: player.userId, username: player.username, score: player.score });
  board.sort((a, b) => b.score - a.score);
  board = board.slice(0, LEADERBOARD_SIZE);

  await env.GAME_LEADERBOARD.put("global", JSON.stringify(board));
}

// ===========================================================================
// Route handlers
// ===========================================================================

// POST /register  ->  { success, userId, username }
async function register(req, env) {
  const body = await readJson(req);
  const userId = crypto.randomUUID();
  const username = (body.username && String(body.username).slice(0, 24)) || randomName();

  const player = {
    userId,
    username,
    score: 0,
    stats: {},
    friends: [],
    createdAt: Date.now(),
    lastSeen: Date.now(),
  };

  await env.GAME_USERS.put(`user:${userId}`, JSON.stringify(player));
  return json({ success: true, userId, username });
}

// GET /user?userId=...  ->  full player object
async function getUser(url, env) {
  const userId = url.searchParams.get("userId");
  if (!userId) return err("userId required");

  const raw = await env.GAME_USERS.get(`user:${userId}`);
  if (!raw) return err("User not found", 404);
  return json(JSON.parse(raw));
}

// POST /score  ->  { success, score }
// Score is clamped so it can only ever rise. stats are shallow-merged.
async function submitScore(req, env) {
  const body = await readJson(req);
  if (!body.userId) return err("userId required");

  const raw = await env.GAME_USERS.get(`user:${body.userId}`);
  if (!raw) return err("User not found", 404);

  const player = JSON.parse(raw);

  if (typeof body.score === "number" && body.score > player.score) {
    player.score = body.score;
  }
  if (body.stats && typeof body.stats === "object") {
    player.stats = { ...player.stats, ...body.stats };
  }
  if (typeof body.username === "string" && body.username.trim()) {
    player.username = body.username.slice(0, 24);
  }
  player.lastSeen = Date.now();

  await env.GAME_USERS.put(`user:${body.userId}`, JSON.stringify(player));
  await rebuildLeaderboard(env, player);

  return json({ success: true, score: player.score });
}

// GET /leaderboard  ->  { leaderboard: [...] }
async function leaderboard(env) {
  const raw = await env.GAME_LEADERBOARD.get("global");
  return json({ leaderboard: raw ? JSON.parse(raw) : [] });
}

// POST /friend/add  ->  { success, friendUsername }
async function addFriend(req, env) {
  const body = await readJson(req);
  if (!body.userId || !body.friendId) return err("userId and friendId required");
  if (body.userId === body.friendId) return err("You cannot add yourself");

  const meRaw = await env.GAME_USERS.get(`user:${body.userId}`);
  if (!meRaw) return err("User not found", 404);

  const friendRaw = await env.GAME_USERS.get(`user:${body.friendId}`);
  if (!friendRaw) return err("Friend ID not found - check the code and try again", 404);

  const me = JSON.parse(meRaw);
  const friend = JSON.parse(friendRaw);

  if (!me.friends.includes(friend.userId)) {
    me.friends.push(friend.userId);
    await env.GAME_USERS.put(`user:${me.userId}`, JSON.stringify(me));
  }

  return json({ success: true, friendUsername: friend.username });
}

// GET /friend/list?userId=...  ->  { friends: [...] } sorted by score desc
async function friendList(url, env) {
  const userId = url.searchParams.get("userId");
  if (!userId) return err("userId required");

  const raw = await env.GAME_USERS.get(`user:${userId}`);
  if (!raw) return err("User not found", 404);

  const me = JSON.parse(raw);
  const friends = [];

  for (const fid of me.friends) {
    const fRaw = await env.GAME_USERS.get(`user:${fid}`);
    if (!fRaw) continue;
    const f = JSON.parse(fRaw);
    friends.push({
      userId: f.userId,
      username: f.username,
      score: f.score,
      stats: f.stats,
      lastSeen: f.lastSeen,
    });
  }

  friends.sort((a, b) => b.score - a.score);
  return json({ friends });
}

// POST /match/create  ->  { success, matchId }
async function matchCreate(req, env) {
  const body = await readJson(req);
  if (!body.userId) return err("userId required");

  const matchId = matchCode();
  const match = {
    matchId,
    player1: { userId: body.userId, username: body.username || "Player 1", data: body.data ?? null },
    player2: null,
    status: "waiting",
    turn: "player1",
    state: body.state ?? null,
    log: ["Match created. Waiting for an opponent..."],
    winner: null,
    winnerUsername: null,
    createdAt: Date.now(),
    lastMoveAt: Date.now(),
  };

  await env.GAME_MATCHES.put(`match:${matchId}`, JSON.stringify(match), {
    expirationTtl: MATCH_TTL_SECONDS,
  });
  return json({ success: true, matchId });
}

// POST /match/join  ->  { success, match }
async function matchJoin(req, env) {
  const body = await readJson(req);
  if (!body.matchId || !body.userId) return err("matchId and userId required");

  const raw = await env.GAME_MATCHES.get(`match:${body.matchId}`);
  if (!raw) return err("Match not found - check the code", 404);

  const match = JSON.parse(raw);
  if (match.status !== "waiting") return err("This match has already started");
  if (match.player1.userId === body.userId) return err("Cannot join your own match");

  match.player2 = { userId: body.userId, username: body.username || "Player 2", data: body.data ?? null };
  match.status = "active";
  if (match.state == null && body.state != null) match.state = body.state;
  match.log.push(`${match.player2.username} joined. ${match.player1.username} goes first.`);
  match.lastMoveAt = Date.now();

  await env.GAME_MATCHES.put(`match:${body.matchId}`, JSON.stringify(match), {
    expirationTtl: MATCH_TTL_SECONDS,
  });
  return json({ success: true, match });
}

// POST /match/move  ->  { success, match }
// The server's ONLY job here is to enforce turn order. The client computes the
// resulting game state and sends it back; the server stores it and flips turn.
async function matchMove(req, env) {
  const body = await readJson(req);
  if (!body.matchId || !body.userId) return err("matchId and userId required");

  const raw = await env.GAME_MATCHES.get(`match:${body.matchId}`);
  if (!raw) return err("Match not found", 404);

  const match = JSON.parse(raw);
  if (match.status !== "active") return err("Match is not active");

  const isP1 = match.player1.userId === body.userId;
  const isP2 = match.player2?.userId === body.userId;
  if (!isP1 && !isP2) return err("You are not in this match", 403);

  const whoseTurn = match.turn === "player1" ? match.player1.userId : match.player2?.userId;
  if (body.userId !== whoseTurn) return err("Not your turn");

  if (body.state !== undefined) match.state = body.state;
  if (typeof body.logEntry === "string") match.log.push(body.logEntry);

  if (body.winnerUserId) {
    match.status = "finished";
    match.winner = body.winnerUserId;
    match.winnerUsername =
      body.winnerUserId === match.player1.userId
        ? match.player1.username
        : match.player2?.username ?? null;
    match.log.push(`${match.winnerUsername} won!`);
  } else {
    match.turn = match.turn === "player1" ? "player2" : "player1";
  }

  match.lastMoveAt = Date.now();
  await env.GAME_MATCHES.put(`match:${body.matchId}`, JSON.stringify(match), {
    expirationTtl: MATCH_TTL_SECONDS,
  });
  return json({ success: true, match });
}

// GET /match/state?matchId=...  ->  full match object
async function matchState(url, env) {
  const matchId = url.searchParams.get("matchId");
  if (!matchId) return err("matchId required");

  const raw = await env.GAME_MATCHES.get(`match:${matchId}`);
  if (!raw) return err("Match not found", 404);
  return json(JSON.parse(raw));
}

// POST /match/forfeit  ->  { success, match }
async function matchForfeit(req, env) {
  const body = await readJson(req);
  if (!body.matchId || !body.userId) return err("matchId and userId required");

  const raw = await env.GAME_MATCHES.get(`match:${body.matchId}`);
  if (!raw) return err("Match not found", 404);

  const match = JSON.parse(raw);
  if (match.status === "finished") return json({ success: true, match });

  const isP1 = match.player1.userId === body.userId;
  const winnerPlayer = isP1 ? match.player2 : match.player1;

  match.status = "finished";
  match.winner = winnerPlayer?.userId ?? null;
  match.winnerUsername = winnerPlayer?.username ?? null;
  match.log.push(`A player forfeited. ${match.winnerUsername ?? "Opponent"} wins.`);
  match.lastMoveAt = Date.now();

  await env.GAME_MATCHES.put(`match:${body.matchId}`, JSON.stringify(match), {
    expirationTtl: MATCH_TTL_SECONDS,
  });
  return json({ success: true, match });
}

// ===========================================================================
// Router
// ===========================================================================
export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(req.url);
    const path = url.pathname;
    const post = req.method === "POST";

    try {
      if (path === "/register" && post) return await register(req, env);
      if (path === "/user" && !post) return await getUser(url, env);
      if (path === "/score" && post) return await submitScore(req, env);
      if (path === "/leaderboard" && !post) return await leaderboard(env);
      if (path === "/friend/add" && post) return await addFriend(req, env);
      if (path === "/friend/list" && !post) return await friendList(url, env);
      if (path === "/match/create" && post) return await matchCreate(req, env);
      if (path === "/match/join" && post) return await matchJoin(req, env);
      if (path === "/match/move" && post) return await matchMove(req, env);
      if (path === "/match/state" && !post) return await matchState(url, env);
      if (path === "/match/forfeit" && post) return await matchForfeit(req, env);

      return err("Not found", 404);
    } catch (e) {
      return err("Server error: " + (e?.message ?? "unknown"), 500);
    }
  },
};
