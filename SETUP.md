# Setup Guide
### Getting Your Cloudflare Worker Running

Written by Lennox (@Lennox on Aippy)

---

## What You Need

- A free Cloudflare account at [dash.cloudflare.com](https://dash.cloudflare.com)
- The `worker.ts` file from this repository
- About 10 minutes

No coding experience beyond copy-paste is required.

---

## Step 1 - Create a Cloudflare Account

Go to [dash.cloudflare.com](https://dash.cloudflare.com) and sign up for free. No credit card needed. The free tier gives you 100,000 Worker requests per day which is more than enough for an Aippy game.

---

## Step 2 - Create the KV Namespaces

KV is Cloudflare's database. You need three separate namespaces. Think of each namespace as a separate database table.

1. In the Cloudflare dashboard, click **Workers and Pages** in the left sidebar
2. Click **KV** in the sub-menu
3. Click **Create a namespace**
4. Name it exactly: `PPO_USERS` and click Add
5. Repeat and create: `PPO_LEADERBOARD`
6. Repeat and create: `PPO_BATTLES`

You should now have three namespaces listed. Keep this tab open.

---

## Step 3 - Create the Worker

1. Click **Workers and Pages** in the left sidebar
2. Click **Create application**
3. Click **Create a Worker**
4. Name your Worker: `pocket-pack-opener-api`
   - Your Worker URL will be: `pocket-pack-opener-api.YOUR-SUBDOMAIN.workers.dev`
   - Copy this URL - you will need it in Aippy
5. Click **Deploy** (deploy the Hello World placeholder for now)

---

## Step 4 - Add the Worker Code

1. After deploying you will be on the Worker overview page
2. Click **Edit code** (top right)
3. You will see the Hello World code in the editor
4. Select all of it and delete it
5. Copy the entire contents of `worker.ts` from this repository
6. Paste it into the editor
7. Click **Deploy** (top right of the editor)

If you see a syntax error check that the file is being treated as a TypeScript module. The editor should show `worker.ts` in the file tab. If it shows `worker.js` you may need to rename the file.

---

## Step 5 - Bind the KV Namespaces to the Worker

The Worker code references `env.PPO_USERS`, `env.PPO_LEADERBOARD`, and `env.PPO_BATTLES`. You need to connect the namespaces you created in Step 2 to those names.

1. Go back to the Worker overview page (click the Worker name)
2. Click **Settings**
3. Click **Variables**
4. Scroll down to **KV Namespace Bindings**
5. Click **Add binding**
6. Set Variable name: `PPO_USERS`, KV namespace: select `PPO_USERS`
7. Click **Add binding** again
8. Set Variable name: `PPO_LEADERBOARD`, KV namespace: select `PPO_LEADERBOARD`
9. Click **Add binding** again
10. Set Variable name: `PPO_BATTLES`, KV namespace: select `PPO_BATTLES`
11. Click **Save and deploy**

---

## Step 6 - Test the Worker

Open your browser and visit:

```
https://pocket-pack-opener-api.YOUR-SUBDOMAIN.workers.dev/leaderboard
```

You should see:

```json
{"leaderboard":[]}
```

An empty leaderboard array means everything is working. The Worker is live and the KV is connected.

---

## Step 7 - Get Your Worker URL

Your full Worker URL is:

```
https://pocket-pack-opener-api.YOUR-SUBDOMAIN.workers.dev
```

You can find your subdomain on the Worker overview page. Copy this URL and store it. This is your `API` constant in your Aippy game code.

---

## Common Issues

**Syntax error on deploy**
Make sure the file tab in the editor shows `worker.ts` not `worker.js`. Cloudflare supports TypeScript natively but the file must have the `.ts` extension.

**KV binding errors in logs**
Double check the Variable names in the bindings are exactly `PPO_USERS`, `PPO_LEADERBOARD`, and `PPO_BATTLES` - capital letters, underscores, no spaces.

**fetch() from Aippy gets blocked**
The Worker includes CORS headers that allow all origins. If you are still getting CORS errors check the Cloudflare deployment completed successfully and the new code is live.

**404 on all routes**
Make sure you deployed after pasting the new code. The Hello World placeholder returns 200 on `/` but the new router will return 404 on unknown routes - this is correct behaviour.

---

*Written by Lennox (@Lennox on Aippy)*