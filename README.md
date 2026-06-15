# QR ID Login + Supabase — Project Handoff Guide

This document explains **everything** about this project so a new person can set
it up, run it locally, deploy it to Render, and maintain it over time.

> **TL;DR for the impatient**
> 1. `npm install` (Node 20+ required)
> 2. Create a Supabase project, run [`supabase-schema.sql`](./supabase-schema.sql) in the SQL Editor.
> 3. Copy [`.env.example`](./.env.example) to `.env` and fill in the values.
> 4. `npm start` and open http://localhost:3000

---

## 1. What this app is

A research/study web app with this user flow:

```
login.html  ->  consent.html  ->  qr.html (main app)  ->  ending.html
                                       |
                                       | scan QR on phone
                                       v
                                  upload.html (phone uploads a photo)
                                       |
                                       v
                                  gallery.html (see all your uploads)
```

Main features:
- **Username/password login** (custom auth — *not* Supabase Auth).
- **Consent form** with text driven by `config.json`.
- **Timed session** (default 30 min) that auto-ends and logs out.
- **QR code** on the desktop. Scanning it on a phone opens an upload page so the
  participant can take/upload a photo.
- **Live preview** — the uploaded photo appears on the desktop instantly via
  Server-Sent Events (SSE).
- **Gallery** of all the logged-in user's uploads.
- **AI chat** — a "creative idea coach" powered by Google Gemini.
- **Digital whiteboard / workspace** (built but the tab is currently hidden).

### Tech stack
| Layer | Technology |
|-------|-----------|
| Backend | Node.js (ESM) + Express 4 — a single file: `server.js` |
| Database + file storage | Supabase (Postgres + Storage) |
| AI | Google Gemini via `@google/genai` |
| Frontend | Plain HTML/CSS/vanilla JS in `public/` (no build step) |
| Hosting | Render (any Node host works) |

---

## 2. Repository layout

```
qr-id-login-supabase/
├── server.js              # The ENTIRE backend (routes, auth, uploads, AI, SSE)
├── config.json            # Editable runtime settings (timer, consent text, AI prompt)
├── package.json           # Dependencies + the "start" script
├── .env                    # Secrets (NOT committed — you create this)
├── .env.example            # Template for .env  (created in this handoff)
├── supabase-schema.sql     # Recreates the Supabase tables + bucket (created in this handoff)
├── .gitignore             # ignores node_modules, .env, .DS_Store
└── public/                # Static frontend (served by Express)
    ├── html/              # login, consent, qr, upload, gallery, ending, index
    ├── css/               # styles.css (global), workspace.css (whiteboard)
    └── js/                # one JS file per page + shared helpers
```

There is **no build step**. The browser loads the JS files in `public/js`
directly. Editing a file and refreshing is all you need on the frontend.

---

## 3. Prerequisites

- **Node.js 20 or newer** (the `@google/genai` package requires it). Check with `node -v`.
- A **Supabase** account (free tier is fine).
- A **Google AI Studio** API key — only if you want the AI chat to work.
- (For phone testing locally) a tunneling tool like **ngrok**, because a phone
  can't reach `localhost` on your computer.

---

## 4. Supabase setup (database + storage)

The app talks to Supabase from the server using the **service role key**, which
bypasses Row Level Security. So all permission checks happen in `server.js`, and
the database itself is wide open to the server only.

### Step 4.1 — Create the project
1. Go to <https://supabase.com> → **New project**.
2. Pick a name, a strong database password, and a region. Wait for it to finish provisioning.

### Step 4.2 — Create the schema
1. In the Supabase dashboard, open **SQL Editor**.
2. Paste the entire contents of [`supabase-schema.sql`](./supabase-schema.sql) and **Run** it.

This creates three tables and one storage bucket:

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `app_users` | Login accounts | `id`, `username` (unique), `password_hash` (`saltHex:hashHex`, scrypt) |
| `sessions` | One QR upload session each time a QR is generated | `id` (UUID from server), `user_id` |
| `uploads` | Metadata for each uploaded image | `user_id`, `session_id`, `object_path`, `public_url`, `mime_type`, `created_at` |

