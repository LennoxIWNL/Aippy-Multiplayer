# Multiplayer Patterns

### Async turn-based matches in depth — plus the other patterns this backend supports

This is the conceptual deep dive. It explains *why* async play is the right model
for Aippy, how to implement turn-based matches for any game, and what other
multiplayer shapes you can build on the same backend.

---

## Why Async, Not Real-Time

Real-time multiplayer requires a persistent connection between players
(WebSockets, WebRTC, long-lived sockets). **Aippy supports none of these.** That
rules out live, frame-synced play.

Async play works differently — there is no live connection:

1. Player 1 takes an action.
2. The new state is saved to the server.
3. Player 1's screen shows "Waiting for opponent…".
4. Player 2's client polls the server on a timer.
5. When the poll detects a change, Player 2 sees the updated state and responds.
6. Repeat until the game ends.

This is exactly how Chess.com, Words With Friends, and every other "play-by-mail"
style game works. It needs no persistent connection and runs perfectly inside
Aippy.

**Good fits for this model:** chess/checkers, card games, word games, tic-tac-toe
and other board games, turn-based RPG duels, "send a puzzle to a friend"
challenges — anything where players don't need to act simultaneously.

**Poor fits:** anything needing sub-second simultaneous input (platformers,
shooters, racing). For those, async leaderboards or "ghost"/replay competition is
the realistic alternative on Aippy.

---

## The Match Lifecycle

### Phase 1: Creation

Player 1 calls `POST /match/create` with their `data` (deck, team, color…) and an
optional starting `state`. The server creates a match in KV with status
`waiting` and returns an 8-character code like `AB12CD34`.

Player 1 shares this code with the opponent — outside the game (Discord, chat,
wherever). The match auto-expires after 24h if no one joins.

### Phase 2: Joining

Player 2 enters the code and calls `POST /match/join` with their own `data`. The
server adds Player 2, sets status to `active`, and play begins. Player 1 goes
first.

### Phase 3: Turns

On your turn, your client shows the active controls. On the opponent's turn,
controls are disabled and you show "Waiting for [opponent]…". Both clients poll
`GET /match/state` on a timer; when `lastMoveAt` changes, refresh the display.

To take a turn, the client computes the new shared `state` and calls
`POST /match/move`. The server verifies it's your turn, stores the state, and
flips `turn` to the opponent.

### Phase 4: Resolution

When your client determines the game is over, it includes `winnerUserId` in the
`/match/move` call. The server sets `status: "finished"` and records `winner` /
`winnerUsername`. Both players detect this on their next poll and show the
win/lose screen.

### Phase 5: Cleanup

Matches are stored with a TTL (default 24h). They delete themselves
automatically — no manual cleanup needed.

---

## Turn Validation (What the Server Guarantees)

The server strictly enforces whose turn it is. On every `/match/move`:

1. It reads the match from KV.
2. It checks the `turn` field (`"player1"` or `"player2"`).
3. It checks the sender's `userId` matches that slot.
4. If not, it returns `400 "Not your turn"`.
5. If so, it stores the new state and flips the turn.

So even if a client bug or a bad actor fires a move out of turn, the server
rejects it and the shared state stays coherent. This is the one rule that
*must* live server-side for turn-based play to be fair.

---

## "Client Computes, Server Stores"

The match endpoints are deliberately game-agnostic. The server never knows the
rules of *your* game. Your client owns all the logic:

- The client validates the move is legal under your rules.
- The client computes the resulting `state` (the board, hands, HP, scores…).
- The client sends that `state` to the server, which stores it verbatim.

**Why?** Re-implementing your full game engine inside the Worker would double the
work and force you to keep two copies in sync forever. For casual Aippy games the
trade-off isn't worth it. The server owns *structure* (turn order, status); the
client owns *content* (what a move does).

**The trade-off:** a determined cheater could craft a `state` that favors them or
declare themselves the winner. For a friendly game that's acceptable. If it
isn't, see "Hardening" in [ARCHITECTURE.md](ARCHITECTURE.md) — you can validate
the submitted `state` against each player's stored `data` server-side.

