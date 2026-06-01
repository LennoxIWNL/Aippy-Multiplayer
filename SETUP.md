# Setup Guide

### Getting your Cloudflare Worker running

This walks you through deploying `worker.ts` to Cloudflare. It takes about 10
minutes and requires no coding beyond copy-paste.

> **Naming convention used in this guide:** the template uses the KV binding
> names `GAME_USERS`, `GAME_LEADERBOARD`, and `GAME_MATCHES`, and an example
> Worker name of `your-game-api`. You can rename any of these — just keep the
> KV **binding names** in sync with the names referenced in `worker.ts`.

---

## What You Need

- A free Cloudflare account at [dash.cloudflare.com](https://dash.cloudflare.com)
- The `worker.ts` file from this repository
- About 10 minutes

---

## Step 1 — Create a Cloudflare Account

Go to [dash.cloudflare.com](https://dash.cloudflare.com) and sign up for free.
No credit card needed. The free tier gives 100,000 Worker requests/day — far
more than an Aippy game needs.

---

## Step 2 — Create the KV Namespaces

KV is Cloudflare's database. You need three namespaces (think of each as a
separate table).

1. In the dashboard, click **Workers & Pages** in the left sidebar.
2. Click **KV** in the sub-menu.
3. Click **Create a namespace**.
4. Name it exactly: `GAME_USERS` → Add.
5. Repeat for `GAME_LEADERBOARD`.
6. Repeat for `GAME_MATCHES`.

You should now have three namespaces. Keep this tab open.

> Want your own names? Fine — e.g. `MYGAME_USERS`. Just remember them; you'll
> bind them to the same variable names in Step 5, and those variable names are
> what `worker.ts` reads via `env.GAME_USERS` etc. If you rename the variables,
> rename them in `worker.ts`'s `Env` interface and handlers too.

---

## Step 3 — Create the Worker

1. Click **Workers & Pages** in the left sidebar.
2. Click **Create application** → **Create a Worker**.
3. Name your Worker, e.g. `your-game-api`.
   - Your Worker URL becomes: `your-game-api.YOUR-SUBDOMAIN.workers.dev`
   - Copy this URL — you'll need it in Aippy.
4. Click **Deploy** (deploy the Hello World placeholder for now).

---

## Step 4 — Add the Worker Code

1. After deploying you'll land on the Worker overview page.
2. Click **Edit code** (top right).
3. Select all of the Hello World code and delete it.
4. Copy the entire contents of `worker.ts` from this repository.
5. Paste it into the editor.
6. Click **Deploy** (top right of the editor).

If you see a syntax error, make sure the file tab shows `worker.ts` (TypeScript),
not `worker.js`. Cloudflare supports TypeScript natively.

---

## Step 5 — Bind the KV Namespaces to the Worker

`worker.ts` references `env.GAME_USERS`, `env.GAME_LEADERBOARD`, and
`env.GAME_MATCHES`. You must connect the namespaces from Step 2 to those names.

1. Go to the Worker overview page (click the Worker name).
2. Click **Settings** → **Variables** (or **Bindings** in newer dashboards).
3. Find **KV Namespace Bindings** and click **Add binding**.
4. Variable name: `GAME_USERS`, KV namespace: select `GAME_USERS`.
5. Add binding: `GAME_LEADERBOARD` → `GAME_LEADERBOARD`.
6. Add binding: `GAME_MATCHES` → `GAME_MATCHES`.
7. Click **Save and deploy**.

The **Variable name** (left side) is what the code reads. It must match exactly:
capital letters, underscores, no spaces.

---

## Step 6 — Test the Worker

Open your browser and visit:

```
https://your-game-api.YOUR-SUBDOMAIN.workers.dev/leaderboard
```

You should see:

```json
{"leaderboard":[]}
```

An empty array means everything works: the Worker is live and KV is connected.

---

## Step 7 — Get Your Worker URL

Your full base URL is:

```
https://your-game-api.YOUR-SUBDOMAIN.workers.dev
```

You can find your subdomain on the Worker overview page. This URL is the `API`
constant you'll paste into your Aippy game (see AIPPY-INTEGRATION.md).

---

## Common Issues

**Syntax error on deploy**
Make sure the editor's file tab shows `worker.ts`, not `worker.js`.

**KV binding errors in the logs**
Double-check the binding **variable names** are exactly `GAME_USERS`,
`GAME_LEADERBOARD`, `GAME_MATCHES` (or whatever you renamed them to in the code).

**`fetch()` from Aippy gets blocked by CORS**
The Worker sends permissive CORS headers on every response. If you still see CORS
errors, confirm the latest code actually deployed.

**404 on every route**
Make sure you deployed after pasting the new code. The new router returns 404 on
unknown paths — that's correct. Confirm a known route like `/leaderboard` works.

---

## Going Further

- **Custom domain:** attach a route like `api.yourgame.com` in the Worker's
  **Triggers** settings if you don't want the `workers.dev` URL.
- **Local development:** install `wrangler` (`npm i -g wrangler`) and run
  `wrangler dev` against a `wrangler.toml` that declares the same KV bindings.
- **Tuning:** the `LEADERBOARD_SIZE` and `MATCH_TTL_SECONDS` constants at the top
  of `worker.ts` are the only knobs you'll usually touch.
