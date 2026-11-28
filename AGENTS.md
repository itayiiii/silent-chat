# AGENTS.md — who does what in silent-chat

Itay owns this app. He reads Hebrew only: every message to him is in Hebrew (code, commands and file names may stay in English).
Two AI agents work for him. This file is the same in all of Itay's app repositories (ridebpm, ridecheck, ridecam, talkbridge, tvremote, silent-chat, songsketch, popdeck); only the "This repository" section differs.

## Claude (Claude Code sessions) — the code and everything that builds it
- All code, tests and CI / build settings (GitHub Actions workflows, Gradle, Capacitor, manifests).
- Keys and signing: the Google Play upload key, the signing steps, building the signed AAB.
- Privacy policy pages and their hosting, the data inventory for Google Play's Data safety form.
- Puts store assets that Grok prepared into the repository when Itay hands them over (`store/`).
- Works on its own branches (`claude/...`, or the branch the repo's CLAUDE.md names). Merges to `main` only when Itay says so.

## Grok — Itay's supervisor
- Passes Itay's instructions to Claude through Claude's sessions.
- Prepares marketing assets: app icon, feature graphic, screenshots' captions, store texts, the tester plan.
- Handles Google Play Console (listing, tracks, testers, forms).
- Does not write code and does not push to GitHub — there are no `grok/` branches.
- An icon / banner Claude drew is a placeholder only; Grok's assets, as Itay picks them, are the ones used.

## Rules for both
- **Never two store builds at the same time.** Before starting one, check that no store / signing build is running (Actions → the workflow's runs). A second run started while one runs can cancel it (a signed build was lost that way on 21/11/2026).
- **Never show a password or a secret's value** — not in chat, logs, commits or files. Secrets live only in GitHub → Settings → Secrets and variables → Actions.
- **Never make a second upload key.** Play knows one upload key per app; a new one needs a reset through Play support. The key's certificate fingerprints (public) are in `signing/play-upload-fingerprints.txt` — compare with Play Console → App integrity → App signing.
- Itay keeps an offline copy of each upload key file and its password (Google Drive + a USB stick + a password manager).
- Nothing is uploaded to Play, published or sent to testers without Itay's OK.
- **Two builds, always: the APK is Itay's, the AAB is Play's** (Itay 28/11/2026). The AAB (the Play build) has only what
  Play allows. The APK (the test build Itay installs himself) has everything the AAB has **plus everything that was held back
  from the AAB only because of Play's rules** — e.g. in ride.bpm the satellites, WhatsApp / phone-call links, background
  location, group rides; whatever was limited for Play. Keep each such thing behind one build switch (store build = off,
  APK = on) — never delete it from the code. Turn something off in the APK too only when Itay says so (he wants to test it
  himself). When a feature is limited for Play, say in the commit and to Itay that the APK keeps it.

## This repository
- App: silent-chat. **This repository is public** — never commit a key, a keystore or anything secret here; no upload key is in it (as of 21/11/2026).
- Project instructions for Claude: `CLAUDE.md`.
