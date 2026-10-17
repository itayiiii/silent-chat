// שרת Signaling פשוט עבור WebRTC
// מעביר הודעות בין משתתפים כדי שיוכלו להתחבר ישירות. האודיו עצמו לא עובר כאן.
//
// אבטחה (גרסה 3):
// - כל חדר הוא מפתח סודי ואקראי של 16 תווים (בתוך קוד ה-QR / הקישור) - אי אפשר לנחש אותו.
// - לכל חדר יש גם מספר של 4 ספרות. מספר אפשר לנחש, ולכן מי שמקליד מספר "דופק בדלת":
//   מי שבחדר רואה סימן (2 ציורים) ומכניס אותו - או לא.
// - חדר נעול: כל מי שמגיע (גם עם המפתח) דופק בדלת. מי שכבר היה בחדר חוזר עם המפתח האישי שלו.
// - הצטרפות לא יוצרת חדר: מפתח / מספר שלא קיים = "החדר לא נמצא".
// - מי שמנסה הרבה מפתחות / מספרים שלא קיימים נחסם לכמה דקות.
// - עד 8 משתתפים בחדר.
// - ביומן השרת מופיעים רק 4 התווים הראשונים של כל חדר, בלי המספר.

const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const VERSION = 3;
const ROOM_RE = /^[a-km-np-z2-9]{16}$/;   // 16 signs out of 32 = 80 random bits
const MAX_PEERS = 8;
const FAIL_WINDOW_MS = 10 * 60 * 1000;    // failed joins are counted per address for 10 minutes...
const MAX_FAILS = 20;                     // ...and after 20 of them that address waits
const MAX_FAILS_PER_SOCKET = 5;
const PING_MS = 25 * 1000;                // keeps idle connections open (and finds dead ones)
const KNOCK_MS = 3 * 60 * 1000;           // nobody answers the door in 3 minutes: "try again"
const MAX_KNOCKS = 5;                     // people waiting at one door at the same time
// the knocker's sign: he shows it and says "כן, זה אני"; the people inside see the same two pictures
const SIGNS = ['🍕', '🚲', '🌵', '🎸', '🐙', '🍉', '⚽', '🚀', '🦊', '🍩', '🎈', '🐢',
  '🌻', '🍔', '🎧', '🐬', '🍓', '🦁', '🧲', '🍋', '🎯', '🐝', '🍄', '🧁']

// יצירת שרת HTTP פשוט (נדרש ל-Render.com ודומיו)
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`Signaling server is running (v${VERSION})\n`);
});

const wss = new WebSocket.Server({ server, maxPayload: 64 * 1024 });

// חדר -> { peers: Map(peerId -> ws), locked, keys: Set, code, knocks: Map(id -> knock) }
const rooms = new Map();
// מספר של 4 ספרות -> חדר
const codes = new Map();
// כתובת -> { n, since } - ניסיונות הצטרפות שנכשלו
const fails = new Map();

