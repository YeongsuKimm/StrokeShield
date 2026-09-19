# Testing StrokeShield on a real phone

The automated check (`pnpm test:mobile`) is Chromium pretending to be a phone. It catches layout: overflow, controls
sitting on the camera, tap targets that are too small. It cannot catch anything to do with a real camera, a real
microphone, or iOS audio, and those are where the remaining risk is.

**Nothing below has been run on a real device yet.** Everything in the "Unverified" section is reasoning about known
browser behaviour, not an observation. Treat each one as a question to answer, not a fixed bug.

## Getting the site onto a phone

The camera and microphone only work over HTTPS or on `localhost`, so a plain `http://192.168.x.x` address will fail
every check with no useful error. Two ways round that:

```bash
cd frontend && pnpm dev:phone     # HTTPS + the LAN address, printed as "Network:"
```

Open the `Network:` URL on a phone on the same Wi-Fi. The certificate is self-signed, so the phone warns once:
**Advanced → Proceed**. That warning is local only; the deployed site has a real certificate.

The backend is proxied through the same origin, so the phone needs no second address and no CORS entry. Start it as
usual (`uvicorn backend.main:app --reload --port 8000`) before the speech check.

The other way is to deploy a preview build and open that. Slower to iterate, closer to what judges will use.

## Supported browsers

Safari and Chrome, which in engine terms means WebKit (Safari everywhere, and every browser on iOS) and Blink (Chrome,
Edge, Samsung Internet). Firefox and the rest get one dismissible "not tested" line and are never blocked.

In-app browsers — the web view inside Instagram, TikTok, Facebook, a chat app — are the one case that genuinely
breaks, because several block camera access outright. They get a red banner telling the visitor to open the page in
Safari or Chrome. **Worth testing deliberately:** send yourself the link in Instagram DMs and open it there.

## Verified in phone emulation

- No horizontal overflow, on iPhone 12 and Pixel 5 sizes.
- The camera stage fits the screen on all four checks, and the Call 911 / voice-guide buttons no longer sit on top of
  it. That mattered most for the arm check: those two buttons are bottom-left and bottom-right, which is exactly where
  the patient's hands are.
- Tap targets are 44px or larger.
- The camera is asked for a portrait 3:4 stream on phones, and delivers one (720x960).

## Unverified: check these first on a real device

Roughly in order of how likely they are to break the demo.

1. **The arm check at portrait distance.** A phone in portrait sees a much narrower slice than a laptop. The wording no
   longer quotes a distance ("step back until both hands fit"), because the right distance depends on the camera, but
   the estimate is **about six feet**, which is more floor than a small room may have. Stand the phone up at chest
   height first; at that distance nobody can also be holding it. **If the framing gate never passes, this is the
   finding that matters most** — say so rather than working around it.
2. **Two microphones at once (iOS).** Three things want the microphone: the level meter opened at consent, the speech
   recorder, and the voice guide. iOS Safari has a long history of silencing the first stream when a second opens. Run
   the speech check *with the voice guide connected* and confirm the recording is not silent and does not fail with
   "I couldn't hear you". No fix has been written for this, because guessing at one without a device to test on is how
   you break the path that currently works.
3. **Silencing the guide during the speech check (iOS).** The app sets the agent's volume to 0 *and* mutes the media
   elements, because iOS ignores programmatic volume entirely and only honours `muted`. Confirm the guide actually
   goes quiet while recording, and that its voice is not in the recording.
4. **Two models on a mid-range phone.** Face and pose tracking both load. Watch for the camera dropping below roughly
   15 fps, the phone getting hot, or the tab being killed. `?debug=1` shows the frame rate and which delegate is in use.
5. **Interruptions.** A call, a notification, the screen locking, switching apps mid-check. The app pauses and shows a
   resume notice; check it recovers rather than hanging.
6. **The home bar and the notch.** The page now draws edge to edge, with the floating controls padded clear of the home
   bar. Confirm nothing is under it, in both orientations.
7. **Pull-to-refresh.** Swipe down at the top of the info page on Android Chrome. The page must not reload; a reload
   mid-check loses the session.

## Reporting what you find

Put the phone model, OS version and browser version next to anything that fails — "iPhone 13, iOS 17.5, Safari" — and
add a line to `docs/STATUS.md`. A failure that cannot be reproduced on a named device is not actionable.