---

## Polling Strategy

Poll `GET /match/state` every ~10 seconds while a match is active. That interval:

- Is fast enough that the opponent's move appears within ~10s.
- Is slow enough that it doesn't spam the Worker.
- Generates ~12 requests/min for two active players combined — trivial against
  the free tier's 100k/day.

Use the `lastMoveAt` timestamp as the change check — only update the UI when it
actually changes.

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

**Tip:** stop polling when `status === "finished"` or when the player leaves the
match screen, so you're not making needless requests.

---

## The Match State Object

```typescript
interface Match {
  matchId: string;          // 8-char code, e.g. "AB12CD34"
  player1: {
    userId: string;
    username: string;
    data: unknown;          // what P1 brought (deck/team/color/loadout)
  };
  player2: {                // null while status is "waiting"
    userId: string;
    username: string;
    data: unknown;
  } | null;
  status: "waiting" | "active" | "finished";
  turn: "player1" | "player2";
  state: unknown;           // your shared game state, owned by the client
  log: string[];            // human-readable history
  winner: string | null;    // userId of winner, null if ongoing
  winnerUsername: string | null;
  createdAt: number;        // unix ms
  lastMoveAt: number;       // unix ms, changes on every move
}
```

### Designing your `state`

`state` is whatever your game needs. The only rule: it must be JSON-serializable
and the full picture should be reconstructable from one poll. A few examples:

```jsonc
// Tic-tac-toe
{ "board": ["X", null, "O", null, "X", null, null, null, null] }

// A card game
{ "p1Hand": [..], "p2Hand": [..], "discard": [..], "p1Score": 12, "p2Score": 9 }

// A turn-based RPG duel
{ "p1HP": 240, "p2HP": 180, "p1Active": 0, "p2Active": 1, "effects": [..] }
```

Keep it lean — you send and receive the whole object each turn.

### Reading it in your UI

Because the server tells you which slot you are, derive everything from one poll:

```typescript
const isPlayer1 = match.player1.userId === myUserId;
const isMyTurn  = isPlayer1 ? match.turn === "player1" : match.turn === "player2";
const opponent  = isPlayer1 ? match.player2 : match.player1;
```

---

## Forfeit

If a player wants to leave, call `POST /match/forfeit`. The opponent is
immediately declared the winner and `status` becomes `finished`. The next poll by
either player detects it.

---

## Edge Cases the Server Handles

- **Joining your own match** → `400 "Cannot join your own match"`
- **Moving in a finished/waiting match** → `400 "Match is not active"`
- **Moving when it's not your turn** → `400 "Not your turn"`
- **Acting in a match you're not in** → `403`
- **Unknown match code** → `404 "Match not found - check the code"`
- **A match left waiting** → auto-expires via KV TTL

---

## Other Multiplayer Patterns on the Same Backend

Turn-based matches are the richest example, but the same Worker + KV gives you:

### Async competition (leaderboards)

The simplest multiplayer: everyone plays solo, submits a `score`, and competes on
a global or friends leaderboard (`/score`, `/leaderboard`, `/friend/list`). No
match objects needed. Great for arcade, puzzle, and idle games.

### Social / friends layer

Add friends by code (`/friend/add`) and show their scores and stats side-by-side.
Works standalone or layered onto any other pattern.

### Cloud save & cross-device profiles

Because the player profile lives in KV keyed by UUID, the `score`/`stats` blob
doubles as cloud save. Surface the UUID so a player can restore on a new device.

### Shared persistent world (advanced)

Treat a single KV key as a shared object that many players read and append to —
a guestbook, a co-op build, a shared event tally, a "global goal" bar. Use the
match endpoints' "client computes, server stores" idea, or add a small custom
route. Be mindful that KV is eventually consistent, so it suits append-style or
last-writer-wins shared state rather than strict simultaneous editing.

Pick the smallest pattern that delivers the social hook your game needs — you can
always add more later without redeploying anything but `worker.ts`.
