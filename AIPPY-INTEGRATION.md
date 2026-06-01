# Aippy Integration Guide

### How to wire the Cloudflare backend into your Aippy game

This shows exactly how to connect the backend to any Aippy game. The patterns are
generic — adapt the field names to whatever your game already stores.

---

## Overview

Aippy games run in a React/TypeScript environment where `fetch()` works fully.
That means you can call your Cloudflare Worker with standard HTTP requests from
anywhere in your game.

---

## Important Aippy Constraints

Before you start, keep these Aippy-specific limits in mind:

- **No `localStorage` or `sessionStorage`.** You can't use browser storage. All
  persistent data goes through Aippy's own game-state system or your backend.
- **No WebSockets.** Real-time connections aren't supported — use the async
  polling pattern from [MULTIPLAYER.md](MULTIPLAYER.md).
- **`fetch()` works.** All standard HTTP calls to external APIs work.
- **Game state persists.** Aippy saves your React state between sessions. Store
  the `userId` in game state and it'll be there when the player returns.

---

## Step 1 — Store Your API URL

At the top of your game code, define your Worker URL once:

```typescript
const API = "https://your-game-api.YOUR-SUBDOMAIN.workers.dev";
```

Replace with your actual Worker URL from SETUP.md.

---

## Step 2 — Player Registration

On the very first launch, register the player and save their `userId`. Never
register again after that.

```typescript
// In your game state, include: userId: string | null  (starts as null)

useEffect(() => {
  if (!gameState.userId) registerPlayer();
}, []);

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
    // Network unavailable — the game still works offline.
    // Registration will retry on the next session.
    console.error("Registration failed:", err);
  }
}
```

**Critical:** always wrap in try/catch. If the player has no internet, the game
must still run; registration happens next session.

---

## Step 3 — Score Submission

Call this after any event that changes the player's score (level clear, win,
purchase, milestone — whatever scoring means in your game).

```typescript
async function submitScore() {
  if (!gameState.userId) return; // not registered yet

  try {
    await fetch(`${API}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: gameState.userId,
        score: gameState.score,
        // `stats` is free-form — send whatever your game tracks:
        stats: {
          wins: gameState.wins,
          losses: gameState.losses,
          levelsCleared: gameState.levelsCleared,
        },
      }),
    });
  } catch (err) {
    // Silent fail — it'll sync next time.
    console.error("Score submit failed:", err);
  }
}
```

Don't `await` this in the UI flow — fire it in the background so it never slows
the game.

---

## Step 4 — Leaderboard

Load this when the player opens the leaderboard screen.

```typescript
async function loadLeaderboard() {
  try {
    const res = await fetch(`${API}/leaderboard`);
    const data = await res.json();
    setLeaderboard(data.leaderboard); // [{ userId, username, score }]
  } catch (err) {
    console.error("Leaderboard load failed:", err);
    setLeaderboard([]);
  }
}
// When rendering, highlight the row where userId === gameState.userId.
```

---

## Step 5 — Friend Code Display

Show the player their own `userId` as a friend code. You can display a short
prefix for readability, but sharing/adding needs the full UUID.

```typescript
// In your profile/settings screen:
const friendCode = gameState.userId ?? "Not registered";

