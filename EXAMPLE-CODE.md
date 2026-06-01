# Example Code

### Copy-paste-ready snippets for Aippy creators

Drop these into your Aippy game and adapt the field names to your game. Nothing
here is genre-specific — the `stats`, `data`, and `state` payloads are yours to
shape.

---

## Full API Helper Module

A self-contained helper covering every endpoint. Reference it wherever needed.

```typescript
// ================================================================
// api.ts - Cloudflare Worker API helper for Aippy multiplayer
// ================================================================

const API = "https://your-game-api.YOUR-SUBDOMAIN.workers.dev";

// ---------------------------------------------------------------- Users

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
export async function submitScore(
  userId: string,
  score: number,
  stats?: Record<string, number>,
) {
  const res = await fetch(`${API}/score`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, score, stats }),
  });
  return res.json(); // { success, score }
}

// ---------------------------------------------------------------- Leaderboard

export async function getLeaderboard() {
  const res = await fetch(`${API}/leaderboard`);
  return res.json(); // { leaderboard: [{ userId, username, score }] }
}

// ---------------------------------------------------------------- Friends

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
  return res.json(); // { friends: [{ userId, username, score, stats, lastSeen }] }
}

// ---------------------------------------------------------------- Matches

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
  matchId: string,
  userId: string,
  state: unknown,
  logEntry?: string,
  winnerUserId?: string,
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
  return res.json(); // full match object
}

export async function forfeitMatch(matchId: string, userId: string) {
  const res = await fetch(`${API}/match/forfeit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ matchId, userId }),
  });
  return res.json(); // { success, match }
}
```

---

## First Launch Check

```typescript
async function initPlayer() {
  if (gameState.userId) return; // already registered

  try {
    const data = await registerPlayer(gameState.playerName);
    if (data.success) {
      setGameState(prev => ({ ...prev, userId: data.userId, username: data.username }));
    }
  } catch {
    // No internet — will register next launch.
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
      {board.map((entry, i) => (
        <div
          key={entry.userId}
          style={{ background: entry.userId === gameState.userId ? "#ffd700" : "white" }}
        >
          #{i + 1} {entry.username} — {entry.score.toLocaleString()} pts
        </div>
      ))}
    </div>
  );
}
```

---

## Match Screen Turn Logic

This is genre-agnostic scaffolding. Swap `<YourGameBoard />` and your move
handler for your actual game; the turn/polling plumbing stays the same.

```typescript
function MatchScreen({ matchId, userId }) {
  const [match, setMatch] = useState(null);
  const pollRef = useRef(null);

  const isPlayer1 = match?.player1?.userId === userId;
  const isMyTurn = match
    ? (isPlayer1 ? match.turn === "player1" : match.turn === "player2")
    : false;
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
    const result = await submitTurn(
      matchId,
      userId,
      nextState,
      describeAction(action),
      winnerUserId,
    );
    if (result.success) setMatch(result.match);
    else showNotification(result.error); // e.g. "Not your turn"
  }

  if (!match) return <LoadingSpinner />;

  return (
    <div>
      <YourGameBoard state={match.state} youArePlayer1={isPlayer1} />

      {isMyTurn ? (
        <YourGameControls onAction={takeTurn} />
      ) : (
        <WaitingMessage opponent={opponent?.username} />
      )}

      <MatchLog entries={match.log} />
    </div>
  );
}
```

---

## Designing Your Score Formula

The backend only stores a single `score` number for ranking — *you* decide what
it means. Compute it in your client however you like, then submit it. A couple of
illustrative shapes:

```typescript
// Example A — a collection/progression game
function computeScore(state) {
  let score = 0;
  score += state.itemsCollected * 10;
  score += state.levelsCleared  * 500;
  score += state.bossesBeaten   * 2000;
  score += state.pvpWins        * 50;
  return score;
}

// Example B — an arcade/high-score game
function computeScore(state) {
  return state.bestRunPoints; // simplest possible: your single best run
}
```

Then sync it (with whatever extra counters you want on the board's `stats`):

```typescript
submitScore(gameState.userId, computeScore(gameState), {
  wins: gameState.wins,
  levelsCleared: gameState.levelsCleared,
});
```

Remember: `/score` only ever *raises* the stored value, so it's safe to call
liberally — a stale or lower number won't clobber a better one.

---

## Aippy Prompt Template

When prompting Aippy to implement this backend, adapt and paste something like:

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

Tailor the score/stats and match-state details to your specific game before
pasting.
