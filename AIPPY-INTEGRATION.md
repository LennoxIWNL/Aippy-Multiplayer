# Aippy Integration Guide
### How to wire the Cloudflare backend into your Aippy game

Written by Lennox (@Lennox on Aippy)

---

## Overview

Aippy games run in a React/TypeScript environment. The `fetch()` API works fully. This means you can call your Cloudflare Worker from any Aippy game using standard HTTP requests.

This guide shows you exactly how to integrate the backend. The patterns here are based on real implementation in Pocket Pack Opener.

---

## Important Aippy Constraints

Before starting, understand these Aippy-specific limitations:

- **No localStorage or sessionStorage.** You cannot use browser storage. All persistent data must go through Aippy's own game state system or your Cloudflare backend.
- **No WebSockets.** Real-time connections are not supported. Use the async polling pattern described in `MULTIPLAYER.md`.
- **fetch() works.** All standard HTTP calls to external APIs work fully.
- **Game state persists.** Aippy saves your React state between sessions. Store the `userId` in game state and it will be there when the player returns.

---

## Step 1 - Store Your API URL

At the top of your game code, define a constant for your Worker URL:

```typescript
const API = "https://pocket-pack-opener-api.YOUR-SUBDOMAIN.workers.dev";
```

Replace `YOUR-SUBDOMAIN` with your actual Cloudflare subdomain.

---

## Step 2 - Player Registration

On the very first launch, register the player and save their userId. Never register again after the first time.

```typescript
// In your game state, include:
// userId: string | null  (starts as null)

// On game load, check if userId exists:
useEffect(() => {
  if (!gameState.userId) {
    registerPlayer();
  }
}, []);

async function registerPlayer() {
  try {
    const res = await fetch(`${API}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: gameState.playerName || undefined })
    });
    const data = await res.json();

    if (data.success) {
      // Save to Aippy game state permanently
      setGameState(prev => ({
        ...prev,
        userId: data.userId,
        username: data.username
      }));
    }
  } catch (err) {
    // Network unavailable - game still works offline
    // Player will register on next session
    console.error("Registration failed:", err);
  }
}
```

**Critical:** Always wrap in try/catch. If the player has no internet the game must still work. Registration will happen on the next session.

---

## Step 3 - Score Submission

Call this after any event that changes the player's score: pack open, battle win, gym clear, daily mission complete.

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
        gymWins: gameState.gymWins,
        eliteFourWins: gameState.eliteFourWins,
        battleWins: gameState.battleWins,
        battleLosses: gameState.battleLosses,
        packOpens: gameState.packOpens
      })
    });
  } catch (err) {
    // Silent fail - score will sync next time
    console.error("Score submit failed:", err);
  }
}
```

Do not await this in the UI flow. Fire it in the background so it does not slow down the game.

---

## Step 4 - Leaderboard

Load this when the player opens the leaderboard screen.

```typescript
async function loadLeaderboard() {
  try {
    const res = await fetch(`${API}/leaderboard`);
    const data = await res.json();
    setLeaderboard(data.leaderboard);
  } catch (err) {
    console.error("Leaderboard load failed:", err);
    setLeaderboard([]);
  }
}

// Rendering:
// leaderboard is an array of { userId, username, score }
// Highlight the current player's entry with a different colour
```

---

## Step 5 - Friend Code Display

Show the player their own userId as a friend code. Display only the first 8 characters to keep it readable.

```typescript
// In your profile or settings screen:
const friendCode = gameState.userId?.slice(0, 8).toUpperCase() ?? "Not registered";

// Display:
// Your friend code: AB12CD34
// Share this with friends so they can add you
```

---

## Step 6 - Adding a Friend

```typescript
async function addFriend(friendCode: string) {
  // Friend code is the first 8 chars of userId
  // We need the full UUID - this only works if they entered the full UUID
  // OR you display full UUIDs and let players copy them

  // For a better UX, display and share full UUIDs but label them "Friend Code"
  // A UUID like 550e8400-e29b-41d4-a716-446655440000 is unambiguous

  if (!gameState.userId) return;

  try {
    const res = await fetch(`${API}/friend/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: gameState.userId,
        friendId: friendCode.trim()
      })
    });
    const data = await res.json();

    if (data.success) {
      showNotification(`Added ${data.friendUsername} as a friend!`);
    } else {
      showNotification(data.error || "Could not add friend");
    }
  } catch (err) {
    showNotification("Network error - try again");
  }
}
```

---

## Step 7 - Friends Leaderboard

```typescript
async function loadFriendLeaderboard() {
  if (!gameState.userId) return;

  try {
    const res = await fetch(`${API}/friend/list?userId=${gameState.userId}`);
    const data = await res.json();
    setFriendList(data.friends);
  } catch (err) {
    setFriendList([]);
  }
}

