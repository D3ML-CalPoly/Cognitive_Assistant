import dotenv from "dotenv";
dotenv.config();

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import express from "express";
import cookieParser from "cookie-parser";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";

// Backend for the QR upload app:
// auth + sessioned uploads + realtime streams + gallery + AI chat.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Editable runtime config (timer length, consent text, AI prompt, ...).
// Re-read on every access so edits to config.json take effect without restart.
const CONFIG_PATH = path.join(__dirname, "config.json");

function loadAppConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    console.error("[config] failed to read config.json:", e?.message);
    return {};
  }
}

const app = express();
app.set("trust proxy", true);

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_BUCKET || "uploads";
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SESSION_SECRET) {
  console.error("Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SESSION_SECRET");
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const genai = GOOGLE_API_KEY ? new GoogleGenAI({ apiKey: GOOGLE_API_KEY }) : null;

function cleanModelText(text) {
  return String(text || "")
    .replace(/\*\*/g, "")
    .replace(/\|/g, "")
    .trim();
}

app.use(express.json());
app.use(cookieParser());

app.get("/", (req, res) => {
  res.redirect(302, "/html/index.html");
});

// Public config for the front-end (timer, consent text, chat welcome message).
// Server-side secrets and the full system prompt are intentionally not exposed.
app.get("/api/config", (_req, res) => {
  const cfg = loadAppConfig();
  const ai = cfg.aiChat || {};
  res.json({
    timer: cfg.timer || {},
    consent: cfg.consent || {},
    aiChat: {
      welcomeMessage: ai.welcomeMessage || ""
    }
  });
});

app.use(express.static(path.join(__dirname, "public")));

// -------------------- Simple cookie session (server-side validation) --------------------
// Cookie holds a signed payload: base64(json) + HMAC signature.
// This avoids storing sessions in memory for the demo.
function hmac(data) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("hex");
}

function setSessionCookie(res, payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj), "utf8").toString("base64url");
  const sig = hmac(payload);
  const value = `${payload}.${sig}`;

  res.cookie("sid", value, {
    httpOnly: true,
    sameSite: "lax",
    secure: false, // set true if you are on HTTPS in production
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
}

function clearSessionCookie(res) {
  res.clearCookie("sid");
}

function getSession(req) {
  const raw = req.cookies?.sid;
  if (!raw) return null;

  const parts = raw.split(".");
  if (parts.length !== 2) return null;

  const [payload, sig] = parts;
  if (hmac(payload) !== sig) return null;

  try {
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!obj?.userId) return null;
    return obj;
  } catch {
    return null;
  }
}

function requireLogin(req, res) {
  const s = getSession(req);
  if (!s) {
    res.status(401).json({ error: "Not logged in" });
    return null;
  }
  return s;
}

// -------------------- Password hashing --------------------
// Use scrypt (built-in) with per-user salt.
function hashPassword(password, saltHex) {
  const salt = Buffer.from(saltHex, "hex");
  const derived = crypto.scryptSync(password, salt, 64);
  return derived.toString("hex");
}

function newSaltHex() {
  return crypto.randomBytes(16).toString("hex");
}

// Store hash as: saltHex:hashHex
function makeStoredHash(password) {
  const saltHex = newSaltHex();
  const hashHex = hashPassword(password, saltHex);
  return `${saltHex}:${hashHex}`;
}

function verifyPassword(password, stored) {
  const [saltHex, hashHex] = (stored || "").split(":");
  if (!saltHex || !hashHex) return false;
  const computed = hashPassword(password, saltHex);
  return crypto.timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(hashHex, "hex"));
}

// -------------------- SSE for realtime updates --------------------
const sessionStreams = new Map(); // sessionId -> Set<res>
const userStreams = new Map();    // userId -> Set<res>

function sseInit(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive"
  });
  res.write("event: ping\ndata: {}\n\n");
}

function sseSend(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function addStream(map, key, res) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(res);
}

function removeStream(map, key, res) {
  const set = map.get(key);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) map.delete(key);
}

function broadcast(map, key, event, data) {
  const set = map.get(key);
  if (!set) return;
  for (const res of set) sseSend(res, event, data);
}

// -------------------- Helpers --------------------
function getPublicBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
}

function safeExtFromMime(mime) {
  switch (mime) {
    case "image/jpeg": return ".jpg";
    case "image/png": return ".png";
    case "image/webp": return ".webp";
    case "image/gif": return ".gif";
    case "image/heic": return ".heic";
    case "image/heif": return ".heif";
    default: return "";
  }
}

// -------------------- Auth API (username + password) --------------------
app.post("/api/signup", async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");

  if (username.length < 3) return res.status(400).json({ error: "Username must be at least 3 characters" });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

  const storedHash = makeStoredHash(password);

  const { data, error } = await supabaseAdmin
    .from("app_users")
    .insert({ username, password_hash: storedHash })
    .select("id, username")
    .single();

  if (error) {
    const msg = (error.message || "").includes("duplicate") ? "Username already taken" : error.message;
    return res.status(400).json({ error: msg });
  }

  setSessionCookie(res, { userId: data.id, username: data.username });
  res.json({ ok: true, user: { id: data.id, username: data.username } });
});

app.post("/api/login", async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");

  const { data, error } = await supabaseAdmin
    .from("app_users")
    .select("id, username, password_hash")
    .eq("username", username)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(400).json({ error: "Invalid username or password" });

  if (!verifyPassword(password, data.password_hash)) {
    return res.status(400).json({ error: "Invalid username or password" });
  }

  setSessionCookie(res, { userId: data.id, username: data.username });
  res.json({ ok: true, user: { id: data.id, username: data.username } });
});

app.post("/api/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  const s = getSession(req);
  if (!s) return res.json({ user: null });
  res.json({ user: { id: s.userId, username: s.username } });
});

