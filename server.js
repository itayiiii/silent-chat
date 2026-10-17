// שרת Signaling פשוט עבור WebRTC
// מעביר הודעות בין משתתפים כדי שיוכלו להתחבר ישירות. האודיו עצמו לא עובר כאן.
//
// אבטחה (גרסה 2):
// - כל חדר הוא מפתח סודי ואקראי של 16 תווים (בתוך קוד ה-QR / הקישור) - אי אפשר לנחש אותו.
// - הצטרפות לא יוצרת חדר: מפתח שלא קיים = "החדר לא נמצא".
// - מי שמנסה הרבה מפתחות שלא קיימים נחסם לכמה דקות.
// - עד 8 משתתפים בחדר, ואפשר לנעול חדר (מי שכבר היה בו יכול לחזור).
// - ביומן השרת מופיעים רק 4 התווים הראשונים של כל חדר.

const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const VERSION = 2;
const ROOM_RE = /^[a-km-np-z2-9]{16}$/;   // 16 signs out of 32 = 80 random bits
const MAX_PEERS = 8;
const FAIL_WINDOW_MS = 10 * 60 * 1000;    // failed joins are counted per address for 10 minutes...
const MAX_FAILS = 20;                     // ...and after 20 of them that address waits
const MAX_FAILS_PER_SOCKET = 5;
const PING_MS = 25 * 1000;                // keeps idle connections open (and finds dead ones)

// יצירת שרת HTTP פשוט (נדרש ל-Render.com ודומיו)
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`Signaling server is running (v${VERSION})\n`);
});

const wss = new WebSocket.Server({ server, maxPayload: 64 * 1024 });

// חדר -> { peers: Map(peerId -> ws), locked, keys: Set }
const rooms = new Map();
// כתובת -> { n, since } - ניסיונות הצטרפות שנכשלו
const fails = new Map();

function newId(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}
function short(room) {
  return String(room).slice(0, 4) + '…';
}

// שליחת הודעה בבטחה
function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function addressOf(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || (req.socket && req.socket.remoteAddress) || '?';
}
function waiting(addr) {
  const f = fails.get(addr);
  if (!f) return false;
  if (Date.now() - f.since > FAIL_WINDOW_MS) {
    fails.delete(addr);
    return false;
  }
  return f.n >= MAX_FAILS;
}
function addFail(addr) {
  const f = fails.get(addr);
  if (!f || Date.now() - f.since > FAIL_WINDOW_MS) fails.set(addr, { n: 1, since: Date.now() });
  else f.n++;
}

