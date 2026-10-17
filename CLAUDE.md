# שיחה שקטה (Silent Chat) — הערות ל-Claude

- **עברית בלבד מול איתי.** כל הודעה שהוא קורא — תשובה, עדכון, שורת סטטוס קצרה, הסיכום בסוף משימה — בעברית. גם אחרי שהשיחה סוכמה / נדחסה: הסיכום כתוב באנגלית — לא לעבור בגללו לאנגלית. אנגלית רק בתוך קוד, פקודות ושמות קבצים. איתי ביקש את זה כמה פעמים ("ביקשתי את זה כמה פעמים לא לכתוב לי באנגלית", 17/10/2026).
- **Hebrew only to Itay** — every message he reads (answers, updates, a one-line status, the final summary), also right after a context summary / compaction (the summary is in English — never switch because of it). English only inside code, commands and file names.

## Itay's standing rules
- **Mockup first.** Before changing what a screen looks like, render the real `index.html` with the change (Playwright, 412 px wide, his Galaxy Note10+) and get his OK.
- **A "?" next to every control**, opening a short Hebrew explanation (`HELP` in `index.html`).
- **3D keys:** the k3 kit (Itay's own, from `itayiiii/ridecheck` `design/3d-kit`) is inlined in `index.html`; "כפתורים ותנועה" lives under ⚙️ on the home screen.
- **Control rows are never mirrored:** − on the left, + on the right. The mode tiles run left to right (כבוי on the left) — except "זיהוי קולי", which he wants first: top right (17/10/2026).
- **An APK is ready → send the file itself in the chat** (he can't use GitHub). New versions install over the old one: every build is signed with the fixed test key `mobile/android/app/silentchat-test.p12` (test builds only — Google Play will get a private upload key).
- **Costs:** warn clearly before anything that may cost money or come close to a free-tier limit.
- **Don't guess** — check facts before advising, and keep the steps simple.

## Layout
- `index.html` — the whole app: one file, one inline `<script>` (the k3 kit at its top). Served by GitHub Pages.
- Joining (0.1.6): no guessable numbers. A room is a 16-sign secret key (`newRoomId`, 80 bits) inside a QR code / an invite link `…/silent-chat/#join=<key>` (WhatsApp button, share sheet); the scanner uses BarcodeDetector or `lib/jsqr.min.js`; `lib/qrcode.min.js` draws the code. A 4-digit number too (0.1.7, Itay's "1"): typing it *knocks* — the knocker gets a 2-emoji sign, everyone inside gets "מישהו דופק בדלת" with the same sign and lets in / not ("כן, זה אני"); the newcomer is then asked to lock. Locked = every newcomer (number, QR, link) knocks; a member key (sessionStorage) lets people who were inside come back by themselves. Any member can lock / unlock.
- Voice recognition (0.1.6): 4 engines in the voice card — ⚡ fp (old fingerprint), 📊 MFCC + GMM, 🧠 CAM++ (`ai-worker.js` + the ~44 MB in `ai/`, downloaded once from Pages into cache storage `silent-chat-ai-v1`), 🛡️ mix (default). One 5 s registration teaches all three prints (`voice_fingerprint`, `voice_mfcc`, `voice_ai` in localStorage). Voice mode uses the phone's noise suppression + automatic gain like בסיסי / חכם (0.1.8 — without them his Note10+ was too quiet), and the registration keeps every frame and uses the ones within ~11 dB of the loudest (`voicedFrames`), so it works at any mic level.
- `server.js` — the signaling server on Render (free tier; sleeps after 15 min, wakes in ~1 min). Version 3: says `hello`; `join` never creates a room; 4-digit numbers (`codes`) and knocking (`knock` / `let-in` / `knock-done`); failed joins limited per address; up to 8 per room; `lock`. `.github/workflows/server-check.yml` checks the live server after a change (its result is a note on the run).
- `mobile/` — the Capacitor Android app. `scripts/build-web.mjs` copies `index.html`, `ai-worker.js`, `icons/`, `lib/` into `www/` and obfuscates our JavaScript; `android/` holds the native parts (`CallService` keeps the mic on with the screen off; `SilentCallPlugin.share` opens WhatsApp / the share sheet; CAMERA is for the QR scanner).
- `.github/workflows/android.yml` — builds the release APK when the app changes and publishes it on the `test-build` release.
