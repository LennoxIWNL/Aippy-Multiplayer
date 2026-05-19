# Async Multiplayer in Aippy
### A complete guide by Lennox (@Lennox on Aippy)

This repository documents how to build a fully persistent async multiplayer backend for games made on [Aippy](https://aippy.ai) — the mobile AI game creation platform.

It is based on real production work done building **Pocket Pack Opener**, a Pokemon pack opening and battle RPG available at [share.aippy.ai/p/8YM4](https://share.aippy.ai/p/8YM4).

---

## What This Covers

Aippy games run in a React/TypeScript environment and support `fetch()` calls to external APIs. This guide shows you how to use that capability to build a real backend using **Cloudflare Workers** and **Cloudflare KV** that handles:

- Persistent player accounts with unique IDs
- A global leaderboard with top 50 players
- Friend lists with score comparisons
- Turn-based async multiplayer battles (Chess.com style)
- Score submission with anti-cheat protection

No sign-up required for players. No passwords. No external services. Just Cloudflare.

---

## Why Cloudflare

- Free tier is generous (100,000 requests per day)
- Workers deploy in seconds
- KV database is simple key-value storage that works perfectly for game state
- No server to maintain
- Global edge network means fast responses from anywhere
- `fetch()` from Aippy to Cloudflare just works

---

## Repository Structure

```
README.md               - This file
ARCHITECTURE.md         - How the system is designed
SETUP.md                - Step by step Cloudflare setup
ENDPOINTS.md            - Full API reference
MULTIPLAYER.md          - Deep dive on async battles
AIPPY-INTEGRATION.md    - How to wire this into your Aippy game
EXAMPLE-CODE.md         - Copy-paste ready snippets
worker.ts               - The complete Worker source code
```


## Documentation

- [Architecture](ARCHITECTURE.md)
- [Setup Guide](SETUP.md)
- [Endpoints](ENDPOINTS.md)
- [Multiplayer Logic](MULTIPLAYER.md)
- [Aippy Integration](AIPPY-INTEGRATION.md)
- [Example Code](EXAMPLE-CODE.md)

---

## Quick Start

1. Read `SETUP.md` to get your Cloudflare Worker running
2. Read `AIPPY-INTEGRATION.md` for the exact fetch() calls to paste into Aippy
3. Read `MULTIPLAYER.md` if you want to understand how the battle system works
4. Copy `worker.ts` into your Worker editor and deploy

---

## About This Project

Built by **Lennox** (@Lennox on Aippy) as part of Pocket Pack Opener v4.0 development.

If this helped you, share what you built in the Aippy Discord.

Game link: [share.aippy.ai/p/8YM4](https://share.aippy.ai/p/8YM4)