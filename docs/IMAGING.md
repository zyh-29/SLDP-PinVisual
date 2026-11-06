# How a picture becomes pins

This covers the Image tab: how PinVisual turns a photo, drawing, graph,
equation, shared screen or live camera into a raised-pin pattern. The code
lives in `src/imaging/`.

The Image tab takes a photo, a dropped or pasted image, a typed equation, a
shared screen (desktop browsers) or the live camera (web).

## The steps

The picture is scaled down to 800 px, then:

0. **Light** (camera pictures). A phone camera never sees paper evenly lit:
   the corners are darker, a lamp makes a bright pool, a window lights one
   side. `lighting.ts` measures the light across the picture and divides it
   out, the way astronomy software removes a sky background:
   - The picture is cut into 32 px cells. Each cell's paper colour is the
     average of its brighter pixels, so ink crossing it doesn't count.
   - A smooth surface is fitted through the cells. Cells that don't fit,
     such as the subject itself, are given less and less weight (a robust,
     reweighted fit), so the surface follows the paper alone.
   - Each pixel is divided by the surface, per colour, which also removes a
     warm lamp's tint.

   It's skipped when the light is already even, and when neighbouring cells
   jump sharply. Light changes gradually; a jump means a thing (a card on a
   desk, a checked cloth, a dark object and its shadow), which the next steps
   handle. It takes about 7 ms per frame.
1. **Background.** The background colour is taken from a thin ring around the
   edge of the crop.
2. **Subject.** Pixels that differ enough from the background are the subject.
   The cut-off (Tolerance) is set automatically for each picture, or you can
   drag the slider.
3. **Clean-up.** For shapes and objects, a second pass based on GrabCut
   (`refineMask.ts`) tidies the outline. It learns what the background and
   the subject look like, then decides all pixels together with a minimum cut
   (`maxflow.ts`). This removes speckles and patterned backgrounds. Graphs and
   thin line drawings skip it, because it would erase thin lines.
4. **Axes and gridlines.** Long straight lines that cross are taken as axes
   and removed, leaving the curve. A letter like T or E isn't mistaken for
   axes, because nothing is left once its lines go.
5. **Labels.** Small pieces such as tick numbers and captions are dropped.
6. **Smart crop** (`smartCrop.ts`) decides what becomes pins:
   - On a graph, coloured curves are kept and the grid, text and buttons are
     ignored. Black curves are found by first finding the plot area by its
     gridlines.
   - Otherwise it picks the most likely object: big, central, not touching the
     edge, and not text.
   - Tap the picture to choose something else: one shape, one curve, one of
     several graphs. Auto Crop goes back to automatic. You can also drag the
     crop box yourself.
7. **Thin lines** are thickened to about half a pin, so a line through a pin
   raises it.
8. **Shapes.** Closed outlines are filled in. Clean triangles, squares,
   circles and so on are redrawn as perfect shapes that fill the grid, with
   small tilts straightened. Turn off the *Snap to …* switch to keep the original.
9. **Pins.** The crop is fitted to the grid. Sensitivity sets how much of a
   pin must be covered before it's raised.

*What the pins see* shows the result, with the removed background as a
checkerboard.

## Smart Cut-Out

For photos with a busy background, an on-device model separates the main
subject. It switches on by itself and can be turned off.

- iOS 17+: Apple Vision, through `modules/subject-segmentation`
- Android: Google ML Kit Subject Segmentation (beta), same module
- Web: U²-Net small (`public/models/u2netp.onnx`, Apache-2.0) with ONNX Runtime Web

The phone versions need a development build. In Expo Go the switch is hidden.

On the web, the model only counts as having found a subject when it is sure
of at least 0.3% of the picture. On a landscape it is never sure of anything
(its strongest point is a guess), and that guess used to become the "subject":
a patch of meadow, a bend in a river. Cars, even a small one far off, cover
1.6% or more.

A shape cut out of a photo is never snapped to a triangle or hexagon: a car is
not a hexagon, however close its outline comes. It is stretched to fill the
pins instead, up to 2.2 times taller (or wider) than it really is: a car seen
from the side is three or four times wider than tall, and kept to those
proportions it was a single row of pins. Filling the rows shows the cabin on
top, the body, and the wheels at the bottom corners.

## Landscapes

A photo of mountains or hills has no single object to cut out. The pins show
the **skyline** instead: the land raised, the sky lowered, cropped around the
ridge so the peaks fill the grid (`scene.ts`).

- **Sky:** the smooth area joined to the top of the picture, right across it.
  Clouds stop it, but they are islands: land never floats above sky, so the
  skyline is just below each column's lowest sky.