| Storage bucket | Purpose |
|----------------|---------|
| `uploads` (public) | Holds the actual image files. Files are stored at path `<user_id>/<timestamp>-<random>.<ext>` |

> The bucket **must be public** so the `public_url` links shown in the gallery
> and live preview actually load.

### Step 4.3 — Grab your keys
In the dashboard go to **Project Settings → API** and copy:
- **Project URL** → `SUPABASE_URL`
- **service_role** secret → `SUPABASE_SERVICE_ROLE_KEY`  (keep this secret!)

You'll put these in `.env` (next section).

---

## 5. Configuration: `.env` and `config.json`

There are two separate "config" surfaces. Don't confuse them:

### 5.1 — `.env` (secrets + infrastructure)
Copy the template and fill it in:

```bash
cp .env.example .env
```

| Variable | Required? | What it is |
|----------|-----------|------------|
| `SUPABASE_URL` | **Yes** | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | Server-only admin key |
| `SESSION_SECRET` | **Yes** | Random string used to sign login cookies |
| `SUPABASE_BUCKET` | No | Bucket name, default `uploads` |
| `GOOGLE_API_KEY` | No* | Gemini key. *Required for the AI chat to work* |
| `PUBLIC_BASE_URL` | No | Public URL (no trailing slash) used to build QR links |
| `PORT` | No | Default `3000` (Render sets this automatically) |
| `GOOGLE_CHAT_MODEL` | No | Overrides the AI model from `config.json` |
| `CHAT_MAX_OUTPUT_CHARS` | No | Overrides reply length limit from `config.json` |
| `SUPABASE_ANON_KEY` | No | Present in the template but **not used** by the code |

> The server **refuses to start** if `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
> or `SESSION_SECRET` is missing.

Generate a good `SESSION_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 5.2 — `config.json` (content + behavior, no restart needed)
This file is re-read on **every request**, so you can edit it on a running
server and changes take effect immediately. It controls:

- `timer.durationMinutes` — how long a session lasts (default `30`).
- `consent.*` — all the text shown on the consent page (title, bullets, button labels, etc.).
- `aiChat.model` — which Gemini model to use (`gemini-3-flash-preview`).
- `aiChat.maxOutputTokens` / `maxOutputChars` — limits on the AI reply length.
- `aiChat.welcomeMessage` — the first message shown in the chat box.
- `aiChat.systemPrompt` — the instructions that shape the AI's behavior (the
  "creative idea coach" persona). **Edit this to change what the AI does.**

> Security note: `/api/config` only exposes `timer`, `consent`, and the chat
> `welcomeMessage` to the browser. The `systemPrompt` and any keys stay server-side.

---

## 6. Running locally

```bash
npm install      # install dependencies (Node 20+)
npm start        # runs: node server.js
```

Open <http://localhost:3000>. You'll be redirected to the login page.
Create an account (username ≥ 3 chars, password ≥ 6 chars) and continue through
the flow.

### Testing the phone upload locally
A phone cannot reach your computer's `localhost`. Use a tunnel:

```bash
# in another terminal, after starting the server
ngrok http 3000
```

Then set `PUBLIC_BASE_URL` in `.env` to the https URL ngrok prints (e.g.
`https://abc123.ngrok-free.app`) and restart `npm start`. Now the QR code on
the desktop will point to a URL your phone can actually open.

---

## 7. Deploying to Render

Render runs the same `npm start` command. There is currently **no `render.yaml`**,
so configure it through the dashboard (a manual web service).