function newId(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}
function short(room) {
  return String(room).slice(0, 4) + '…';
}
function newCode() {
  for (let i = 0; i < 60; i++) {
    const c = String(1000 + crypto.randomInt(9000));
    if (!codes.has(c)) return c;
  }
  return null;   // (almost all 9000 numbers taken: this room works with the QR code / link only)
}
function newSign() {
  return SIGNS[crypto.randomInt(SIGNS.length)] + SIGNS[crypto.randomInt(SIGNS.length)];
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

// מכניס את ws לחדר: שולח לו את מי שכבר בפנים, ומודיע להם עליו
function enter(ws, room, r, how) {
  const existingPeers = [...r.peers.keys()];
  r.peers.set(ws.peerId, ws);
  ws.roomCode = room;
  ws.knock = null;
  const key = newId(16);   // מפתח אישי: מאפשר לחזור גם כשהחדר נעול
  r.keys.add(key);
  console.log(`[>] ${ws.peerId} ${how === 'create' ? 'יצר' : how === 'knock' ? 'הוכנס ל' : 'הצטרף ל'}חדר ${short(room)} (סה"כ: ${r.peers.size})`);
  send(ws, {
    type: 'joined',
    yourId: ws.peerId,
    room: room,
    peers: existingPeers,
    locked: r.locked,
    key: key,
    code: r.code,
    knocked: how === 'knock'
  });
  existingPeers.forEach(existingId => {
    send(r.peers.get(existingId), { type: 'peer-joined', peerId: ws.peerId });
  });
}

// דפיקה בדלת: מי שבחדר מקבל "מישהו דופק" עם סימן, ומכניס אותו - או לא
function knock(ws, room, r, via) {
  if (ws.knock) return send(ws, { type: 'error', code: 'busy', message: 'כבר דפקת בדלת — מחכים לתשובה' });
  if (r.peers.size >= MAX_PEERS) {
    return send(ws, { type: 'error', code: 'full', message: `החדר מלא (עד ${MAX_PEERS} משתתפים)` });
  }
  if (r.knocks.size >= MAX_KNOCKS) {
    return send(ws, { type: 'error', code: 'door-busy', message: 'כמה אנשים כבר מחכים בדלת. נסו שוב עוד רגע' });
  }
  const k = { id: newId(6), ws, room, sign: newSign(), via };
  k.timer = setTimeout(() => endKnock(r, k, { type: 'error', code: 'no-answer', message: 'אף אחד לא ענה בדלת. נסו שוב' }, { gone: true }), KNOCK_MS);
  r.knocks.set(k.id, k);
  ws.knock = k;
  console.log(`[🔔] ${ws.peerId} דופק בחדר ${short(room)} (${via})`);
  send(ws, { type: 'knocking', sign: k.sign, via });
  r.peers.forEach(p => send(p, { type: 'knock', id: k.id, sign: k.sign, via }));
}
function endKnock(r, k, toKnocker, done) {
  clearTimeout(k.timer);
  r.knocks.delete(k.id);
  if (k.ws.knock === k) k.ws.knock = null;
  if (toKnocker) send(k.ws, toKnocker);
  r.peers.forEach(p => send(p, Object.assign({ type: 'knock-done', id: k.id, sign: k.sign }, done || {})));
}

wss.on('connection', (ws, req) => {
  ws.peerId = newId(6);
  ws.roomCode = null;
  ws.addr = addressOf(req);
  ws.fails = 0;
  ws.knock = null;
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
        if (ws.roomCode || ws.knock) return send(ws, { type: 'error', code: 'busy', message: 'כבר נמצאים בחדר' });
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
          r = { peers: new Map(), locked: false, keys: new Set(), code: newCode(), knocks: new Map() };
          rooms.set(room, r);
          if (r.code) codes.set(r.code, room);
          return enter(ws, room, r, 'create');
        }
        if (!r) return fail('not-found', 'החדר לא נמצא — אולי הוא כבר נסגר. בקשו מהחבר להציג את הקוד שוב');
        const wasInside = typeof msg.key === 'string' && r.keys.has(msg.key);
        if (r.locked && !wasInside) return knock(ws, room, r, 'key');   // locked: knock on the door
        if (r.peers.size >= MAX_PEERS) {
          return send(ws, { type: 'error', code: 'full', message: `החדר מלא (עד ${MAX_PEERS} משתתפים)` });
        }
        enter(ws, room, r, 'join');
        break;
      }

      case 'knock': {   // a 4-digit number
        if (ws.roomCode || ws.knock) return send(ws, { type: 'error', code: 'busy', message: 'כבר נמצאים בחדר' });
        if (waiting(ws.addr)) {
          return send(ws, { type: 'error', code: 'slow-down', message: 'יותר מדי ניסיונות. נסו שוב בעוד כמה דקות' });
        }
        const room = typeof msg.code === 'string' && /^\d{4}$/.test(msg.code) ? codes.get(msg.code) : null;
        const r = room && rooms.get(room);
        if (!r) return fail('not-found', 'אין חדר עם המספר הזה — בדקו את המספר אצל החבר');
        knock(ws, room, r, 'number');
        break;
      }

      case 'let-in': {   // someone inside answers the door
        const r = ws.roomCode && rooms.get(ws.roomCode);
        const k = r && r.knocks.get(msg.id);
        if (!k) return;   // answered already (on another phone), or the knocker left
        if (!msg.ok) {
          addFail(k.ws.addr);
          return endKnock(r, k, { type: 'error', code: 'denied', message: 'לא הכניסו אותך לחדר' }, { ok: false, by: ws.peerId });
        }
        if (r.peers.size >= MAX_PEERS) {
          return endKnock(r, k, { type: 'error', code: 'full', message: `החדר מלא (עד ${MAX_PEERS} משתתפים)` }, { gone: true });
        }
        endKnock(r, k, null, { ok: true, by: ws.peerId });
        enter(k.ws, k.room, r, 'knock');
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
    if (ws.knock) {   // gave up waiting at the door
      const kr = rooms.get(ws.knock.room);
      if (kr) endKnock(kr, ws.knock, null, { gone: true });
    }
    const r = ws.roomCode && rooms.get(ws.roomCode);
    if (!r) return;
    r.peers.delete(ws.peerId);

    // הודע לשאר המשתתפים שהוא עזב
    r.peers.forEach(peerWs => send(peerWs, { type: 'peer-left', peerId: ws.peerId }));

    // אם החדר ריק - מחק אותו (ומי שמחכה בדלת שומע שהחדר נסגר)
    if (r.peers.size === 0) {
      console.log(`[x] חדר ${short(ws.roomCode)} נמחק (ריק)`);
      r.knocks.forEach(k => endKnock(r, k, { type: 'error', code: 'not-found', message: 'החדר נסגר' }));
      if (r.code) codes.delete(r.code);
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
