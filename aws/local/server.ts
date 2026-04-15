/**
 * Local development server — mirrors the AWS API Gateway WebSocket + Lambda architecture.
 * WebSocket on ws://localhost:3001 and HTTP on http://localhost:3001.
 *
 * Run with: pnpm dev  (uses tsx watch)
 */
import * as http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  chatId: string;
  author: string;
  to?: string;
  type: "text" | "image";
  text?: string;
  imageUrl?: string;
  timestamp: number;
}

interface User {
  userId: string;
  email: string;
  username: string;
  password: string;
  token: string;
  publicKeyJwk?: string;
}

interface SignalRecord {
  to: string;
  from: string;
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

// ── In-memory stores ──────────────────────────────────────────────────────────

const connections = new Map<string, WebSocket>();
// chatId -> messages (sorted by timestamp)
const messages = new Map<string, Message[]>();
// email -> user
const users = new Map<string, User>([
  ["alice@apelsin.local", { userId: uuidv4(), email: "alice@apelsin.local", username: "alice", password: "alice123", token: uuidv4() }],
  ["bob@apelsin.local",   { userId: uuidv4(), email: "bob@apelsin.local",   username: "bob",   password: "bob123",   token: uuidv4() }],
]);
// to -> signal[]
const signals = new Map<string, SignalRecord[]>();

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeChatId(chatId: string): string {
  const parts = chatId.trim().split("__");
  if (parts.length === 2) {
    return [parts[0].trim().toLowerCase(), parts[1].trim().toLowerCase()].sort().join("__");
  }
  return chatId.trim().toLowerCase();
}

function fanOut(message: Message) {
  const notification = JSON.stringify({ type: "notification", messageId: message.id, timestamp: message.timestamp });
  for (const [id, ws] of connections) {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(notification);
      } else {
        connections.delete(id);
      }
    } catch {
      connections.delete(id);
    }
  }
}

function jsonResponse(res: http.ServerResponse, body: unknown, status = 200) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

// ── HTTP handler ──────────────────────────────────────────────────────────────