### Step 7.1 — Create the service
1. Push this repo to GitHub (make sure `.env` is **not** committed — it's gitignored).
2. In Render: **New → Web Service** and connect the GitHub repo.
3. Settings:
   - **Environment:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Node version:** set to **20** or newer. (Add an env var `NODE_VERSION=20`,
     or commit an `.nvmrc` file containing `20`.)

### Step 7.2 — Add environment variables
In the service's **Environment** tab, add the same variables from your `.env`:

| Key | Value |
|-----|-------|
| `SUPABASE_URL` | your Supabase URL |
| `SUPABASE_SERVICE_ROLE_KEY` | your service role key |
| `SESSION_SECRET` | a long random string |
| `SUPABASE_BUCKET` | `uploads` |
| `GOOGLE_API_KEY` | your Gemini key (if using chat) |
| `PUBLIC_BASE_URL` | `https://<your-service>.onrender.com` |

Do **not** set `PORT` — Render provides it automatically and the server reads it.

### Step 7.3 — Deploy
Render builds and starts the service. Visit `https://<your-service>.onrender.com`.

### Step 7.4 — Recommended production hardening
- **Cookies over HTTPS:** in `server.js`, the login cookie is set with
  `secure: false`. On Render (HTTPS) you should change it to `secure: true` so
  the cookie is only sent over HTTPS:

```33:35:server.js
const app = express();
app.set("trust proxy", true);
```

  `trust proxy` is already enabled (good for Render). Find `setSessionCookie`
  and flip `secure: false` to `secure: true` for production.

- **Free tier sleeps:** Render free web services spin down when idle, so the
  first request after a while is slow. Note that **SSE live preview** relies on a
  persistent connection — long idle periods or instance restarts drop the stream
  (the page reconnects on reload). For reliable demos, use a paid instance.

---

## 8. How the code works (architecture)

Everything backend is in `server.js`. Here's the mental model:

```
Browser (desktop)                 server.js                    Supabase
─────────────────                 ─────────                    ────────
login/signup        ── POST ──►  /api/signup,/api/login  ──►  app_users (read/write)
                                  sets signed "sid" cookie
generate QR         ── GET  ──►  /api/session             ──►  sessions (insert)
                                  returns upload URL
live preview        ── GET  ──►  /api/stream/session/:id   (SSE, kept open)

Phone
─────
scan QR -> upload   ── POST ──►  /api/upload/:sessionId   ──►  Storage bucket + uploads (insert)
                                  broadcasts via SSE  ───────►  desktop preview updates live

Gallery             ── GET  ──►  /api/my-uploads          ──►  uploads (select)
AI chat             ── POST ──►  /api/chat                ──►  Google Gemini
```

### Authentication
- Passwords are hashed with Node's built-in **scrypt** and a per-user salt,
  stored as `saltHex:hashHex` in `app_users.password_hash`.
- On login, the server sets a cookie named `sid` containing
  `base64url(payload).hmacSignature`. The payload is `{ userId, username }` and
  the signature uses `SESSION_SECRET`. No server-side session store is needed —
  the cookie validates itself.
- `requireLogin()` rejects requests with a missing/invalid cookie (HTTP 401).

### Uploads
- `/api/upload/:sessionId` is **not** login-protected — it's reached from the
  phone, which isn't logged in. Security comes from the **unguessable session
  UUID** in the URL. The server resolves the session → owning user, stores the
  file in Storage, and records metadata.
- Limits: images only, **max 6 MB** (enforced by `multer`).

### Realtime (live preview)
- Implemented with **Server-Sent Events**, not Supabase Realtime. The server
  keeps in-memory maps of open connections (`sessionStreams`, `userStreams`) and
  pushes an `image` event when an upload completes. This state is per-instance
  and in-memory, so it does not survive restarts and won't work across multiple
  Render instances.

### AI chat
- `/api/chat` sends the last ~20 turns of conversation plus the system prompt
  from `config.json` to Gemini and returns the reply. Disabled (returns 500) if
  `GOOGLE_API_KEY` is not set.

### Frontend state (browser storage)
| Where | Key | Purpose |
|-------|-----|---------|
| sessionStorage | `consentAccepted`, `tutorialCompleted` | flow gating |
| sessionStorage | `chatHistory_shared` | chat history |
| sessionStorage | `qrCountdownState_v4` | timer state |
| localStorage | `study_consent_v1` | consent record (`participantId`, `agreedAt`) |

> Consent is stored **only in the browser**, not in Supabase. If you need
> consent records saved server-side, that's a feature you'd have to add.

---

## 9. API reference

| Method | Path | Login? | Purpose |
|--------|------|--------|---------|
| GET | `/` | No | Redirects to the login page |
| GET | `/api/config` | No | Public config (timer, consent text, chat welcome) |
| POST | `/api/signup` | No | Create account, sets cookie |
| POST | `/api/login` | No | Log in, sets cookie |
| POST | `/api/logout` | No | Clears cookie |
| GET | `/api/me` | No | Returns current user or `null` |
| GET | `/api/session` | **Yes** | Creates an upload session, returns QR upload URL |
| GET | `/api/stream/session/:sessionId` | **Yes** | SSE live preview for one session |
| GET | `/api/stream/user` | **Yes** | SSE feed of all the user's uploads |
| POST | `/api/upload/:sessionId` | No (UUID-gated) | Phone uploads an image |
| GET | `/api/my-uploads` | **Yes** | List up to 200 of the user's uploads |
| POST | `/api/chat` | **Yes** | Send a message to the AI coach |

---

## 10. Maintenance & common tasks

| I want to… | Do this |
|------------|---------|
| Change the session length | Edit `config.json` → `timer.durationMinutes` (no restart needed) |
| Change the consent text | Edit `config.json` → `consent.*` |
| Change how the AI behaves | Edit `config.json` → `aiChat.systemPrompt` |
| Switch AI models | Edit `config.json` → `aiChat.model`, or set `GOOGLE_CHAT_MODEL` |
| Update a dependency | `npm install <pkg>@latest`, test, commit `package.json` + `package-lock.json` |
| Rotate the Supabase key | Regenerate in Supabase, update `SUPABASE_SERVICE_ROLE_KEY` env var, redeploy |
| Reset all accounts/data | In Supabase SQL Editor: `truncate uploads, sessions, app_users cascade;` and empty the `uploads` bucket |
| See logs in production | Render dashboard → your service → **Logs** |
| Add the whiteboard tab | In `public/html/qr.html`, the workspace tab switch button is commented out — re-enable it |

### Dependencies (from `package.json`)
| Package | Version | Used for |
|---------|---------|----------|
| `express` | ^4.19.2 | web server / routing |
| `@supabase/supabase-js` | ^2.88.0 | database + storage client |
| `@google/genai` | ^1.50.1 | Gemini AI chat (needs Node ≥ 20) |
| `multer` | ^1.4.5-lts.1 | multipart file upload parsing |
| `cookie-parser` | ^1.4.6 | reads the `sid` login cookie |
| `dotenv` | ^16.4.5 | loads `.env` |
| `react-joyride` | ^2.9.3 | listed, but the onboarding tour actually loads React + Joyride from a CDN, so this isn't imported by the code |

Frontend also loads from CDNs at runtime: **qrcodejs** (QR generation) and
**React + react-joyride** via `esm.sh` (the onboarding tour).

---

## 11. Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| Server exits immediately with "Missing env vars" | One of `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET` is not set in `.env` |
| QR code points to `localhost` / phone can't open it | Set `PUBLIC_BASE_URL` to a public URL (ngrok locally, the Render URL in prod) |
| Uploaded images don't display | The `uploads` storage bucket isn't **public**, or RLS/policies block reads |
| AI chat returns "GOOGLE_API_KEY not configured" | Set `GOOGLE_API_KEY` and restart |
| Login works but you get logged out / 401 on next request | Cookie not being sent — on HTTPS set the cookie `secure: true`; check the browser isn't blocking cookies |
| `@google/genai` install/runtime errors | You're on Node < 20. Upgrade Node |
| Live preview never updates | SSE connection dropped (instance restart / idle / multiple instances). Reload the page |

---

## 12. Security notes for the next maintainer

- **Never commit `.env`** — it holds the service role key, which gives full
  access to your Supabase project. It's already in `.gitignore`.
- The `service_role` key bypasses RLS. Treat the server as fully trusted; never
  ship that key to the browser.
- The upload endpoint trusts the session UUID. UUIDs are unguessable, but the
  endpoint is otherwise unauthenticated by design (the phone isn't logged in).
- For production, set the login cookie to `secure: true` (see §7.4).
