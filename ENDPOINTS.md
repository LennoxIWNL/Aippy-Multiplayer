# API Endpoints Reference

### Complete documentation for every Worker route

This documents the API exposed by `worker.ts`. All endpoints accept and return
JSON, and all responses include permissive CORS headers so they work from
Aippy's `fetch()` environment.

---

## Base URL

```
https://your-game-api.YOUR-SUBDOMAIN.workers.dev
```

Replace with your actual Worker URL from SETUP.md.

**Conventions**
- Open-ended fields: `stats` (on players) and `data` / `state` (on matches) are
  arbitrary JSON. Store whatever your game needs in them.
- Errors return `{ "success": false, "error": "message" }` with a 4xx/5xx status.

---

## Users

### POST /register

Creates a new player account. Call once on first launch and save the returned
`userId` to Aippy game state permanently.

**Request body:**
```json
{ "username": "Alice" }
```
`username` is optional (max 24 chars). If omitted, a random name like
`PlayerAB12C` is generated.

**Response:**
```json
{
  "success": true,
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "username": "Alice"
}
```

**Notes**
- Store `userId` immediately — it's the player's permanent identity with no
  recovery if lost. Consider letting players copy it as a backup.
- The UUID comes from Cloudflare's `crypto.randomUUID()`.

---

### GET /user?userId=UUID

Retrieves a player's full profile.

**Response:**
```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "username": "Alice",
  "score": 15400,
  "stats": { "wins": 12, "losses": 3, "levelsCleared": 8 },
  "friends": ["other-uuid-1"],
  "createdAt": 1716134400000,
  "lastSeen": 1716220800000
}
```

**Errors:** `404` if `userId` not found.

---

### POST /score

Updates a player's score and stats. Call after any score-changing event.

**Request body:**
```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "score": 16000,
  "stats": { "wins": 13, "levelsCleared": 9 },
  "username": "Alice"
}
```

- `score` — the single ranking number. **Only ever rises**: a lower value is
  ignored and the higher saved value is kept.
- `stats` — optional, shallow-merged into existing stats. Send only the keys
  that changed.
- `username` — optional; lets players rename without re-registering.

**Response:**
```json
{ "success": true, "score": 16000 }
```

**Notes**
- The leaderboard cache is rebuilt automatically on every submission.

**Errors:** `404` if `userId` not found.

---

## Leaderboard

### GET /leaderboard

Returns the top N players globally (default 50), sorted by score descending.

**Response:**
```json
{
  "leaderboard": [
    { "userId": "uuid-1", "username": "TopPlayer", "score": 98000 },
    { "userId": "uuid-2", "username": "Runner-Up", "score": 87500 }
  ]
}
```

**Notes**
- This is a pre-computed cache (fast to read). Cap is `LEADERBOARD_SIZE` in
  `worker.ts`. Empty array if no scores submitted yet.

---

## Friends

### POST /friend/add

Adds a player as a friend by their `userId`. One-directional — only the
requesting player gains the friend in their list.

**Request body:**
```json
{ "userId": "your-uuid", "friendId": "their-uuid" }
```

**Response:**
```json
{ "success": true, "friendUsername": "Bob" }
```

**Errors**
- `404` `"Friend ID not found - check the code and try again"` if `friendId` doesn't exist.
- `400` if trying to add yourself.
- Adding an existing friend is a no-op success.

**Notes**
- Players share their UUID as a "friend code." You can display just the first 8
  characters in-game for readability, but adding requires the full UUID — so
  share/copy the full value (a UUID is unambiguous).

---

### GET /friend/list?userId=UUID

Returns all of a player's friends with current scores and stats, sorted by score
descending.

**Response:**
```json
{
  "friends": [
    {
      "userId": "friend-uuid-1",
      "username": "Bob",
      "score": 44000,
      "stats": { "wins": 20 },
      "lastSeen": 1716220800000
    }
  ]
}
```

**Errors:** `404` if `userId` not found.

---

## Matches (Async Turn-Based)

These power any turn-based PvP: cards, words, board games, RPG duels, etc. See
[MULTIPLAYER.md](MULTIPLAYER.md) for the full pattern.

### POST /match/create

Creates a new match and waits for an opponent. Returns a code to share.

**Request body:**
```json
{
  "userId": "your-uuid",
  "username": "Alice",
  "data": { },
  "state": { }
}
```
- `data` — what *this* player brings to the match (deck, team, color…). Optional.
- `state` — optional starting shared state (can also be seeded by the joiner).

**Response:**
```json
{ "success": true, "matchId": "AB12CD34" }
```

**Notes**
- `matchId` is an 8-char uppercase code (ambiguous characters excluded).
- Share it with the opponent via Discord, chat, etc.
- Matches auto-expire after `MATCH_TTL_SECONDS` (default 24h) of inactivity.

---

### POST /match/join

Joins an existing match by code. This starts the match.

**Request body:**
```json
{
  "matchId": "AB12CD34",
  "userId": "your-uuid",
  "username": "Bob",
  "data": { },
  "state": { }
}
```

**Response:**
```json
{ "success": true, "match": { } }
```
Returns the full match state object (see below).

**Errors**
- `404` if `matchId` not found.
- `400` if the match already started or finished.
- `400` if trying to join your own match.

---

### POST /match/move

Submits a turn. The server enforces that it's your turn, stores the client's
computed `state`, and flips the turn (or ends the match).

**Request body:**
```json
{
  "matchId": "AB12CD34",
  "userId": "your-uuid",
  "state": { },
  "logEntry": "Alice played the 7 of hearts.",
  "winnerUserId": null
}
```
- `state` — the full updated shared game state your client computed this turn.
- `logEntry` — optional human-readable line appended to the match log.
- `winnerUserId` — set this to a player's `userId` to end the match with that
  winner. Omit/leave null to simply pass the turn to the opponent.

**Response:**
```json
{ "success": true, "match": { } }
```

**Errors**
- `400` `"Not your turn"` if it isn't your turn.
- `400` `"Match is not active"` if the match is waiting or finished.
- `403` if you're not a participant.
- `404` if `matchId` not found.

---

### GET /match/state?matchId=CODE

Polls the current match state. Call on a timer (e.g. every 10s) to detect the
opponent's move via the `lastMoveAt` timestamp.

**Response:**
```json
{
  "matchId": "AB12CD34",
  "player1": { "userId": "...", "username": "Alice", "data": { } },
  "player2": { "userId": "...", "username": "Bob",   "data": { } },
  "status": "active",
  "turn": "player2",
  "state": { },
  "log": [
    "Bob joined. Alice goes first.",
    "Alice played the 7 of hearts."
  ],
  "winner": null,
  "winnerUsername": null,
  "createdAt": 1716134400000,
  "lastMoveAt": 1716134500000
}
```

**Status values**
- `waiting` — created, no opponent yet.
- `active` — both players in, match ongoing.
- `finished` — complete; check `winner` and `winnerUsername`.

**Errors:** `404` if `matchId` not found.

---

### POST /match/forfeit

Forfeits a match. The opponent is declared the winner.

**Request body:**
```json
{ "matchId": "AB12CD34", "userId": "your-uuid" }
```

**Response:**
```json
{ "success": true, "match": { } }
```
Returns the updated match with `status: "finished"`. A forfeit on an
already-finished match is a no-op success.

**Errors:** `404` if `matchId` not found.
