# ai/ — the "🧠 בינה מלאכותית" voice check

Downloaded once by the app (≈44 MB) when you choose the AI engine, then kept in the phone's cache storage.
The Android app downloads these files from GitHub Pages (`https://itayiiii.github.io/silent-chat/ai/`);
the web version loads them from its own site. They are **not** inside the APK, so the APK stays small.

| File | What | License |
|---|---|---|
| `campplus-voxceleb-en.onnx` | CAM++ speaker-embedding model (3D-Speaker, trained on VoxCeleb), ONNX export from the sherpa-onnx project (`speaker-recongition-models` release). 512-number voice prints from 80-dim fbank at 16 kHz. | Apache-2.0 (3D-Speaker / ModelScope `iic/speech_campplus_sv_en_voxceleb_16k`) |
| `ort.wasm.min.js`, `ort-wasm-simd-threaded.mjs`, `ort-wasm-simd-threaded.wasm` | ONNX Runtime Web 1.30.0 (WebAssembly, run with one thread) | MIT — see `LICENSE-onnxruntime-web.txt` |

The worker is `ai-worker.js` (at the root of the site; inside the APK it is bundled and scrambled): Kaldi-style fbank (the same as kaldi-native-fbank / sherpa-onnx), resampling to 16 kHz, and the CAM++ voice print. It keeps these files in the cache storage `silent-chat-ai-v1` (the service worker leaves `ai/` alone).
Checked against kaldi-native-fbank (largest difference 2·10⁻⁴) and on two speakers: 1.2 s pieces of the registered speaker 0.50–0.70, another speaker 0.12–0.16. In the app, end to end in Chromium with real speech as the microphone: the AI engine let through 90–98% of the registered speaker and 0% of another speaker; 🛡️ (MFCC first, the AI confirms) 97–99% / 0–3%.