- **Landscape or object?** A car under the sky has a skyline too (trees,
  buildings). It's a landscape only when the cut-out found nothing, or what it
  found follows the skyline (its top edge is the ridge). A car's roof sits well
  below the trees behind it, so the car is shown.
- **Tap** something in the picture to show just that instead.

Tested on 11 photos (6 cars, 5 mountains): every car was cut out and every
mountain photo shown as a skyline. Limits: clouds lying right on the peaks with
no sky under them count as land, and a mountain fading into haze counts as
sky (the dark foreground is then shown).

## Graphs

Squeezing a whole curve onto 30 pins can lose its shape. Graph Range starts on
Auto: the whole curve when that shows everything (a parabola, a line), or the
part where it turns and bends (the two humps of `x^3 - 3x`, the top of a bell
curve). Waves show one at a time.

To see a set part instead, type a range in the Graph Range field:

| Type | Shows |
|---|---|
| `5`, `±5`, `+-5` or `+/-5` | 5 units each side of the middle of the graph |
| `+5` | the 5 units right of the middle |
| `-5` | the 5 units left of the middle |
| `whole` | the whole curve |
| nothing | Auto |

A typed range keeps the graph's real proportions, and the curve's lowest or
highest point sits in the bottom or top row when it is in view.

The units come from the numbers on the axes, read with Tesseract.js on the
device. If they can't be read, one grid square counts as one unit, which can
be wrong. When you zoom in, the curve keeps its size on the pins. The arrows
under Graph Range move the window, and a short text description of the graph
is given for screen readers.

You can also type an equation such as `y = x^2 - 3` or `sin(x)`. It is drawn
at an exact scale, so no numbers need reading.

## Live camera (web)

Point a phone or webcam at a worksheet, a screen or an object, and the pins
follow it.

- **Lock.** When the camera sees the same item twice in a row, it locks on
  (*Live · Locked*) and follows it as you move. Tap another item to switch.
  Tracking uses ORB feature points (`features.ts`, `featureTracker.ts`), with
  template matching as a fallback for plain items.
- **Capture.** Once locked, the camera keeps one sharp frame of the item
  (*Live · Captured*). The pins come from that frame, so they stay still while
  the video keeps running. Tapping something else, Auto Crop or drawing your
  own crop box releases it. Stop Camera keeps the captured frame as a still
  picture.
- **Screens and paper.** Pointed at a laptop screen or a sheet of paper, the
  camera finds its four corners and straightens it (*Live · Flat*).
- **Uneven light.** Vignetting, a desk lamp or a window no longer makes the
  paper itself look like the subject (step 0 above). In tests with 6 drawings
  under 7 kinds of light, wrong pins fell from 173 to 18 of 1,260; vignetting
  and lamp light went from 4–30 wrong pins per picture to none.
- **Steadier pins.** Frames are lightly blurred to remove sensor noise, and
  each pin is averaged over a few frames so it doesn't flicker.
- **Speed.** Frames are 640 px and the app adapts how often it processes them
  to how fast the phone is.
- **Focus and light.** Blurry frames are skipped while the lens refocuses, and
  very dark frames aren't processed. Tapping the picture also focuses there
  (Chrome on Android).
- **Cars, mountains and other scenes.** Once the camera has settled (locked
  on an item, or about 1.5 s on a busy scene with nothing to lock onto), the
  frame it keeps is judged as a photo: Smart Cut-Out and the landscape check
  run on it, so a car is cut out and a mountain shows its skyline. A kept
  scene lets go when the camera turns to something else. Frames from the
  camera always count as photos, however smooth the phone makes them.
- **Pictures of things.** Pointed at a printed photo or a photo on a screen,
  the camera finds the print or screen, straightens it (*Live · Flat*) and
  cuts the object out of the photo inside: a printed car comes out as a car.
  Not yet for landscapes in a print or on a screen: a smooth printed sky
  doesn't count as a photo, and a screen's bezel hides where the ground ends.
- **Not a page:** a bright, smooth patch hanging from the top of the view (an
  overcast sky above a car) is not taken for a sheet of paper to straighten.
- **Capture button.** Takes a full-resolution photo and carries on with it as
  a still picture.

The camera only works over https or on localhost. If the app is inside an
`<iframe>`, add `allow="camera"` to it.

## Screen sharing (desktop web)

Share Screen lets you pick a screen, window or tab. The pins follow it live,
up to five times a second. Nothing is sent to the board until you press
**Use This Pattern** and then **Send**.

Share the window with your graph or shape, not the entire screen. On the
entire screen PinVisual sees itself (its own preview and pins) and other
windows, and may pick those instead. Chrome and Edge list windows first and
leave PinVisual's own tab out. If the entire screen is shared anyway, the
Image tab says so. Things cut off by the edge of the screen are passed over,
since they are usually part of another window.