// data.friends is sorted by score descending
// Each entry: { userId, username, score, gymWins, battleWins, lastSeen }
```

---

## Step 8 - Creating an Async Battle

```typescript
async function createBattle() {
  if (!gameState.userId || gameState.team.length === 0) return;

  try {
    const res = await fetch(`${API}/battle/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: gameState.userId,
        username: gameState.username,
        team: gameState.team  // your full team array from game state
      })
    });
    const data = await res.json();

    if (data.success) {
      setActiveBattleId(data.battleId);
      showBattleCode(data.battleId);
      // Show: "Your battle code is AB12CD34 - share this with your opponent"
      startPolling(data.battleId);
    }
  } catch (err) {
    showNotification("Could not create battle - check connection");
  }
}
```

---

## Step 9 - Joining a Battle

```typescript
async function joinBattle(battleCode: string) {
  if (!gameState.userId || gameState.team.length === 0) return;

  try {
    const res = await fetch(`${API}/battle/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        battleId: battleCode.trim().toUpperCase(),
        userId: gameState.userId,
        username: gameState.username,
        team: gameState.team
      })
    });
    const data = await res.json();

    if (data.success) {
      setActiveBattleId(battleCode);
      setBattleState(data.battle);
      startPolling(battleCode);
    } else {
      showNotification(data.error || "Could not join battle");
    }
  } catch (err) {
    showNotification("Could not join battle - check connection");
  }
}
```

---

## Step 10 - Polling for Battle Updates

```typescript
const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

function startPolling(battleId: string) {
  if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

  pollIntervalRef.current = setInterval(async () => {
    try {
      const res = await fetch(`${API}/battle/state?battleId=${battleId}`);
      const data = await res.json();

      setBattleState(prev => {
        // Only update if something changed
        if (data.lastMoveAt !== prev?.lastMoveAt) {
          return data;
        }
        return prev;
      });

      // Stop polling when battle is finished
      if (data.status === "finished") {
        clearInterval(pollIntervalRef.current!);
        handleBattleEnd(data);
      }
    } catch (err) {
      // Network blip - keep polling
    }
  }, 10000); // every 10 seconds
}

// Stop polling when component unmounts or player leaves battle screen
useEffect(() => {
  return () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
  };
}, []);
```

---

## Step 11 - Submitting a Move

```typescript
async function submitMove(moveIndex: number, calculatedDamage: number) {
  if (!activeBattleId || !gameState.userId) return;

  try {
    const res = await fetch(`${API}/battle/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        battleId: activeBattleId,
        userId: gameState.userId,
        action: "move",
        moveIndex: moveIndex,
        damage: calculatedDamage  // from your type chart damage calculation
      })
    });
    const data = await res.json();

    if (data.success) {
      setBattleState(data.battle);
    } else {
      showNotification(data.error || "Move failed");
    }
  } catch (err) {
    showNotification("Network error - try again");
  }
}

async function submitSwitch(teamIndex: number) {
  if (!activeBattleId || !gameState.userId) return;

  try {
    const res = await fetch(`${API}/battle/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        battleId: activeBattleId,
        userId: gameState.userId,
        action: "switch",
        switchTo: teamIndex
      })
    });
    const data = await res.json();

    if (data.success) {
      setBattleState(data.battle);
    }
  } catch (err) {
    showNotification("Network error - try again");
  }
}
```

---

## Step 12 - Handling Battle End

```typescript
function handleBattleEnd(battle: BattleState) {
  const iWon = battle.winner === gameState.userId;

  if (iWon) {
    // Award coins and score, update game state
    setGameState(prev => ({
      ...prev,
      coins: prev.coins + 1000,
      battleWins: prev.battleWins + 1,
      score: prev.score + 500
    }));
    submitScore(); // sync to backend
    showVictoryScreen(battle.winnerUsername);
  } else {
    setGameState(prev => ({
      ...prev,
      battleLosses: prev.battleLosses + 1
    }));
    submitScore();
    showDefeatScreen(battle.winnerUsername);
  }

  setActiveBattleId(null);
  setBattleState(null);
}
```

---

## Prompting Tips for Aippy

When you paste this into Aippy via a prompt, be specific:

- Tell it the full API URL explicitly
- Tell it which game state fields to read from and write to
- Specify that polling must use `setInterval` not `setTimeout`
- Specify that all fetch calls must be wrapped in try/catch
- Tell it to never block the UI while waiting for API responses
- Specify that userId must be saved to Aippy game state on registration and never regenerated

---

*Written by Lennox (@Lennox on Aippy)*