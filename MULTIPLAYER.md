# Async Multiplayer Deep Dive
### How the turn-based battle system works

Written by Lennox (@Lennox on Aippy)

---

## The Core Idea

Real-time multiplayer requires a persistent connection between two players. Aippy does not support WebSockets or any persistent connection. This rules out real-time battles.

Async turn-based battles work differently. There is no live connection. Instead:

1. Player 1 makes a move
2. The move is saved to the server
3. Player 1's game shows "Waiting for opponent..."
4. Player 2's game polls the server every 10 seconds
5. When Player 2's poll detects a new move the game shows the updated state and prompts Player 2 to respond
6. Player 2 makes their move
7. Repeat until one team is fully fainted

This is exactly how Chess.com, Words with Friends, and every other async game works. It requires no persistent connection and works perfectly in Aippy.

---

## Battle Lifecycle

### Phase 1: Creation

Player 1 selects their team and calls `POST /battle/create`. The server creates a battle object in KV with status `waiting` and returns an 8-character battle code like `AB12CD34`.

Player 1 shares this code with their opponent. This happens outside the game - Discord DM, chat, wherever.

The battle auto-expires after 24 hours if no opponent joins.

### Phase 2: Joining

Player 2 enters the code in the game and calls `POST /battle/join` with their team. The server adds Player 2's team, sets status to `active`, and both players can now play.

### Phase 3: Turns

Player 1 always goes first. On each player's turn the game shows the battle screen with the move options active. On the opponent's turn the move buttons are disabled and the game shows "Waiting for [opponent]..."

Both clients poll `GET /battle/state` every 10 seconds. When `lastMoveAt` changes the client knows a move happened and refreshes the displayed state.

### Phase 4: Resolution

When all of one player's Pokemon have 0 HP the server sets `status: "finished"` and populates `winner` with the winning player's userId and `winnerUsername` with their name.

The winning player's game detects `status: "finished"` on the next poll and shows the victory screen. The losing player sees the defeat screen.

### Phase 5: Cleanup

Battles are stored with a 24-hour TTL in KV. They automatically delete after that. There is no manual cleanup needed.

---

## Turn Validation

The server strictly enforces whose turn it is. When a move is submitted:

1. The server reads the battle state from KV
2. It checks the `turn` field (`"player1"` or `"player2"`)
3. It checks whether the submitting userId matches that player slot
4. If it is not their turn the server returns a `400` error: `"Not your turn"`
5. If it is their turn the move is processed and `turn` flips to the other player

This means even if a client bug or a bad actor sends a move out of turn it is rejected at the server. The game state stays consistent.

---

## Damage Calculation

The battle Worker uses a hybrid approach:

**Client calculates, server stores.** The Aippy game client has the full 18-type effectiveness chart built in. When a move is used the client calculates the actual damage including STAB, type matchups, and stat differences. This damage value is sent to the server as part of the move request.

The server applies the damage to the opponent's Pokemon HP and saves the result.

**Why client-side calculation?**

Reimplementing the full Pokemon type chart, base stats, and damage formula in the Worker would double the complexity of the backend for minimal benefit in a casual game. The client already has this logic working correctly.

**Server fallback:**

If no `damage` value is sent the server calculates a basic fallback: `Math.floor(movePower * 0.4 + random * 10)`. This ensures the battle cannot get stuck if the client forgets to send damage.

**Anti-cheat consideration:**

A bad actor could send `damage: 99999` to one-shot any Pokemon. For a casual Aippy game this is an acceptable trade-off. If you want to prevent this you can add damage range validation in the Worker based on the attacker's base stats, which are available from the team object stored in the battle state.

---

## Polling Strategy

Both clients poll `GET /battle/state` every 10 seconds. This is the right interval for an async game because:

- Fast enough that the opponent's move appears within 10 seconds of being made
- Slow enough that it does not spam the Worker with requests
- At 10 second polling, two active players generate 12 requests per minute combined - well within Cloudflare's free tier

**Implementing the poll in Aippy:**

```typescript
useEffect(() => {
  if (!activeBattleId || battleStatus === "finished") return;

  const poll = setInterval(async () => {
    const res = await fetch(`${API}/battle/state?battleId=${activeBattleId}`);
    const data = await res.json();

    if (data.lastMoveAt !== lastKnownMoveAt) {
      setLastKnownMoveAt(data.lastMoveAt);
      setBattleState(data);
    }
  }, 10000);

  return () => clearInterval(poll);
}, [activeBattleId, battleStatus, lastKnownMoveAt]);
```

The `lastMoveAt` timestamp is the efficient check. Only update the displayed state when something actually changed.

---

## The Battle State Object in Detail

```typescript
interface BattleState {
  battleId: string;            // 8 char uppercase code e.g. "AB12CD34"
  player1: {
    userId: string;
    username: string;
    team: Pokemon[];           // full team array from game state
  };
  player2: {                   // null while status is "waiting"
    userId: string;
    username: string;
    team: Pokemon[];
  } | null;
  status: "waiting" | "active" | "finished";
  turn: "player1" | "player2";
  currentP1Pokemon: number;    // index into player1.team
  currentP2Pokemon: number;    // index into player2.team
  p1PokemonHP: number[];       // current HP for each team slot
  p2PokemonHP: number[];       // 0 = fainted
  log: string[];               // human readable battle history
  winner: string | null;       // userId of winner, null if ongoing
  winnerUsername: string | null;
  createdAt: number;           // unix timestamp ms
  lastMoveAt: number;          // unix timestamp ms, changes on every move
}
```

### Reading the state in your UI

The `p1PokemonHP` and `p2PokemonHP` arrays align with the team arrays. Index 0 in HP is index 0 in team. This means you can always reconstruct the full visual state of the battle from one poll response.

```typescript
// Is my current Pokemon alive?
const myHP = isPlayer1
  ? battleState.p1PokemonHP[battleState.currentP1Pokemon]
  : battleState.p2PokemonHP[battleState.currentP2Pokemon];

// How many of my Pokemon are still alive?
const myAliveCount = isPlayer1
  ? battleState.p1PokemonHP.filter(hp => hp > 0).length
  : battleState.p2PokemonHP.filter(hp => hp > 0).length;

// Is it my turn?
const isMyTurn = isPlayer1
  ? battleState.turn === "player1"
  : battleState.turn === "player2";
```

---

## Auto-faint Switching

When a Pokemon faints the server automatically advances to the next alive Pokemon in the team. You do not need to send a switch action.

The server scans the HP array from index 0 for the first entry with HP > 0 and sets `currentP1Pokemon` or `currentP2Pokemon` to that index. It also adds a log message like `"Gary sent out Gyarados!"`.

If no alive Pokemon remain the battle is set to `finished`.

This means after any move that causes a faint the returned battle state already has the new active Pokemon set and ready.

---

## Forfeit

If a player wants to leave a battle they call `POST /battle/forfeit`. The opponent is immediately declared the winner and the battle status is set to `finished`. The next poll by either player will detect the finished state.

---

## Edge Cases Handled

**Player joins their own battle:** Rejected with `400 "Cannot join your own battle"`

**Move submitted on finished battle:** Rejected with `400 "Battle is not active"`

**Switch to a fainted Pokemon:** Rejected with `400 "That Pokemon has fainted"`

**Battle code not found:** Returns `404 "Battle not found - check the code"`

**Battle left in waiting state:** Auto-expires in KV after 24 hours

---

*Written by Lennox (@Lennox on Aippy)*