// שרת Signaling פשוט עבור WebRTC
// מעביר הודעות בין משתתפים כדי שיוכלו להתחבר ישירות

const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;

// יצירת שרת HTTP פשוט (נדרש ל-Render.com ודומיו)
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Signaling server is running\n');
});

const wss = new WebSocket.Server({ server });

// מבנה הנתונים: חדר -> { peerId -> ws }
const rooms = {};

// יצירת ID ייחודי לכל משתתף
function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

// שליחת הודעה בבטחה
function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

wss.on('connection', (ws) => {
  const peerId = generateId();
  ws.peerId = peerId;
  ws.roomCode = null;

  console.log(`[+] משתתף חדש התחבר: ${peerId}`);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return send(ws, { type: 'error', message: 'הודעה לא תקינה' });
    }

    switch (msg.type) {
      case 'create':
      case 'join': {
        const { room } = msg;
        if (!room || typeof room !== 'string') {
          return send(ws, { type: 'error', message: 'קוד חדר חסר' });
        }

        // אם זה יצירה והחדר קיים - שגיאה (לבטיחות - מונע התנגשויות)
        if (msg.type === 'create' && rooms[room]) {
          return send(ws, { type: 'error', message: 'חדר עם קוד זה כבר קיים' });
        }

        // יצירת חדר אם לא קיים
        if (!rooms[room]) {
          rooms[room] = {};
        }

        // רשימת המשתתפים הקיימים בחדר (לפני שהמצטרף נוסף)
        const existingPeers = Object.keys(rooms[room]);

        // הוספת המשתתף לחדר
        rooms[room][peerId] = ws;
        ws.roomCode = room;

        console.log(`[>] ${peerId} ${msg.type === 'create' ? 'יצר' : 'הצטרף ל'}חדר ${room} (סה"כ: ${Object.keys(rooms[room]).length})`);

        // שלח למצטרף את ה-ID שלו ואת רשימת המשתתפים הקיימים
        send(ws, {
          type: 'joined',
          yourId: peerId,
          room: room,
          peers: existingPeers
        });

        // הודע לכל המשתתפים הקיימים שמישהו חדש הצטרף
        existingPeers.forEach(existingId => {
          send(rooms[room][existingId], {
            type: 'peer-joined',
            peerId: peerId
          });
        });
        break;
      }

      case 'offer':
      case 'answer':
      case 'ice-candidate': {
        const { to } = msg;
        if (!ws.roomCode || !rooms[ws.roomCode] || !rooms[ws.roomCode][to]) {
          return;
        }
        // העבר את ההודעה לנמען עם ציון ממי היא באה
        send(rooms[ws.roomCode][to], {
          ...msg,
          from: peerId
        });
        break;
      }

      default:
        send(ws, { type: 'error', message: 'סוג הודעה לא מוכר' });
    }
  });

  ws.on('close', () => {
    console.log(`[-] ${peerId} התנתק`);
    if (ws.roomCode && rooms[ws.roomCode]) {
      delete rooms[ws.roomCode][peerId];

      // הודע לשאר המשתתפים שהוא עזב
      Object.values(rooms[ws.roomCode]).forEach(peerWs => {
        send(peerWs, { type: 'peer-left', peerId: peerId });
      });

      // אם החדר ריק - מחק אותו
      if (Object.keys(rooms[ws.roomCode]).length === 0) {
        console.log(`[x] חדר ${ws.roomCode} נמחק (ריק)`);
        delete rooms[ws.roomCode];
      }
    }
  });

  ws.on('error', (err) => {
    console.error(`שגיאה עבור ${peerId}:`, err.message);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 שרת Signaling פועל על פורט ${PORT}`);
});
