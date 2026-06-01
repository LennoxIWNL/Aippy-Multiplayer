# Adding Multiplayer to Aippy Games

### A complete, copy-paste tutorial for any Aippy creator

This repository is a **template and tutorial** for adding a real, persistent
multiplayer backend to any game built on [Aippy](https://aippy.ai) — the mobile
AI game-creation platform.

It does not assume your game is any particular genre. Whether you're building a
card game, an idle clicker, a word game, an RPG, a board game, or anything else,
the same backend pattern works. You wire it up once and pick whichever
multiplayer features your game needs.

> The pattern here was originally proven in production by Lennox (@Lennox on
> Aippy) while building *Pocket Pack Opener*, then generalized so anyone can
> reuse it. Wherever this guide shows an example, treat it as *one* way to use
> the backend — not the only way.

---

## The Core Principle

Aippy games run in a React/TypeScript environment and can make standard
`fetch()` calls. That single capability is enough to give your game a real
backend. The principle is:

> **Put a tiny serverless API in front of a key-value store, give every player
> an anonymous ID, and have clients poll for updates instead of holding a live
> connection.**

That's it. No game servers to run, no databases to administer, no login screens.
This repo implements that principle with **Cloudflare Workers** + **Cloudflare
KV**, and ships a single ready-to-deploy `worker.ts`.

---

## What You Can Build With It

The included backend is a toolkit of multiplayer building blocks. Use any subset:

- **Anonymous player accounts** — a UUID per player, no sign-up, no passwords.
- **Cloud save / cross-device profiles** — store each player's score and stats.
- **Global leaderboards** — a top-N board, sorted and cached for fast reads.
- **Friend lists** — add friends by code and compare scores.
- **Async turn-based matches** — chess.com-style play for any turn game:
  cards, words, board games, RPG duels, tic-tac-toe, and more.

These are composable. A trivia game might only want a leaderboard. A strategy
game might want matches + friends. Take what you need.

---

## Why This Stack

- **Free tier is generous** — 100,000 Worker requests/day, plenty for an Aippy game.
- **Deploys in seconds** — paste one file into the dashboard and click Deploy.
- **KV is dead-simple** — key/value JSON storage that maps cleanly to game state.
- **Nothing to maintain** — no server, no patching, no scaling config.
- **Global edge** — fast responses anywhere in the world.
- **`fetch()` from Aippy just works** — CORS is handled for you.

Cloudflare is what this template uses, but the *principle* is portable. Any
serverless function + key-value store (Vercel + Upstash, Deno Deploy + KV, etc.)
would work with the same client code.

---

## Repository Structure

```
README.md               - This file: the principle and where to start
ARCHITECTURE.md         - How the system is designed and why
SETUP.md                - Step-by-step Cloudflare deployment
ENDPOINTS.md            - Full API reference for every route
MULTIPLAYER.md          - Deep dive on async turn-based matches (+ other patterns)
AIPPY-INTEGRATION.md    - Exactly how to wire this into your Aippy game
EXAMPLE-CODE.md         - Copy-paste-ready client snippets
worker.ts               - The complete, game-agnostic Worker source code
```

---

## Quick Start

1. Read **[SETUP.md](SETUP.md)** and deploy `worker.ts` to Cloudflare (~10 min).
2. Read **[AIPPY-INTEGRATION.md](AIPPY-INTEGRATION.md)** for the exact `fetch()`
   calls and game-state wiring to paste into Aippy.
3. Skim **[ARCHITECTURE.md](ARCHITECTURE.md)** to understand the design choices
   (especially the "client computes, server stores" trust model).
4. If you want player-vs-player matches, read **[MULTIPLAYER.md](MULTIPLAYER.md)**.

---

## Documentation

- [Architecture](ARCHITECTURE.md)
- [Setup Guide](SETUP.md)
- [Endpoints](ENDPOINTS.md)
- [Multiplayer Patterns](MULTIPLAYER.md)
- [Aippy Integration](AIPPY-INTEGRATION.md)
- [Example Code](EXAMPLE-CODE.md)

---

## Credits & Contributing

Originally built and proven in production by **Lennox** (@Lennox on Aippy),
then generalized into this open template for the whole community.

If this helped you ship multiplayer, share what you built in the Aippy Discord —
and feel free to adapt, extend, and pass the template along.