wss.on('connection', (ws, req) => {
  ws.peerId = newId(6);
  ws.roomCode = null;
  ws.addr = addressOf(req);
  ws.fails = 0;
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });

  console.log(`[+] משתתף חדש התחבר: ${ws.peerId}`);
  send(ws, { type: 'hello', v: VERSION, maxPeers: MAX_PEERS });

  function fail(code, message) {
    addFail(ws.addr);
    ws.fails++;
    send(ws, { type: 'error', code, message });
    if (ws.fails >= MAX_FAILS_PER_SOCKET) ws.close(4000, 'too many tries');
  }

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return send(ws, { type: 'error', message: 'הודעה לא תקינה' });
    }
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case 'create':
      case 'join': {
        if (ws.roomCode) return send(ws, { type: 'error', code: 'busy', message: 'כבר נמצאים בחדר' });
        const room = msg.room;
        if (typeof room !== 'string' || !ROOM_RE.test(room)) {
          // a 6-digit code from an older app
          return send(ws, { type: 'error', code: 'old-app', message: 'הגרסה של האפליקציה ישנה — עדכנו אותה ונסו שוב' });
        }
        if (waiting(ws.addr)) {
          return send(ws, { type: 'error', code: 'slow-down', message: 'יותר מדי ניסיונות. נסו שוב בעוד כמה דקות' });
        }

        let r = rooms.get(room);
        if (msg.type === 'create') {
          if (r) return fail('exists', 'חדר עם קוד זה כבר קיים');
          r = { peers: new Map(), locked: false, keys: new Set() };
          rooms.set(room, r);
        } else {
          if (!r) return fail('not-found', 'החדר לא נמצא — אולי הוא כבר נסגר. בקשו מהחבר להציג את הקוד שוב');
          const wasInside = typeof msg.key === 'string' && r.keys.has(msg.key);
          if (r.locked && !wasInside) return fail('locked', 'החדר נעול 🔒 — בקשו ממישהו בחדר לפתוח אותו');
          if (r.peers.size >= MAX_PEERS) {
            return send(ws, { type: 'error', code: 'full', message: `החדר מלא (עד ${MAX_PEERS} משתתפים)` });
          }
        }

        // רשימת המשתתפים הקיימים בחדר (לפני שהמצטרף נוסף)
        const existingPeers = [...r.peers.keys()];

        // הוספת המשתתף לחדר + מפתח אישי שמאפשר לו לחזור גם כשהחדר נעול
        r.peers.set(ws.peerId, ws);
        ws.roomCode = room;
        const key = newId(16);
        r.keys.add(key);

        console.log(`[>] ${ws.peerId} ${msg.type === 'create' ? 'יצר' : 'הצטרף ל'}חדר ${short(room)} (סה"כ: ${r.peers.size})`);

        // שלח למצטרף את ה-ID שלו ואת רשימת המשתתפים הקיימים
        send(ws, {
          type: 'joined',
          yourId: ws.peerId,
          room: room,
          peers: existingPeers,
          locked: r.locked,
          key: key
        });

        // הודע לכל המשתתפים הקיימים שמישהו חדש הצטרף
        existingPeers.forEach(existingId => {
          send(r.peers.get(existingId), { type: 'peer-joined', peerId: ws.peerId });
        });
        break;
      }

      case 'lock': {
        const r = ws.roomCode && rooms.get(ws.roomCode);
        if (!r) return;
        r.locked = !!msg.locked;
        console.log(`[${r.locked ? '🔒' : '🔓'}] חדר ${short(ws.roomCode)}`);
        r.peers.forEach(peerWs => send(peerWs, { type: 'lock', locked: r.locked, by: ws.peerId }));
        break;
      }

      case 'offer':
      case 'answer':
      case 'ice-candidate': {
        const r = ws.roomCode && rooms.get(ws.roomCode);
        const target = r && r.peers.get(msg.to);
        if (!target) return;
        // העבר את ההודעה לנמען עם ציון ממי היא באה
        send(target, { ...msg, from: ws.peerId });
        break;
      }

      default:
        send(ws, { type: 'error', message: 'סוג הודעה לא מוכר' });
    }
  });

  ws.on('close', () => {
    console.log(`[-] ${ws.peerId} התנתק`);
    const r = ws.roomCode && rooms.get(ws.roomCode);
    if (!r) return;
    r.peers.delete(ws.peerId);

    // הודע לשאר המשתתפים שהוא עזב
    r.peers.forEach(peerWs => send(peerWs, { type: 'peer-left', peerId: ws.peerId }));

    // אם החדר ריק - מחק אותו
    if (r.peers.size === 0) {
      console.log(`[x] חדר ${short(ws.roomCode)} נמחק (ריק)`);
      rooms.delete(ws.roomCode);
    }
  });

  ws.on('error', (err) => {
    console.error(`שגיאה עבור ${ws.peerId}:`, err.message);
  });
});

// כל 25 שניות: "פינג" לכל טלפון. החיבור לא נסגר בגלל שקט, וטלפון שלא עונה פעמיים - מנותק.
const pinger = setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.alive === false && ws.missed >= 1) return ws.terminate();
    ws.missed = ws.alive ? 0 : (ws.missed || 0) + 1;
    ws.alive = false;
    try { ws.ping(); } catch (e) { /* closing anyway */ }
  });
  const now = Date.now();
  fails.forEach((f, addr) => { if (now - f.since > FAIL_WINDOW_MS) fails.delete(addr); });
}, PING_MS);
wss.on('close', () => clearInterval(pinger));

server.listen(PORT, () => {
  console.log(`🚀 שרת Signaling (גרסה ${VERSION}) פועל על פורט ${PORT}`);
});