async function httpHandler(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost:3001");
  const pathname = url.pathname;
  const method = req.method ?? "GET";

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    });
    res.end();
    return;
  }

  // GET /api/messages
  if (method === "GET" && pathname === "/api/messages") {
    const chatId = url.searchParams.get("chatId");
    const since = url.searchParams.get("since");
    if (!chatId) return jsonResponse(res, { error: "chatId is required" }, 400);

    const normalized = normalizeChatId(chatId);
    let msgs = messages.get(normalized) ?? [];
    if (since) {
      const sinceTs = Number(since);
      msgs = msgs.filter((m) => m.timestamp > sinceTs);
    }
    return jsonResponse(res, msgs);
  }

  // POST /api/messages
  if (method === "POST" && pathname === "/api/messages") {
    const body = (await readBody(req)) as Record<string, unknown>;
    const author = (typeof body.author === "string" ? body.author : "").trim().toLowerCase();
    const chatId = typeof body.chatId === "string" ? normalizeChatId(body.chatId) : "";
    if (!author || !chatId || !body.type) return jsonResponse(res, { error: "Missing required fields" }, 400);

    const message: Message = {
      id: uuidv4(),
      chatId,
      author,
      to: typeof body.to === "string" ? body.to.trim().toLowerCase() : undefined,
      type: body.type as "text" | "image",
      text: typeof body.text === "string" ? body.text : undefined,
      imageUrl: typeof body.imageUrl === "string" ? body.imageUrl : undefined,
      timestamp: Date.now(),
    };

    const list = messages.get(chatId) ?? [];
    list.push(message);
    // Keep last 1000
    if (list.length > 1000) list.splice(0, list.length - 1000);
    messages.set(chatId, list);

    fanOut(message);
    return jsonResponse(res, message, 201);
  }

  // POST /api/auth/register
  if (method === "POST" && pathname === "/api/auth/register") {
    const body = (await readBody(req)) as Record<string, unknown>;
    const email = (typeof body.email === "string" ? body.email : "").trim().toLowerCase();
    const password = (typeof body.password === "string" ? body.password : "").trim();
    if (!email || !password) return jsonResponse(res, { error: "Email and password are required" }, 400);
    if (users.has(email)) return jsonResponse(res, { error: "User with this email already exists" }, 409);

    const user: User = { userId: uuidv4(), email, username: email.split("@")[0] ?? email, password, token: uuidv4() };
    users.set(email, user);
    return jsonResponse(res, { message: "User registered successfully", userId: user.userId, token: user.token, email }, 201);
  }

  // POST /api/auth/login
  if (method === "POST" && pathname === "/api/auth/login") {
    const body = (await readBody(req)) as Record<string, unknown>;
    const email = (typeof body.email === "string" ? body.email : "").trim().toLowerCase();
    const password = (typeof body.password === "string" ? body.password : "").trim();
    const user = users.get(email);
    if (!user || user.password !== password) return jsonResponse(res, { error: "Invalid user or password" }, 401);
    return jsonResponse(res, { message: "Authentication successful", token: user.token, userId: user.userId, email });
  }

  // GET /api/users
  if (method === "GET" && pathname === "/api/users") {
    const exclude = (url.searchParams.get("excludeEmail") ?? "").toLowerCase();
    const result = [...users.values()]
      .filter((u) => u.email !== exclude)
      .map((u) => ({ userId: u.userId, email: u.email, username: u.username }));
    return jsonResponse(res, result);
  }

  // POST /api/users/public-key
  if (method === "POST" && pathname === "/api/users/public-key") {
    const body = (await readBody(req)) as Record<string, unknown>;
    const username = (typeof body.username === "string" ? body.username : "").trim().toLowerCase();
    if (!username || !body.publicKeyJwk) return jsonResponse(res, { error: "username and publicKeyJwk are required" }, 400);

    const user = [...users.values()].find((u) => u.username === username);
    if (!user) return jsonResponse(res, { error: "User not found" }, 404);

    user.publicKeyJwk = JSON.stringify(body.publicKeyJwk);
    return jsonResponse(res, { message: "Public key stored" });
  }

  // GET /api/users/public-key/:username
  const pkMatch = pathname.match(/^\/api\/users\/public-key\/(.+)$/);
  if (method === "GET" && pkMatch) {
    const username = decodeURIComponent(pkMatch[1]).trim().toLowerCase();
    const user = [...users.values()].find((u) => u.username === username);
    if (!user?.publicKeyJwk) return jsonResponse(res, { error: "Public key not found" }, 404);
    return jsonResponse(res, { username, publicKeyJwk: JSON.parse(user.publicKeyJwk) });
  }

  // POST /api/signal
  if (method === "POST" && pathname === "/api/signal") {
    const body = (await readBody(req)) as Record<string, unknown>;
    if (!body.to || !body.from || !body.type) return jsonResponse(res, { error: "Missing required fields" }, 400);

    const signal: SignalRecord = {
      to: body.to as string,
      from: body.from as string,
      type: body.type as string,
      data: (body.data ?? {}) as Record<string, unknown>,
      timestamp: Date.now(),
    };
    const list = signals.get(signal.to) ?? [];
    list.push(signal);
    signals.set(signal.to, list);
    return jsonResponse(res, { message: "Signal sent" }, 201);
  }

  // GET /api/signal/:peerId
  const sigMatch = pathname.match(/^\/api\/signal\/(.+)$/);
  if (method === "GET" && sigMatch) {
    const peerId = decodeURIComponent(sigMatch[1]);
    const list = signals.get(peerId) ?? [];
    signals.delete(peerId); // one-time delivery
    return jsonResponse(res, list);
  }

  jsonResponse(res, { error: "Not found" }, 404);
}

// ── WebSocket server ──────────────────────────────────────────────────────────

const httpServer = http.createServer((req, res) => {
  httpHandler(req, res).catch((e) => {
    console.error("[HTTP] Error:", e);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal server error" }));
  });
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  const connectionId = uuidv4();
  connections.set(connectionId, ws);
  console.log(`[WS] Connected: ${connectionId} (total: ${connections.size})`);

  ws.send(JSON.stringify({ type: "connected" }));

  ws.on("close", () => {
    connections.delete(connectionId);
    console.log(`[WS] Disconnected: ${connectionId} (total: ${connections.size})`);
  });

  ws.on("error", () => {
    connections.delete(connectionId);
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
httpServer.listen(PORT, () => {
  console.log(`\n🟢 Local dev server running`);
  console.log(`   HTTP : http://localhost:${PORT}`);
  console.log(`   WS   : ws://localhost:${PORT}\n`);
  console.log(`   Set in your .env:`);
  console.log(`   VITE_API_BASE_URL=http://localhost:${PORT}`);
  console.log(`   VITE_WS_URL=ws://localhost:${PORT}\n`);
});
