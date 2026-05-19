# Example Code
### Copy-paste ready snippets for Aippy creators

Written by Lennox (@Lennox on Aippy)

---

## Full API Helper Module

Drop this into your Aippy game as a self-contained API helper. Import or reference it wherever needed.

```typescript
// ================================================================
// api.ts - Cloudflare Worker API helper
// Based on Pocket Pack Opener by Lennox (@Lennox on Aippy)
// ================================================================

const API = "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev";

// ----------------------------------------------------------------
// Users
// ----------------------------------------------------------------

export async function registerPlayer(username?: string) {
  const res = await fetch(`${API}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username })
  });
  return res.json(); // { success, userId, username }
}

export async function getPlayer(userId: string) {
  const res = await fetch(`${API}/user?userId=${userId}`);
  return res.json();
}

export async function submitScore(
  userId: string,
  score: number,
  stats?: {
    gymWins?: number;
    eliteFourWins?: number;
    battleWins?: number;
    battleLosses?: number;
    packOpens?: number;
  }
) {
  const res = await fetch(`${API}/score`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, score, ...stats })
  });
  return res.json(); // { success, score }
}

// ----------------------------------------------------------------
// Leaderboard
// ----------------------------------------------------------------

export async function getLeaderboard() {
  const res = await fetch(`${API}/leaderboard`);
  return res.json(); // { leaderboard: [{userId, username, score}] }
}

// ----------------------------------------------------------------
// Friends
// ----------------------------------------------------------------

export async function addFriend(userId: string, friendId: string) {
  const res = await fetch(`${API}/friend/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, friendId })
  });
  return res.json(); // { success, friendUsername } or { error }
}

export async function getFriendList(userId: string) {
  const res = await fetch(`${API}/friend/list?userId=${userId}`);
  return res.json(); // { friends: [{userId, username, score, ...}] }
}

// ----------------------------------------------------------------
// Battles
// ----------------------------------------------------------------

export async function createBattle(userId: string, username: string, team: any[]) {
  const res = await fetch(`${API}/battle/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, username, team })
  });
  return res.json(); // { success, battleId }
}

export async function joinBattle(
  battleId: string,
  userId: string,
  username: string,
  team: any[]
) {
  const res = await fetch(`${API}/battle/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ battleId, userId, username, team })
  });
  return res.json(); // { success, battle }
}

export async function submitMove(
  battleId: string,
  userId: string,
  moveIndex: number,
  damage: number
) {
  const res = await fetch(`${API}/battle/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ battleId, userId, action: "move", moveIndex, damage })
  });
  return res.json(); // { success, battle }
}

export async function submitSwitch(
  battleId: string,
  userId: string,
  switchTo: number
) {
  const res = await fetch(`${API}/battle/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ battleId, userId, action: "switch", switchTo })
  });
  return res.json(); // { success, battle }
}

export async function getBattleState(battleId: string) {
  const res = await fetch(`${API}/battle/state?battleId=${battleId}`);
  return res.json(); // full battle state object
}

export async function getActiveBattle(userId: string) {
  const res = await fetch(`${API}/battle/list?userId=${userId}`);
  return res.json(); // { activeBattle: battle | null }
}

export async function forfeitBattle(battleId: string, userId: string) {
  const res = await fetch(`${API}/battle/forfeit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ battleId, userId })
  });
  return res.json(); // { success, battle }
}
```

---

## First Launch Check

```typescript
// Call this in your top-level component useEffect
async function initPlayer() {
  if (gameState.userId) return; // already registered

  try {
    const data = await registerPlayer(gameState.playerName);
    if (data.success) {
      setGameState(prev => ({
        ...prev,
        userId: data.userId,
        username: data.username
      }));
    }
  } catch {
    // No internet - will register next launch
  }
}
```

---

## Leaderboard Component Pattern

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
      {board.map((entry, index) => (
        <div
          key={entry.userId}
          style={{
            background: entry.userId === gameState.userId ? "#ffd700" : "white"
          }}
        >
          #{index + 1} {entry.username} - {entry.score.toLocaleString()} pts
        </div>
      ))}
    </div>
  );
}
```

