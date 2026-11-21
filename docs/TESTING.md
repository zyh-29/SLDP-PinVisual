# Manual testing

Unit tests and the simulated board cover the protocol and logic. These checks
need real devices and real people.

## On a real phone and board

The simulator can't check these:

1. Permission prompts: Bluetooth, Android "Nearby devices", location on
   Android 11 and older, and the microphone.
2. Scanning finds the ESP32 (named `PinVisual…`).
3. Connecting finds the service and both characteristics.
4. The Device tab shows the negotiated MTU.
5. Send: the firmware receives the right bytes (see the test vectors in
   [PROTOCOL.md](PROTOCOL.md)) and the app shows "Board received pattern".
6. Open **Pin Test** and raise and lower the top-left pin on PCA9685
   channel 0. In **Display**, send each corner individually and then all nine
   pins together. Verify the [firmware wiring](../firmware/README.md) and
   check that the pins rise and lower in left-to-right column order, with
   at most two moving together.
7. Retries: with ACKs turned off in the firmware, the app should try three
   times and then offer Retry.
8. Power off the ESP32 mid-send: the app should show "Connection lost".
9. Reset clears the preview only after the board acknowledges it.
10. VoiceOver and TalkBack read each pin as "Row r, column c, raised/lowered".

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

