// Builds the web app that goes inside the Android APK.
// Copies ../index.html, ../ai-worker.js, ../icons and ../lib (the QR code libraries) into www/, and scrambles
// (obfuscates) our JavaScript (index.html's script and ai-worker.js) so the code inside the APK is very hard to read or copy.
// The AI model itself (../ai/, ~44 MB) is not in the APK: the app downloads it once from GitHub Pages when asked.
// The readable source stays in the repository; only the APK gets the scrambled copy.
import { readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JavaScriptObfuscator from 'javascript-obfuscator';

const here = path.dirname(fileURLToPath(import.meta.url));
const mobile = path.resolve(here, '..');
const repo = path.resolve(mobile, '..');
const www = path.join(mobile, 'www');

await rm(www, { recursive: true, force: true });
await mkdir(www, { recursive: true });
await cp(path.join(repo, 'icons'), path.join(www, 'icons'), { recursive: true });
await cp(path.join(repo, 'lib'), path.join(www, 'lib'), { recursive: true });

let html = await readFile(path.join(repo, 'index.html'), 'utf8');

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (scripts.length !== 1) {
  throw new Error(`expected exactly 1 inline <script> in index.html, found ${scripts.length}`);
}
const source = scripts[0][1];

const OPTIONS = {
  target: 'browser',
  compact: true,
  // The HTML calls functions by name (onclick="showHelp(...)"), so top-level names must stay.
  renameGlobals: false,
  identifierNamesGenerator: 'hexadecimal',
  // All texts move into an encoded table.
  stringArray: true,
  stringArrayThreshold: 1,
  stringArrayEncoding: ['base64'],
  stringArrayRotate: true,
  stringArrayShuffle: true,
  // Heavier transforms would slow down the audio loop that runs 60 times a second.
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
  unicodeEscapeSequence: false
};
const scrambled = JavaScriptObfuscator.obfuscate(source, OPTIONS).getObfuscatedCode();

html = html.replace(scripts[0][0], () => `<script>${scrambled}</script>`);
// Remove developer notes: HTML comments and CSS comments.
html = html.replace(/<!--[\s\S]*?-->/g, '');
html = html.replace(/<style>([\s\S]*?)<\/style>/, (_, css) => `<style>${css.replace(/\/\*[\s\S]*?\*\//g, '')}</style>`);
// Web-only: the install manifest has no meaning inside the APK.
html = html.replace(/\s*<link rel="manifest"[^>]*>/, '');

await writeFile(path.join(www, 'index.html'), html);
console.log(`www/index.html ready - script ${source.length} chars -> ${scrambled.length} chars (scrambled)`);

// The AI voice check's worker (it downloads the model; see ai/README.md)
const worker = await readFile(path.join(repo, 'ai-worker.js'), 'utf8');
const workerScrambled = JavaScriptObfuscator.obfuscate(worker, OPTIONS).getObfuscatedCode();
await writeFile(path.join(www, 'ai-worker.js'), workerScrambled);
console.log(`www/ai-worker.js ready - ${worker.length} chars -> ${workerScrambled.length} chars (scrambled)`);
