# Adding Multiplayer to Aippy Games

### A complete, copy-paste tutorial for any Aippy creator — all on one page

This is a **template and tutorial** for adding a real, persistent multiplayer
backend to any game built on [Aippy](https://aippy.ai) — the mobile AI
game-creation platform.

It doesn't assume your game is any particular genre. Card game, idle clicker,
word game, RPG, board game — the same backend pattern works. You wire it up once
and pick whichever multiplayer features your game needs.

> This whole template — the backend, the architecture, and this guide — was made
> by **Lennox** (@Lennox on Aippy), built and proven in production on
> *Pocket Pack Opener* and shared so anyone can reuse it. Wherever this guide
> shows an example, treat it as *one* way to use the backend — not the only way.

---

## Table of Contents

1. [The Core Principle](#1-the-core-principle)
2. [What You Can Build](#2-what-you-can-build)
3. [Why This Stack](#3-why-this-stack)
4. [Architecture](#4-architecture)
5. [Setup Guide](#5-setup-guide)
6. [The Worker Code](#6-the-worker-code)
7. [API Reference](#7-api-reference)
8. [Multiplayer Patterns](#8-multiplayer-patterns)
9. [Integrating With Your Aippy Game](#9-integrating-with-your-aippy-game)
10. [Copy-Paste Client Code](#10-copy-paste-client-code)
11. [Credits & Contributing](#11-credits--contributing)

---

## 1. The Core Principle

Aippy games run in a React/TypeScript environment and can make standard
`fetch()` calls. That single capability is enough to give your game a real
backend. The principle is:

> **Put a tiny serverless API in front of a key-value store, give every player
> an anonymous ID, and have clients poll for updates instead of holding a live
> connection.**

That's it. No game servers to run, no databases to administer, no login screens.
This repo implements that principle with **Cloudflare Workers** + **Cloudflare
KV**, and ships a single ready-to-deploy `worker.js` (also reproduced inline in
[section 6](#6-the-worker-code) so you never have to leave this page).

[↑ Back to top](#table-of-contents)

---

## 2. What You Can Build

The included backend is a toolkit of multiplayer building blocks. Use any subset:

- **Anonymous player accounts** — a UUID per player, no sign-up, no passwords.
- **Cloud save / cross-device profiles** — store each player's score and stats.
- **Global leaderboards** — a top-N board, sorted and cached for fast reads.
- **Friend lists** — add friends by code and compare scores.
- **Async turn-based matches** — chess.com-style play for any turn game: cards,
  words, board games, RPG duels, tic-tac-toe, and more.

These are composable. A trivia game might only want a leaderboard. A strategy
game might want matches + friends. Take what you need.

[↑ Back to top](#table-of-contents)

---

## 3. Why This Stack

- **Free tier is generous** — 100,000 Worker requests/day, plenty for an Aippy game.
- **Deploys in seconds** — paste one file into the dashboard and click Deploy.
- **KV is dead-simple** — key/value JSON storage that maps cleanly to game state.
- **Nothing to maintain** — no server, no patching, no scaling config.
- **Global edge** — fast responses anywhere in the world.
- **`fetch()` from Aippy just works** — CORS is handled for you.

Cloudflare is what this template uses, but the *principle* is portable. Any
serverless function + key-value store (Vercel + Upstash, Deno Deploy + KV, etc.)
works with the same client code.

[↑ Back to top](#table-of-contents)

---

## 4. Architecture

### Overview

The system has two parts:

1. **A Cloudflare Worker** — a serverless function that receives HTTP requests
   and handles all backend logic.
2. **Cloudflare KV** — a key-value database that stores all persistent data.

Your Aippy game talks to the Worker using `fetch()`. The Worker reads and writes
KV. That is the entire system.

```
[Aippy Game (React/TS)]
     |
     | fetch() HTTP requests
     v
[Cloudflare Worker]  (worker.js)
     |
     | KV reads and writes
     v
[Cloudflare KV Namespaces]
  GAME_USERS        - player profiles, scores, stats, friends
  GAME_LEADERBOARD  - cached top-N leaderboard
  GAME_MATCHES      - active match states (TTL'd)
```

> The `GAME_` prefix is just a convention. Name your namespaces whatever you
> like — but the names you choose must match the binding names in `worker.js`
> (see the [Setup Guide](#5-setup-guide)).

### The Four Design Principles

**1. No traditional server.** A classic backend needs a VPS, a database server,
auth, SSL, and ongoing maintenance. A Worker needs none of that — you deploy one
file and Cloudflare runs it globally. This is what makes a backend realistic for
a solo Aippy creator.

**2. No sign-up — UUID as identity.** On first launch the game calls `/register`
and gets back a UUID. That UUID is stored in Aippy game state and sent with every
future request. Players never create an account; there is no password. **The UUID
*is* the identity.** This matters because friction kills casual multiplayer. The
trade-off: if a player loses their game state, they lose their identity — so for
important profiles, consider showing the UUID somewhere the player can copy as a
backup.

**3. KV as a game database.** KV stores data as key/value pairs. It's simpler than
a relational database and maps naturally onto game state:

- One key per player: `user:UUID` → player object as JSON
- One key for the leaderboard: `global` → sorted array as JSON
- One key per match: `match:CODE` → match state as JSON

**4. Async polling instead of real-time.** Real-time multiplayer needs WebSockets
or similar persistent connections, which **Aippy does not support**. Async,
poll-based multiplayer sidesteps this: each player acts, the state is saved, and
the other client polls for updates on a timer. This is exactly how Chess.com
works, and it scales to any number of players with zero connection management.
See [Multiplayer Patterns](#8-multiplayer-patterns) for the polling strategy.

### The Trust Model: "Client Computes, Server Stores"

This is the most important decision to understand before adapting the template.

Your game's rules live in your **client** (the Aippy game). The Worker does
**not** re-implement them. When a player takes a turn, the client computes the
resulting game state and sends that state to the server. The server stores it and
flips the turn.

The server enforces only the rules that *must* be authoritative:

- **Whose turn it is.** A move is rejected unless it's the sender's turn.
- **Match status.** You can't move in a finished or not-yet-started match.
- **Score direction.** A submitted score can only ever rise, never fall.
- **Identity boundaries.** You can't join your own match or friend yourself.

**Why not put all the rules on the server?** Re-implementing your entire game
engine inside the Worker would roughly double your work and keep two
implementations in sync forever. For casual, community-driven Aippy games, the
trade-off isn't worth it. The server guarantees *structural* fairness; the client
owns *content* (what a move actually does).

**What this does NOT protect against:** a determined cheater editing requests
could submit a fabricated high score or a bogus winning state. That's acceptable
for a fun leaderboard. If you need more, see [Hardening](#hardening-optional).

### Data Models

The template keeps `stats` (on players) and `state`/`data` (on matches) as
**open-ended JSON objects**, so you never have to edit `worker.js` to store
game-specific fields.

**Player object**
```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "username": "PlayerAB12C",
  "score": 15400,
  "stats": { "wins": 12, "losses": 3, "levelsCleared": 8 },
  "friends": ["other-uuid-1", "other-uuid-2"],
  "createdAt": 1716134400000,
  "lastSeen": 1716220800000
}
```
`score` is the single number used for ranking. `stats` is your free-form bag of
everything else — name the keys to fit your game.

**Match state object**
```json
{
  "matchId": "AB12CD34",
  "player1": { "userId": "...", "username": "Alice", "data": { } },
  "player2": { "userId": "...", "username": "Bob",   "data": { } },
  "status": "active",
  "turn": "player1",
  "state": { },
  "log": ["Bob joined. Alice goes first.", "Alice played a card."],
  "winner": null,
  "winnerUsername": null,
  "createdAt": 1716134400000,
  "lastMoveAt": 1716134500000
}
```
- `data` (per player) — what each player brings: a deck, a team, a color. Set once.
- `state` — the live shared game state, owned and updated by the client each turn.
- `turn` — `"player1"` or `"player2"`; the server enforces it.
- `log` — human-readable history you can render as a feed.

### Hardening (Optional)

The default model trusts the client. If your game needs more integrity, extend
`worker.js` without changing the overall architecture:

- **Validate move bounds server-side** against each player's stored `data`.
- **Rate-limit score submissions** per `userId` to blunt scripted spam.
- **Add a lightweight shared secret** header (obfuscation, not real auth).
- **Validate the winner** by deriving it from `state` rather than trusting the
  client-supplied `winnerUserId`.

Add only what your game warrants.

[↑ Back to top](#table-of-contents)

---

## 5. Setup Guide

Deploying `worker.js` to Cloudflare takes about 10 minutes and needs no coding
beyond copy-paste.

> **Naming:** the template uses KV binding names `GAME_USERS`,
> `GAME_LEADERBOARD`, `GAME_MATCHES`, and an example Worker name `your-game-api`.
> Rename any of these — just keep the KV **binding names** in sync with the names
> referenced in `worker.js`.

**What you need:** a free [Cloudflare account](https://dash.cloudflare.com), the
`worker.js` file from this repo, ~10 minutes.

**Step 1 — Create a Cloudflare account.** Sign up free at
[dash.cloudflare.com](https://dash.cloudflare.com). No credit card. The free tier
gives 100,000 Worker requests/day.

**Step 2 — Create the KV namespaces.** In the dashboard: **Workers & Pages → KV →
Create a namespace**. Create three, named exactly `GAME_USERS`,
`GAME_LEADERBOARD`, and `GAME_MATCHES`.

**Step 3 — Create the Worker.** **Workers & Pages → Create application → Create a
Worker**. Name it e.g. `your-game-api` (your URL becomes
`your-game-api.YOUR-SUBDOMAIN.workers.dev` — copy it). Click **Deploy** to ship
the placeholder.

**Step 4 — Add the Worker code.** Click **Edit code**, select-all and delete the
placeholder, paste the entire contents of `worker.js` (see
[section 6](#6-the-worker-code)), then **Deploy**. If you see a syntax error,
make sure the file tab shows `worker.js`, not `worker.ts`.

**Step 5 — Bind the KV namespaces.** On the Worker page: **Settings → Variables
(or Bindings) → KV Namespace Bindings → Add binding**. Add three, mapping each
variable name to its namespace:

| Variable name | KV namespace |
|---|---|
| `GAME_USERS` | `GAME_USERS` |
| `GAME_LEADERBOARD` | `GAME_LEADERBOARD` |
| `GAME_MATCHES` | `GAME_MATCHES` |

The **variable name** (left) is what the code reads — it must match exactly.
Click **Save and deploy**.

**Step 6 — Test it.** Visit
`https://your-game-api.YOUR-SUBDOMAIN.workers.dev/leaderboard`. You should see
`{"leaderboard":[]}`. An empty array means the Worker is live and KV is connected.

**Step 7 — Grab your URL.** Your base URL
`https://your-game-api.YOUR-SUBDOMAIN.workers.dev` is the `API` constant you'll
paste into Aippy (see [section 9](#9-integrating-with-your-aippy-game)).

**Common issues**

- *Syntax error on deploy* — file tab must show `worker.js`, not `.js`.
- *KV binding errors* — binding variable names must be exactly `GAME_USERS`,
  `GAME_LEADERBOARD`, `GAME_MATCHES` (or whatever you renamed in the code).
- *CORS errors* — the Worker sends permissive CORS on every response; confirm the
  latest code actually deployed.
- *404 on every route* — make sure you deployed after pasting; a known route like
  `/leaderboard` should work.

**Going further** — attach a custom domain via the Worker's **Triggers**; develop
locally with `wrangler dev` against a `wrangler.toml` declaring the same KV
bindings; tune the `LEADERBOARD_SIZE` and `MATCH_TTL_SECONDS` constants at the top
of `worker.js`.

[↑ Back to top](#table-of-contents)

---

## 6. The Worker Code

This is the complete, game-agnostic backend. It's also saved as `worker.js` in
this repo for easy copying — but it's reproduced here so you can read the whole
thing without leaving the page. Paste it into the Cloudflare editor in
[Setup Step 4](#5-setup-guide).

```javascript
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

export interface Env {
  GAME_USERS: KVNamespace;
  GAME_LEADERBOARD: KVNamespace;
  GAME_MATCHES: KVNamespace;
}

// ---------------------------------------------------------------------------
// Config — tweak these to taste, they are the only "knobs" in the file.
// ---------------------------------------------------------------------------
const LEADERBOARD_SIZE = 50;            // how many players the global board keeps
const MATCH_TTL_SECONDS = 60 * 60 * 24; // matches auto-delete after 24h of inactivity

// ---------------------------------------------------------------------------
// CORS — Aippy calls this Worker from the browser, so every response needs
// permissive CORS headers. Allowing all origins is fine for a public game API.
// ---------------------------------------------------------------------------
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function err(message: string, status = 400): Response {
  return json({ success: false, error: message }, status);
}

// ---------------------------------------------------------------------------
// Data shapes. `stats` and match `state` are deliberately open-ended objects
// so any game can store whatever it needs without changing this file.
// ---------------------------------------------------------------------------
interface Player {
  userId: string;
  username: string;
  score: number;
  stats: Record<string, number>; // e.g. { wins: 3, losses: 1, levelsCleared: 8 }
  friends: string[];
  createdAt: number;
  lastSeen: number;
}

interface LeaderboardEntry {
  userId: string;
  username: string;
  score: number;
}

interface MatchPlayer {
  userId: string;
  username: string;
  data: unknown; // whatever each player brings to the match (a deck, a team, a color)
}

interface Match {
  matchId: string;
  player1: MatchPlayer;
  player2: MatchPlayer | null;
  status: "waiting" | "active" | "finished";
  turn: "player1" | "player2";
  state: unknown;               // arbitrary game state, owned by the client
  log: string[];                // human-readable history
  winner: string | null;        // userId of winner
  winnerUsername: string | null;
  createdAt: number;
  lastMoveAt: number;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function randomName(): string {
  return "Player" + Math.random().toString(36).slice(2, 7).toUpperCase();
}

function matchCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let code = "";
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function readJson(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Leaderboard cache: recomputed whenever a score is submitted so reads are
// a single fast KV get. For large games you'd page this; for an Aippy game a
// single top-N array is plenty.
// ---------------------------------------------------------------------------
async function rebuildLeaderboard(env: Env, player: Player): Promise<void> {
  const raw = await env.GAME_LEADERBOARD.get("global");
  let board: LeaderboardEntry[] = raw ? JSON.parse(raw) : [];

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
async function register(req: Request, env: Env): Promise<Response> {
  const body = await readJson(req);
  const userId = crypto.randomUUID();
  const username = (body.username && String(body.username).slice(0, 24)) || randomName();

  const player: Player = {
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
async function getUser(url: URL, env: Env): Promise<Response> {
  const userId = url.searchParams.get("userId");
  if (!userId) return err("userId required");

  const raw = await env.GAME_USERS.get(`user:${userId}`);
  if (!raw) return err("User not found", 404);
  return json(JSON.parse(raw));
}

// POST /score  ->  { success, score }
// Body: { userId, score, stats?: {...}, username? }
// Score is clamped so it can only ever rise. stats are shallow-merged.
async function submitScore(req: Request, env: Env): Promise<Response> {
  const body = await readJson(req);
  if (!body.userId) return err("userId required");

  const raw = await env.GAME_USERS.get(`user:${body.userId}`);
  if (!raw) return err("User not found", 404);

  const player: Player = JSON.parse(raw);

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
async function leaderboard(env: Env): Promise<Response> {
  const raw = await env.GAME_LEADERBOARD.get("global");
  return json({ leaderboard: raw ? JSON.parse(raw) : [] });
}

// POST /friend/add  ->  { success, friendUsername }
async function addFriend(req: Request, env: Env): Promise<Response> {
  const body = await readJson(req);
  if (!body.userId || !body.friendId) return err("userId and friendId required");
  if (body.userId === body.friendId) return err("You cannot add yourself");

  const meRaw = await env.GAME_USERS.get(`user:${body.userId}`);
  if (!meRaw) return err("User not found", 404);

  const friendRaw = await env.GAME_USERS.get(`user:${body.friendId}`);
  if (!friendRaw) return err("Friend ID not found - check the code and try again", 404);

  const me: Player = JSON.parse(meRaw);
  const friend: Player = JSON.parse(friendRaw);

  if (!me.friends.includes(friend.userId)) {
    me.friends.push(friend.userId);
    await env.GAME_USERS.put(`user:${me.userId}`, JSON.stringify(me));
  }

  return json({ success: true, friendUsername: friend.username });
}

// GET /friend/list?userId=...  ->  { friends: [...] } sorted by score desc
async function friendList(url: URL, env: Env): Promise<Response> {
  const userId = url.searchParams.get("userId");
  if (!userId) return err("userId required");

  const raw = await env.GAME_USERS.get(`user:${userId}`);
  if (!raw) return err("User not found", 404);

  const me: Player = JSON.parse(raw);
  const friends: any[] = [];

  for (const fid of me.friends) {
    const fRaw = await env.GAME_USERS.get(`user:${fid}`);
    if (!fRaw) continue;
    const f: Player = JSON.parse(fRaw);
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
// Body: { userId, username, data?, state? }
async function matchCreate(req: Request, env: Env): Promise<Response> {
  const body = await readJson(req);
  if (!body.userId) return err("userId required");

  const matchId = matchCode();
  const match: Match = {
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
// Body: { matchId, userId, username, data?, state? }
async function matchJoin(req: Request, env: Env): Promise<Response> {
  const body = await readJson(req);
  if (!body.matchId || !body.userId) return err("matchId and userId required");

  const raw = await env.GAME_MATCHES.get(`match:${body.matchId}`);
  if (!raw) return err("Match not found - check the code", 404);

  const match: Match = JSON.parse(raw);
  if (match.status !== "waiting") return err("This match has already started");
  if (match.player1.userId === body.userId) return err("Cannot join your own match");

  match.player2 = { userId: body.userId, username: body.username || "Player 2", data: body.data ?? null };
  match.status = "active";
  // Let the joiner seed the starting state if it wasn't set at creation.
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
// Body: { matchId, userId, state, logEntry?, winnerUserId? }
async function matchMove(req: Request, env: Env): Promise<Response> {
  const body = await readJson(req);
  if (!body.matchId || !body.userId) return err("matchId and userId required");

  const raw = await env.GAME_MATCHES.get(`match:${body.matchId}`);
  if (!raw) return err("Match not found", 404);

  const match: Match = JSON.parse(raw);
  if (match.status !== "active") return err("Match is not active");

  const isP1 = match.player1.userId === body.userId;
  const isP2 = match.player2?.userId === body.userId;
  if (!isP1 && !isP2) return err("You are not in this match", 403);

  const whoseTurn = match.turn === "player1" ? match.player1.userId : match.player2?.userId;
  if (body.userId !== whoseTurn) return err("Not your turn");

  // Trust the client's computed state (see "client computes, server stores" in
  // the README). The server only owns turn order and match status.
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
async function matchState(url: URL, env: Env): Promise<Response> {
  const matchId = url.searchParams.get("matchId");
  if (!matchId) return err("matchId required");

  const raw = await env.GAME_MATCHES.get(`match:${matchId}`);
  if (!raw) return err("Match not found", 404);
  return json(JSON.parse(raw));
}

// POST /match/forfeit  ->  { success, match }
async function matchForfeit(req: Request, env: Env): Promise<Response> {
  const body = await readJson(req);
  if (!body.matchId || !body.userId) return err("matchId and userId required");

  const raw = await env.GAME_MATCHES.get(`match:${body.matchId}`);
  if (!raw) return err("Match not found", 404);

  const match: Match = JSON.parse(raw);
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
  async fetch(req: Request, env: Env): Promise<Response> {
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
    } catch (e: any) {
      return err("Server error: " + (e?.message ?? "unknown"), 500);
    }
  },
};
```

[↑ Back to top](#table-of-contents)

---

## 7. API Reference

Base URL: `https://your-game-api.YOUR-SUBDOMAIN.workers.dev` (your Worker URL from
the [Setup Guide](#5-setup-guide)). All endpoints accept and return JSON and
include permissive CORS headers. Errors return
`{ "success": false, "error": "message" }` with a 4xx/5xx status.

### Users

**`POST /register`** → `{ success, userId, username }`
Creates a player. Call once on first launch and save `userId` permanently.
Body: `{ "username": "Alice" }` (optional, max 24 chars; random if omitted).

**`GET /user?userId=UUID`** → full player object. `404` if not found.

**`POST /score`** → `{ success, score }`
Body: `{ "userId", "score", "stats"?: {...}, "username"? }`. `score` only ever
*rises* (a lower value is ignored). `stats` is shallow-merged — send only changed
keys. The leaderboard cache rebuilds automatically. `404` if user not found.

### Leaderboard

**`GET /leaderboard`** → `{ leaderboard: [{ userId, username, score }] }`
Top N (default 50), sorted desc. Pre-computed cache; empty array if none yet.

### Friends

**`POST /friend/add`** → `{ success, friendUsername }`
Body: `{ "userId", "friendId" }`. One-directional. `404` if `friendId` unknown,
`400` if adding yourself, no-op success if already friends. Players share their
full UUID as a friend code (a UUID is unambiguous to paste).

**`GET /friend/list?userId=UUID`** →
`{ friends: [{ userId, username, score, stats, lastSeen }] }`, sorted by score
desc. `404` if user not found.

### Matches (async turn-based)

**`POST /match/create`** → `{ success, matchId }`
Body: `{ "userId", "username", "data"?, "state"? }`. `data` is what this player
brings; `state` is optional starting shared state. Returns an 8-char code.
Matches auto-expire after `MATCH_TTL_SECONDS` (default 24h) of inactivity.

**`POST /match/join`** → `{ success, match }`
Body: `{ "matchId", "userId", "username", "data"?, "state"? }`. Starts the match.
`404` if not found, `400` if already started or joining your own match.

**`POST /match/move`** → `{ success, match }`
Body: `{ "matchId", "userId", "state", "logEntry"?, "winnerUserId"? }`. Server
checks it's your turn, stores your computed `state`, appends `logEntry`, then
flips the turn — or ends the match if `winnerUserId` is set. Errors: `400 "Not
your turn"`, `400 "Match is not active"`, `403` if not a participant, `404` if
not found.

**`GET /match/state?matchId=CODE`** → full match object. Poll this (~every 10s)
and watch `lastMoveAt` to detect the opponent's move. Status is `waiting` |
`active` | `finished`. `404` if not found.

**`POST /match/forfeit`** → `{ success, match }`
Body: `{ "matchId", "userId" }`. Opponent wins; status becomes `finished`. No-op
success if already finished. `404` if not found.

[↑ Back to top](#table-of-contents)

---

## 8. Multiplayer Patterns

### Why async, not real-time

Real-time multiplayer requires a persistent connection (WebSockets/WebRTC).
**Aippy supports none of these.** Async play works differently — there is no live
connection:

1. Player 1 takes an action.
2. The new state is saved to the server.
3. Player 1's screen shows "Waiting for opponent…".
4. Player 2's client polls on a timer.
5. When the poll detects a change, Player 2 sees the update and responds.
6. Repeat until the game ends.

This is exactly how Chess.com and Words With Friends work.

**Good fits:** chess/checkers, card games, word games, board games, turn-based
RPG duels, "send a puzzle to a friend." **Poor fits:** anything needing
sub-second simultaneous input (platformers, shooters, racing) — for those, use
async leaderboards or ghost/replay competition instead.

### The match lifecycle

1. **Create** — Player 1 `POST /match/create` with their `data` and optional
   starting `state`; gets a code like `AB12CD34`, shared out-of-band.
2. **Join** — Player 2 `POST /match/join` with the code and their `data`; status
   becomes `active`; Player 1 goes first.
3. **Turns** — on your turn, compute the new `state` and `POST /match/move`. The
   server verifies it's your turn, stores the state, flips `turn`. Both clients
   poll `GET /match/state` and refresh when `lastMoveAt` changes.
4. **Resolution** — include `winnerUserId` in `/match/move` to set
   `status: "finished"`; both players detect it on the next poll.
5. **Cleanup** — matches carry a TTL (default 24h) and delete themselves.

### Polling strategy

Poll `GET /match/state` every ~10 seconds while a match is active. Fast enough
that a move appears within ~10s, slow enough not to spam the Worker (~12 req/min
for two players — trivial against 100k/day). Use `lastMoveAt` as the change
check, and stop polling on `finished` or when leaving the screen.

```typescript
useEffect(() => {
  if (!matchId || status === "finished") return;

  const poll = setInterval(async () => {
    const res = await fetch(`${API}/match/state?matchId=${matchId}`);
    const data = await res.json();

    if (data.lastMoveAt !== lastKnownMoveAt) {
      setLastKnownMoveAt(data.lastMoveAt);
      setMatchState(data);
      if (data.status === "finished") handleMatchEnd(data);
    }
  }, 10000);

  return () => clearInterval(poll);
}, [matchId, status, lastKnownMoveAt]);
```

### Designing your `state`

`state` is whatever your game needs — it just must be JSON-serializable, and one
poll must reconstruct the full picture:

```jsonc
// Tic-tac-toe
{ "board": ["X", null, "O", null, "X", null, null, null, null] }

// A card game
{ "p1Hand": [], "p2Hand": [], "discard": [], "p1Score": 12, "p2Score": 9 }

// A turn-based RPG duel
{ "p1HP": 240, "p2HP": 180, "p1Active": 0, "p2Active": 1, "effects": [] }
```

Read it in your UI by deriving everything from one poll:

```typescript
const isPlayer1 = match.player1.userId === myUserId;
const isMyTurn  = isPlayer1 ? match.turn === "player1" : match.turn === "player2";
const opponent  = isPlayer1 ? match.player2 : match.player1;
```

### Edge cases the server handles

- Joining your own match → `400 "Cannot join your own match"`
- Moving in a finished/waiting match → `400 "Match is not active"`
- Moving out of turn → `400 "Not your turn"`
- Acting in a match you're not in → `403`
- Unknown match code → `404 "Match not found - check the code"`
- A match left waiting → auto-expires via KV TTL

### Other patterns on the same backend

- **Async competition (leaderboards)** — everyone plays solo, submits a `score`,
  competes globally or with friends. No match objects needed. Great for arcade,
  puzzle, idle games.
- **Social / friends layer** — add friends by code, compare scores/stats. Works
  standalone or layered onto anything.
- **Cloud save & cross-device profiles** — the UUID-keyed profile doubles as
  cloud save; surface the UUID so players can restore on a new device.
- **Shared persistent world (advanced)** — treat a KV key as a shared object many
  players read/append to (guestbook, co-op build, global goal bar). KV is
  eventually consistent, so it suits append-style / last-writer-wins rather than
  strict simultaneous editing.

[↑ Back to top](#table-of-contents)

---

## 9. Integrating With Your Aippy Game

Aippy runs React/TypeScript where `fetch()` works fully. Keep these constraints
in mind: **no `localStorage`/`sessionStorage`** (persist via game state or your
backend), **no WebSockets** (use polling), and **game state persists** between
sessions (store `userId` there).

**Step 1 — Store your API URL.**
```typescript
const API = "https://your-game-api.YOUR-SUBDOMAIN.workers.dev";
```

**Step 2 — Register once on first launch and save the `userId` forever.**
```typescript
useEffect(() => { if (!gameState.userId) registerPlayer(); }, []);

async function registerPlayer() {
  try {
    const res = await fetch(`${API}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: gameState.playerName || undefined }),
    });
    const data = await res.json();
    if (data.success) {
      setGameState(prev => ({ ...prev, userId: data.userId, username: data.username }));
    }
  } catch (err) {
    // No internet — game still works; registration retries next session.
    console.error("Registration failed:", err);
  }
}
```

**Step 3 — Submit score after any score-changing event (in the background).**
```typescript
async function submitScore() {
  if (!gameState.userId) return;
  try {
    await fetch(`${API}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: gameState.userId,
        score: gameState.score,
        stats: { wins: gameState.wins, losses: gameState.losses, levelsCleared: gameState.levelsCleared },
      }),
    });
  } catch (err) { console.error("Score submit failed:", err); }
}
```
Don't `await` this in the UI flow — fire it so it never slows the game.

**Step 4 — Leaderboard / friends.** Call `GET /leaderboard` (highlight the row
where `userId === gameState.userId`), `POST /friend/add` with the friend's full
UUID, and `GET /friend/list?userId=...` for a friends board.

**Steps 5–8 — Matches.** Create with `POST /match/create` (show the returned code
to share), join with `POST /match/join`, poll `GET /match/state` on a 10s
`setInterval`, and take turns with `POST /match/move` (send the client-computed
`state`, plus `winnerUserId` when the game ends). Disable move controls when it
isn't the player's turn and show "Waiting for [opponent]…". Full working code is
in [section 10](#10-copy-paste-client-code).

**Prompting Aippy** — be explicit: give the full API URL; name the game-state
fields to read/write; require `setInterval` (not `setTimeout`) for polling;
require every `fetch` wrapped in try/catch that never crashes the game; require
`userId` saved on registration and **never** regenerated; require move buttons
enabled only on the player's turn.

[↑ Back to top](#table-of-contents)

---

## 10. Copy-Paste Client Code

### Full API helper module

```typescript
// ================================================================
// api.ts - Cloudflare Worker API helper for Aippy multiplayer
// ================================================================

const API = "https://your-game-api.YOUR-SUBDOMAIN.workers.dev";

// ---- Users ----
export async function registerPlayer(username?: string) {
  const res = await fetch(`${API}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  return res.json(); // { success, userId, username }
}

export async function getPlayer(userId: string) {
  const res = await fetch(`${API}/user?userId=${userId}`);
  return res.json();
}

// `stats` is free-form: pass whatever counters your game tracks.
export async function submitScore(userId: string, score: number, stats?: Record<string, number>) {
  const res = await fetch(`${API}/score`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, score, stats }),
  });
  return res.json(); // { success, score }
}

// ---- Leaderboard ----
export async function getLeaderboard() {
  const res = await fetch(`${API}/leaderboard`);
  return res.json(); // { leaderboard: [{ userId, username, score }] }
}

// ---- Friends ----
export async function addFriend(userId: string, friendId: string) {
  const res = await fetch(`${API}/friend/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, friendId }),
  });
  return res.json(); // { success, friendUsername } or { error }
}

export async function getFriendList(userId: string) {
  const res = await fetch(`${API}/friend/list?userId=${userId}`);
  return res.json(); // { friends: [...] }
}

// ---- Matches ----
export async function createMatch(userId: string, username: string, data?: unknown, state?: unknown) {
  const res = await fetch(`${API}/match/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, username, data, state }),
  });
  return res.json(); // { success, matchId }
}

export async function joinMatch(matchId: string, userId: string, username: string, data?: unknown) {
  const res = await fetch(`${API}/match/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ matchId, userId, username, data }),
  });
  return res.json(); // { success, match }
}

// Submit a turn. Pass the new shared state your client computed.
// Include winnerUserId to end the match.
export async function submitTurn(
  matchId: string, userId: string, state: unknown, logEntry?: string, winnerUserId?: string,
) {
  const res = await fetch(`${API}/match/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ matchId, userId, state, logEntry, winnerUserId }),
  });
  return res.json(); // { success, match } or { error: "Not your turn" }
}

export async function getMatchState(matchId: string) {
  const res = await fetch(`${API}/match/state?matchId=${matchId}`);
  return res.json();
}

export async function forfeitMatch(matchId: string, userId: string) {
  const res = await fetch(`${API}/match/forfeit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ matchId, userId }),
  });
  return res.json();
}
```

### Leaderboard component pattern

```typescript
function LeaderboardScreen() {
  const [board, setBoard] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getLeaderboard()
      .then(data => setBoard(data.leaderboard))
      .catch(() => setBoard([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner />;

  return (
    <div>
      {board.map((entry, i) => (
        <div key={entry.userId}
             style={{ background: entry.userId === gameState.userId ? "#ffd700" : "white" }}>
          #{i + 1} {entry.username} — {entry.score.toLocaleString()} pts
        </div>
      ))}
    </div>
  );
}
```

### Match screen turn logic

Genre-agnostic scaffolding — swap `<YourGameBoard />` and your rules; the
turn/polling plumbing stays the same.

```typescript
function MatchScreen({ matchId, userId }) {
  const [match, setMatch] = useState(null);
  const pollRef = useRef(null);

  const isPlayer1 = match?.player1?.userId === userId;
  const isMyTurn = match ? (isPlayer1 ? match.turn === "player1" : match.turn === "player2") : false;
  const opponent = match ? (isPlayer1 ? match.player2 : match.player1) : null;

  useEffect(() => {
    getMatchState(matchId).then(setMatch);
    pollRef.current = setInterval(async () => {
      const updated = await getMatchState(matchId);
      setMatch(prev => (updated.lastMoveAt !== prev?.lastMoveAt ? updated : prev));
      if (updated.status === "finished") clearInterval(pollRef.current);
    }, 10000);
    return () => clearInterval(pollRef.current);
  }, [matchId]);

  // Compute the next shared state with YOUR game rules, then submit it.
  async function takeTurn(action) {
    const nextState = applyMyGameRules(match.state, action, isPlayer1);
    const winnerUserId = checkForWinner(nextState, match);
    const result = await submitTurn(matchId, userId, nextState, describeAction(action), winnerUserId);
    if (result.success) setMatch(result.match);
    else showNotification(result.error); // e.g. "Not your turn"
  }

  if (!match) return <LoadingSpinner />;

  return (
    <div>
      <YourGameBoard state={match.state} youArePlayer1={isPlayer1} />
      {isMyTurn
        ? <YourGameControls onAction={takeTurn} />
        : <WaitingMessage opponent={opponent?.username} />}
      <MatchLog entries={match.log} />
    </div>
  );
}
```

### Designing your score formula

The backend stores a single `score` number for ranking — *you* decide what it
means. Compute it client-side, then submit:

```typescript
// A collection/progression game
function computeScore(state) {
  let score = 0;
  score += state.itemsCollected * 10;
  score += state.levelsCleared  * 500;
  score += state.bossesBeaten   * 2000;
  score += state.pvpWins        * 50;
  return score;
}
// An arcade/high-score game: just your single best run
// function computeScore(state) { return state.bestRunPoints; }

submitScore(gameState.userId, computeScore(gameState), {
  wins: gameState.wins, levelsCleared: gameState.levelsCleared,
});
```

`/score` only ever *raises* the stored value, so it's safe to call liberally.

### Aippy prompt template

```
Add a Cloudflare Worker backend to my game using these exact fetch() calls.
The API base URL is: https://your-game-api.YOUR-SUBDOMAIN.workers.dev

On first launch, if gameState.userId is null/undefined, call POST /register with
the player name and save the returned userId to game state permanently. Never
call /register again after the first time.

After every score-changing event, call POST /score with the current userId, the
new score, and a stats object of my game's counters. Do this in the background
with try/catch. Never block the UI for it.

On the leaderboard screen, call GET /leaderboard and render the array. Highlight
the current player's row if their userId matches.

Add async multiplayer to the match menu:
- "Create Match" calls POST /match/create and shows a code to share.
- "Join Match" asks for a code and calls POST /match/join.
- Once active, both players see the match screen.
- Poll GET /match/state every 10 seconds with setInterval; stop when status is
  "finished".
- On my turn, compute the new game state with the game's own rules and call
  POST /match/move with that state (and winnerUserId when the game ends).
- Disable move controls when it isn't my turn; show "Waiting for [opponent]...".

Every fetch must be wrapped in try/catch and must never crash the game on a
network error — just show a notification. Increment the version number.
```

[↑ Back to top](#table-of-contents)

---

## 11. Credits & Contributing

Everything here — the backend, the architecture, and this guide — was made by
**Lennox** (@Lennox on Aippy), built and proven in production on *Pocket Pack
Opener* and shared as a reusable template.

If this helped you ship multiplayer, share what you built in the Aippy Discord!

[↑ Back to top](#table-of-contents)