// -------------------- Session + QR --------------------
app.get("/api/session", async (req, res) => {
  const s = requireLogin(req, res);
  if (!s) return;

  // Create a one-time upload session used by QR/upload flow.
  const sessionId = crypto.randomUUID();

  const { error } = await supabaseAdmin.from("sessions").insert({
    id: sessionId,
    user_id: s.userId
  });

  if (error) return res.status(500).json({ error: error.message });

  const uploadUrl = `${getPublicBaseUrl(req)}/html/upload.html?session=${encodeURIComponent(sessionId)}`;
  res.json({ sessionId, uploadUrl });
});

// SSE: desktop listens for new upload in the current session
app.get("/api/stream/session/:sessionId", (req, res) => {
  const s = requireLogin(req, res);
  if (!s) return;

  const sessionId = req.params.sessionId;
  sseInit(res);

  addStream(sessionStreams, sessionId, res);

  req.on("close", () => {
    removeStream(sessionStreams, sessionId, res);
  });
});

// SSE: gallery listens for new uploads for the user
app.get("/api/stream/user", (req, res) => {
  const s = requireLogin(req, res);
  if (!s) return;

  sseInit(res);
  addStream(userStreams, s.userId, res);

  req.on("close", () => {
    removeStream(userStreams, s.userId, res);
  });
});

// -------------------- Upload endpoint (phone) --------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith("image/")) return cb(null, true);
    cb(new Error("Only image uploads are allowed."));
  }
});

app.post("/api/upload/:sessionId", upload.single("image"), async (req, res) => {
  try {
    const sessionId = req.params.sessionId;

    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    // session -> user_id
    const { data: sess, error: sErr } = await supabaseAdmin
      .from("sessions")
      .select("id, user_id")
      .eq("id", sessionId)
      .maybeSingle();

    if (sErr) return res.status(500).json({ error: sErr.message });
    if (!sess) return res.status(404).json({ error: "Session not found" });

    const ext =
      safeExtFromMime(req.file.mimetype) ||
      (path.extname(req.file.originalname || "").match(/^\.[a-zA-Z0-9]+$/)
        ? path.extname(req.file.originalname)
        : "");

    const objectPath = `${sess.user_id}/${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;

    // Upload to Storage
    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(objectPath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      });

    if (upErr) return res.status(500).json({ error: upErr.message });

    const { data: urlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(objectPath);
    const publicUrl = urlData.publicUrl;

    // Insert metadata
    const { data: row, error: dbErr } = await supabaseAdmin
      .from("uploads")
      .insert({
        user_id: sess.user_id,
        session_id: sessionId,
        object_path: objectPath,
        public_url: publicUrl,
        mime_type: req.file.mimetype
      })
      .select("id, public_url, created_at, session_id")
      .single();

    if (dbErr) return res.status(500).json({ error: dbErr.message });

    // Push realtime updates to active QR page and gallery listeners.
    broadcast(sessionStreams, sessionId, "image", { publicUrl: row.public_url, createdAt: row.created_at });
    broadcast(userStreams, sess.user_id, "image", { publicUrl: row.public_url, createdAt: row.created_at });

    res.json({ ok: true, publicUrl });
  } catch (e) {
    res.status(500).json({ error: e?.message || "Upload failed" });
  }
});

// Gallery API: list user's uploads
app.get("/api/my-uploads", async (req, res) => {
  const s = requireLogin(req, res);
  if (!s) return;

  const { data, error } = await supabaseAdmin
    .from("uploads")
    .select("id, public_url, created_at")
    .eq("user_id", s.userId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ uploads: data });
});

// -------------------- AI chat (Google Gemini) --------------------
app.post("/api/chat", async (req, res) => {
  const s = requireLogin(req, res);
  if (!s) return;

  if (!genai) {
    return res.status(500).json({ error: "GOOGLE_API_KEY not configured on server." });
  }

  const history = Array.isArray(req.body?.history) ? req.body.history : [];
  const message = String(req.body?.message || "").trim();

  if (!message) return res.status(400).json({ error: "Message is required." });

  const contents = [
    ...history
      .filter((m) => m && typeof m.text === "string" && (m.role === "user" || m.role === "model"))
      .map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    { role: "user", parts: [{ text: message }] }
  ];

  // Read AI settings from the editable config on every request so changes to
  // config.json (prompt, model, limits) take effect without a server restart.
  const cfg = loadAppConfig();
  const ai = cfg.aiChat || {};
  const chatModel = process.env.GOOGLE_CHAT_MODEL || ai.model || "gemini-2.5-flash-preview";
  const maxOutputTokens = Number(ai.maxOutputTokens) || 1200;
  const maxOutputChars = Number(process.env.CHAT_MAX_OUTPUT_CHARS) || Number(ai.maxOutputChars) || 2000;
  const systemInstruction = String(ai.systemPrompt || "").trim();

  try {
    const response = await genai.models.generateContent({
      model: chatModel,
      config: {
        systemInstruction,
        maxOutputTokens
      },
      contents
    });

    const rawText = cleanModelText(response?.text);
    console.log("[chat] model:", chatModel, "len:", rawText.length);
    if (!rawText) {
      console.log("[chat] empty response object:", JSON.stringify(response).slice(0, 500));
      return res.status(500).json({ error: "Model returned empty response. Try a different model." });
    }
    const text =
      rawText.length > maxOutputChars
        ? rawText.slice(0, maxOutputChars - 1).trimEnd() + "…"
        : rawText;
    res.json({ reply: text });
  } catch (e) {
    console.error("[chat] error:", e?.message);
    res.status(500).json({ error: e?.message || "AI request failed" });
  }
});

// Multer errors
app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err?.message || "Bad request" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
