# Manual testing

Unit tests and the simulated board cover the protocol and logic. These checks
need real devices and real people.

## On a real phone and board

The simulator can't check these:

1. Permission prompts: Bluetooth, Android "Nearby devices", location on
   Android 11 and older, and the photo library.
2. Scanning finds the ESP32 (named `PinVisual…`).
3. Connecting finds the service and both characteristics.
4. The Device tab shows the negotiated MTU.
5. Send: the firmware receives the right bytes (see the test vectors in
   [PROTOCOL.md](PROTOCOL.md)) and the app shows "Board received pattern".
6. Pin order: raise only the top-left pin and check it on the display, then
   the bottom-right one. For a single servo, the **Pin Test** tab shows one
   pin (the top-left one, whose servo is plugged into the ESP32's D18; see
   [firmware/README.md](../firmware/README.md), "Testing with one servo"). Tap it to raise or lower
   it on the board. It sends the usual pattern command with
   only that pin raised, so every other pin goes down. The Display preview
   isn't changed.
7. Retries: with ACKs turned off in the firmware, the app should try three
   times and then offer Retry.
8. Power off the ESP32 mid-send: the app should show "Connection lost".
9. Reset clears the preview only after the board acknowledges it.
10. VoiceOver and TalkBack read each pin as "Row r, column c, raised/lowered".
11. Real photos, transparent PNGs and very large images.

## With blind and low-vision users

Unit tests cover the command list and the answers. They can't show whether
it's usable. Before calling it done:

1. Use it with VoiceOver's Screen Curtain (three-finger triple-tap) or
   TalkBack's dimmed screen: show a shape, check it by touch, send it, and
   reset, without looking.
2. Try it in a noisy room and with a quiet voice. The typed box must cover
   whatever fails.
3. Ask blind testers to do the same tasks without help. Note where they get
   stuck and what they try to say that isn't understood: those phrasings
   belong in `src/voice/commands.ts` (or in
   `scripts/voice-training-data.mjs`, then retrain).

