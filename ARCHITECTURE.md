# Architecture
### Async Multiplayer Backend for Aippy Games

Written by Lennox (@Lennox on Aippy)

---

## Overview

The system has two parts:

1. **Cloudflare Worker** - a serverless function that receives HTTP requests and handles all game logic
2. **Cloudflare KV** - a key-value database that stores all persistent data

Your Aippy game talks to the Worker using `fetch()`. The Worker reads and writes to KV. That is the entire system.

```
[Aippy Game]
     |
     | fetch() HTTP requests
     |
[Cloudflare Worker]
     |
     | KV reads and writes
     |
[Cloudflare KV Namespaces]
  PPO_USERS       - player profiles and scores
  PPO_LEADERBOARD - top 50 cached leaderboard
  PPO_BATTLES     - active battle states
```

---

## Why This Architecture

### No traditional server
A traditional backend would require a VPS, a database server, authentication setup, SSL certificates, and ongoing maintenance. Cloudflare Workers handles all of that automatically. You deploy a single TypeScript file and Cloudflare runs it globally.

### No sign-up for players
On first launch the game calls `/register` and gets back a UUID. That UUID is stored in Aippy game state and used for every future request. Players never create an account. There is no password. The UUID is the identity.

This is critical for Aippy games because you want zero friction for new players. If someone has to sign up before they can play multiplayer, most of them won't.

### KV as a game database
Cloudflare KV stores data as key-value pairs. This is simpler than a relational database and maps well to game state:

- One key per player: `user:UUID` -> player object as JSON
- One key for the leaderboard: `global` -> sorted array as JSON
- One key per battle: `battle:BATTLEID` -> battle state as JSON

Reading and writing JSON objects covers everything this game needs.

### Async battles over real-time
Real-time multiplayer requires WebSockets or similar persistent connections. Aippy does not support this natively. Async turn-based battles sidestep this entirely. Each player makes their move, the state is saved, and the opponent polls for updates on a timer. This is exactly how Chess.com works and it handles any amount of players without connection issues.

---

## Data Models

### Player Object
```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "username": "Trainer550E8",
  "score": 15400,
  "gymWins": 8,
  "eliteFourWins": 1,
  "battleWins": 12,
  "battleLosses": 3,
  "packOpens": 47,
  "friends": ["other-uuid-1", "other-uuid-2"],
  "createdAt": 1716134400000,
  "lastSeen": 1716220800000
}
```

### Leaderboard Cache
```json
[
  { "userId": "uuid-1", "username": "Trainer1", "score": 98000 },
  { "userId": "uuid-2", "username": "Trainer2", "score": 87500 },
  ...
]
```
Stored as a sorted array of the top 50 players. Rebuilt every time a score is submitted. Fast to read because it is pre-sorted.

### Battle State Object
```json
{
  "battleId": "AB12CD34",
  "player1": { "userId": "...", "username": "Ash", "team": [...] },
  "player2": { "userId": "...", "username": "Gary", "team": [...] },
  "status": "active",
  "turn": "player1",
  "currentP1Pokemon": 0,
  "currentP2Pokemon": 0,
  "p1PokemonHP": [245, 180, 310],
  "p2PokemonHP": [200, 0, 290],
  "log": ["Ash's Charizard used Flamethrower for 84 damage!", "Gary's Blastoise fainted!"],
  "winner": null,
  "winnerUsername": null,
  "createdAt": 1716134400000,
  "lastMoveAt": 1716134500000
}
```

---

## Security Model

### What is protected
- Score can only ever increase, never decrease. The Worker enforces this. A player cannot submit a lower score to manipulate rankings.
- Battle turn validation. The Worker checks it is actually your turn before processing a move. You cannot submit a move out of turn.
- Players cannot join their own battle.
- Players cannot add themselves as a friend.

### What is not protected
- A player could submit a fabricated high score by calling `/score` directly with a large number.
- A player could send a very high damage value with a move to one-shot opponents.

### Why this is acceptable for an Aippy game
Aippy games are casual and community-driven. The leaderboard is for fun. Full server-side game logic would require reimplementing the entire battle engine in the Worker, which is significant complexity. The current model trusts the client for damage calculation (which uses the full type chart) and only enforces turn order and score direction on the server.

If you want stronger anti-cheat, the Worker can be extended to validate damage ranges based on Pokemon stats. This is documented in `MULTIPLAYER.md`.

---

## Request Flow Examples

### Player opens a pack and gets a new Pokemon
1. Game calculates new score locally
2. Game calls `POST /score` with userId and new score
3. Worker reads player from KV, checks score is higher, updates it
4. Worker rebuilds leaderboard cache in KV
5. Worker returns success
6. Game shows updated score

### Player challenges a friend to a battle
1. Player A calls `POST /battle/create` with their team
2. Worker creates battle state in KV, returns battleId `AB12CD34`
3. Player A shares the code `AB12CD34` with Player B (via Discord, etc.)
4. Player B calls `POST /battle/join` with the code and their team
5. Worker updates battle state to `active`
6. Both players poll `GET /battle/state?battleId=AB12CD34` every 10 seconds
7. When it is their turn the game shows the move interface
8. Each move is submitted via `POST /battle/move`
9. When all of one player's Pokemon faint the battle is `finished`

---

*Written by Lennox (@Lennox on Aippy)*