---

## Battle Screen Turn Logic

```typescript
function BattleScreen({ battleId, userId }) {
  const [battle, setBattle] = useState(null);
  const pollRef = useRef(null);

  const isPlayer1 = battle?.player1?.userId === userId;
  const isMyTurn = battle
    ? (isPlayer1 ? battle.turn === "player1" : battle.turn === "player2")
    : false;

  useEffect(() => {
    // Initial load
    getBattleState(battleId).then(setBattle);

    // Start polling
    pollRef.current = setInterval(async () => {
      const updated = await getBattleState(battleId);
      setBattle(prev => {
        if (updated.lastMoveAt !== prev?.lastMoveAt) return updated;
        return prev;
      });
      if (updated.status === "finished") {
        clearInterval(pollRef.current);
      }
    }, 10000);

    return () => clearInterval(pollRef.current);
  }, [battleId]);

  async function handleMove(moveIndex, damage) {
    const result = await submitMove(battleId, userId, moveIndex, damage);
    if (result.success) setBattle(result.battle);
  }

  if (!battle) return <LoadingSpinner />;

  const myHP = isPlayer1
    ? battle.p1PokemonHP[battle.currentP1Pokemon]
    : battle.p2PokemonHP[battle.currentP2Pokemon];

  const myPokemon = isPlayer1
    ? battle.player1.team[battle.currentP1Pokemon]
    : battle.player2.team[battle.currentP2Pokemon];

  return (
    <div>
      <PokemonSprite pokemon={myPokemon} />
      <HPBar current={myHP} max={myPokemon.stats.hp} />

      {isMyTurn ? (
        <MoveButtons
          moves={myPokemon.moves}
          onMove={(i, dmg) => handleMove(i, dmg)}
        />
      ) : (
        <WaitingMessage opponent={
          isPlayer1 ? battle.player2?.username : battle.player1.username
        } />
      )}

      <BattleLog entries={battle.log} />
    </div>
  );
}
```

---

## Score Calculation (Pocket Pack Opener Formula)

This is the exact formula used in Pocket Pack Opener for reference:

```typescript
function calculateScore(pokedex: Record<number, PokemonEntry>, stats: PlayerStats) {
  let score = 0;

  // Pokedex collection score
  Object.values(pokedex).forEach(pokemon => {
    if (pokemon.owned) {
      if (pokemon.dexNumber <= 50) score += 1;          // common
      else if (pokemon.dexNumber <= 150) score += 3;    // uncommon
      else if (pokemon.dexNumber <= 250) score += 10;   // rare
      else if (pokemon.dexNumber <= 350) score += 25;   // ultra rare
      else score += 100;                                  // legendary
    }
  });

  // Activity score
  score += stats.gymWins * 500;
  score += stats.eliteFourWins * 2000;
  score += stats.battleWins * 50;
  score += stats.dailyMissionCompletions * 100;

  return score;
}
```

---

## Aippy Prompt Template

When prompting Aippy to implement this backend, use this template:

```
Add a Cloudflare Worker backend to the game using these exact fetch() calls.
The API base URL is: https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev

On first launch, if gameState.userId is null or undefined, call POST /register
with the player name and save the returned userId to game state permanently.
Never call /register again after the first time.

After every pack open, battle result, gym win, or daily mission complete,
call POST /score with the current userId and full score.
Do this in the background with a try/catch. Never block the UI for this call.

On the leaderboard screen, call GET /leaderboard and display the returned array.
Highlight the current player's row in gold if their userId matches.

Add an async multiplayer option to the battle menu:
- "Challenge Friend" button opens a screen to create or join a battle
- Creating shows a battle code to share
- Joining asks for the opponent's code
- Once joined, both players see the battle screen
- Poll GET /battle/state every 10 seconds using setInterval
- Stop polling when status is "finished"
- The move buttons are only active when it is the current player's turn
- When not your turn show "Waiting for [opponent name]..."

All fetch calls must be wrapped in try/catch.
Never crash the game on network errors - just show a notification.
Increment version number.
```

---

*Written by Lennox (@Lennox on Aippy)*