// Show the full UUID labeled "Your Friend Code" with a copy button.
// A UUID like 550e8400-e29b-41d4-a716-446655440000 is unambiguous to paste.
```

---

## Step 6 — Adding a Friend

```typescript
async function addFriend(friendId: string) {
  if (!gameState.userId) return;

  try {
    const res = await fetch(`${API}/friend/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: gameState.userId, friendId: friendId.trim() }),
    });
    const data = await res.json();

    if (data.success) showNotification(`Added ${data.friendUsername} as a friend!`);
    else showNotification(data.error || "Could not add friend");
  } catch {
    showNotification("Network error - try again");
  }
}
```

---

## Step 7 — Friends Leaderboard

```typescript
async function loadFriendLeaderboard() {
  if (!gameState.userId) return;
  try {
    const res = await fetch(`${API}/friend/list?userId=${gameState.userId}`);
    const data = await res.json();
    setFriendList(data.friends); // sorted by score desc; each: { userId, username, score, stats, lastSeen }
  } catch {
    setFriendList([]);
  }
}
```

---

## Step 8 — Creating an Async Match

`data` is whatever this player brings (a deck, a team, a color). `state` is your
optional starting shared state.

```typescript
async function createMatch() {
  if (!gameState.userId) return;

  try {
    const res = await fetch(`${API}/match/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: gameState.userId,
        username: gameState.username,
        data: gameState.loadout,            // your per-player setup
        state: buildInitialMatchState(),    // your starting board/state
      }),
    });
    const data = await res.json();

    if (data.success) {
      setActiveMatchId(data.matchId);
      showMatchCode(data.matchId); // "Your code is AB12CD34 - share it with your opponent"
      startPolling(data.matchId);
    }
  } catch {
    showNotification("Could not create match - check connection");
  }
}
```

---

## Step 9 — Joining a Match

```typescript
async function joinMatch(code: string) {
  if (!gameState.userId) return;

  try {
    const res = await fetch(`${API}/match/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        matchId: code.trim().toUpperCase(),
        userId: gameState.userId,
        username: gameState.username,
        data: gameState.loadout,
      }),
    });
    const data = await res.json();

    if (data.success) {
      setActiveMatchId(code);
      setMatchState(data.match);
      startPolling(code);
    } else {
      showNotification(data.error || "Could not join match");
    }
  } catch {
    showNotification("Could not join match - check connection");
  }
}
```

---

## Step 10 — Polling for Match Updates

```typescript
const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

function startPolling(matchId: string) {
  if (pollRef.current) clearInterval(pollRef.current);

  pollRef.current = setInterval(async () => {
    try {
      const res = await fetch(`${API}/match/state?matchId=${matchId}`);
      const data = await res.json();

      setMatchState(prev => (data.lastMoveAt !== prev?.lastMoveAt ? data : prev));

      if (data.status === "finished") {
        clearInterval(pollRef.current!);
        handleMatchEnd(data);
      }
    } catch {
      // Network blip — keep polling.
    }
  }, 10000); // every 10 seconds
}

// Stop polling on unmount / leaving the match screen.
useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);
```

---

## Step 11 — Submitting a Turn

Your client computes the new shared `state`, then sends it. Pass `winnerUserId`
when the game is over.

```typescript
async function submitTurn(nextState: unknown, logEntry: string, winnerUserId?: string) {
  if (!activeMatchId || !gameState.userId) return;

  try {
    const res = await fetch(`${API}/match/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        matchId: activeMatchId,
        userId: gameState.userId,
        state: nextState,
        logEntry,
        winnerUserId: winnerUserId ?? null,
      }),
    });
    const data = await res.json();

    if (data.success) setMatchState(data.match);
    else showNotification(data.error || "Move failed"); // e.g. "Not your turn"
  } catch {
    showNotification("Network error - try again");
  }
}
```

---

## Step 12 — Handling Match End

```typescript
function handleMatchEnd(match) {
  const iWon = match.winner === gameState.userId;

  setGameState(prev => ({
    ...prev,
    wins: prev.wins + (iWon ? 1 : 0),
    losses: prev.losses + (iWon ? 0 : 1),
    score: prev.score + (iWon ? 500 : 0),
  }));
  submitScore(); // sync the new totals to the backend

  if (iWon) showVictoryScreen(match.winnerUsername);
  else showDefeatScreen(match.winnerUsername);

  setActiveMatchId(null);
  setMatchState(null);
}
```

---

## Prompting Tips for Aippy

When you ask Aippy to build this in, be specific:

- Give the full API URL explicitly.
- Tell it which game-state fields to read from and write to.
- Say that polling must use `setInterval`, not `setTimeout`.
- Say that **every** `fetch` must be wrapped in try/catch and must never crash
  the game on a network error — just show a notification.
- Say that `userId` must be saved to game state on registration and **never**
  regenerated.
- Say that match-move buttons are enabled only on the player's turn, and show a
  "Waiting for [opponent]…" state otherwise.

See [EXAMPLE-CODE.md](EXAMPLE-CODE.md) for a ready-to-paste helper module and a
copy-paste Aippy prompt template.
