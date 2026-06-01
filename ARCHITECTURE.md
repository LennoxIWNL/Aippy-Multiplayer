# Architecture

### How the multiplayer backend is designed — and why

This explains the design behind the template so you can adapt it confidently to
your own game instead of treating it as a black box.

---

## Overview

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
[Cloudflare Worker]  (worker.ts)
     |
     | KV reads and writes
     v
[Cloudflare KV Namespaces]
  GAME_USERS        - player profiles, scores, stats, friends
  GAME_LEADERBOARD  - cached top-N leaderboard
  GAME_MATCHES      - active match states (TTL'd)
```

> The `GAME_` prefix is just a convention. Name your namespaces whatever you
> like — but the names you choose must match the binding names in `worker.ts`
> (see SETUP.md).

---

## The Four Design Principles

### 1. No traditional server

A classic backend needs a VPS, a database server, auth, SSL, and ongoing
maintenance. A Worker needs none of that — you deploy one file and Cloudflare
runs it globally. This is what makes a backend realistic for a solo Aippy creator.

### 2. No sign-up — UUID as identity

On first launch the game calls `/register` and gets back a UUID. That UUID is
stored in Aippy game state and sent with every future request. Players never
create an account; there is no password. **The UUID *is* the identity.**

This matters because friction kills casual multiplayer. If someone must sign up
before they can play, most won't. The trade-off: if a player loses their game
state, they lose their identity — so for important profiles, consider showing
the UUID somewhere the player can copy it as a backup.

### 3. KV as a game database

KV stores data as key/value pairs. It's simpler than a relational database and
maps naturally onto game state:

- One key per player: `user:UUID` → player object as JSON
- One key for the leaderboard: `global` → sorted array as JSON
- One key per match: `match:CODE` → match state as JSON

Reading and writing JSON objects covers everything a typical game needs. KV is
eventually consistent and optimized for read-heavy workloads — a perfect fit for
"write occasionally, read often" game data.

### 4. Async polling instead of real-time

Real-time multiplayer needs WebSockets or similar persistent connections, which
**Aippy does not support**. Async, poll-based multiplayer sidesteps this
entirely: each player acts, the state is saved, and the other client polls for
updates on a timer. This is exactly how Chess.com and Words With Friends work,
and it scales to any number of players with zero connection management.

See [MULTIPLAYER.md](MULTIPLAYER.md) for the polling strategy in depth.

---

## The Trust Model: "Client Computes, Server Stores"

This is the most important architectural decision to understand before adapting
the template.

Your game's rules live in your **client** (the Aippy game). The Worker does
**not** re-implement them. When a player takes a turn, the client computes the
resulting game state and sends that state to the server. The server stores it
and flips the turn.

The server enforces only the rules that *must* be authoritative to keep
multiplayer coherent:

- **Whose turn it is.** A move is rejected unless it's the sender's turn.
- **Match status.** You can't move in a finished or not-yet-started match.
- **Score direction.** A submitted score can only ever rise, never fall.
- **Identity boundaries.** You can't join your own match or friend yourself.

**Why not put all the rules on the server?** Re-implementing your entire game
engine inside the Worker would roughly double your work and keep two
implementations in sync forever. For casual, community-driven Aippy games, the
trade-off isn't worth it. The server guarantees *structural* fairness (turn
order, can't-decrease score) while trusting the client for *content* (what a
move actually does).

**What this does NOT protect against:** a determined cheater editing requests
could submit a fabricated high score or a bogus winning state. That's acceptable
for a fun leaderboard. If you need more, see "Hardening" below.

---

## Data Models

The template keeps `stats` (on players) and `state`/`data` (on matches) as
**open-ended JSON objects**, so you never have to edit `worker.ts` to store
game-specific fields. Put whatever your game needs in them.

### Player object

```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "username": "PlayerAB12C",
  "score": 15400,
  "stats": {
    "wins": 12,
    "losses": 3,
    "levelsCleared": 8,
    "itemsCollected": 47
  },
  "friends": ["other-uuid-1", "other-uuid-2"],
  "createdAt": 1716134400000,
  "lastSeen": 1716220800000
}
```

`score` is the single number used for ranking. `stats` is your free-form bag of
everything else — name the keys to fit your game.

### Leaderboard cache

```json
[
  { "userId": "uuid-1", "username": "TopPlayer", "score": 98000 },
  { "userId": "uuid-2", "username": "Runner-Up", "score": 87500 }
]
```

A sorted array of the top N players (default 50). Rebuilt on every score
submission so reads are a single fast lookup.

### Match state object

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

- `data` (per player) — what each player brings to the match: a deck, a team, a
  chosen color, a loadout. Set once at create/join.
- `state` — the live, shared game state, owned and updated by the client every
  turn. Put your board, hands, HP, scores, whatever here.
- `turn` — `"player1"` or `"player2"`; the server enforces it.
- `log` — human-readable history you can render as a feed.

---

## Request Flow Examples

These are illustrations — your game decides *when* to call each endpoint.

### A player improves their score

1. Client computes the new score locally.
2. Client calls `POST /score` with `userId` and the new score.
3. Worker reads the player, keeps the score only if it's higher, saves it.
4. Worker rebuilds the leaderboard cache.
5. Worker returns success; the client shows the updated score.

### Two players play an async match

1. Player A calls `POST /match/create` with their starting `data`/`state`.
2. Worker creates the match in KV, returns a code like `AB12CD34`.
3. Player A shares the code with Player B (Discord, chat, anywhere).
4. Player B calls `POST /match/join` with the code and their `data`.
5. Worker sets the match to `active`.
6. Both clients poll `GET /match/state?matchId=AB12CD34` on a timer.
7. On their turn, a client computes the new `state` and calls `POST /match/move`.
8. When a client decides the match is over, it sends `winnerUserId`; the Worker
   marks the match `finished`.

---

## Hardening (Optional)

The default model trusts the client. If your game needs more integrity, you can
extend `worker.ts` without changing the overall architecture:

- **Validate move bounds server-side.** Since each player's `data` is stored in
  the match, the Worker can sanity-check a submitted `state` against it (e.g.
  reject implausible score jumps).
- **Rate-limit score submissions** per `userId` to blunt scripted spam.
- **Add a lightweight shared secret** (a header the client sends) to discourage
  casual direct-API poking. Note this is obfuscation, not real auth.
- **Validate the winner.** Require the server to derive `winner` from `state`
  rather than trusting a client-supplied `winnerUserId`.

Each of these trades simplicity for integrity. Add only what your game warrants.
