# How a graph becomes pins

This covers the Image tab: how PinVisual turns a typed or spoken equation into
a raised-pin pattern. The code lives in `src/imaging/`.

The Image tab takes an equation such as `y = x^2 - 3` or `sin(x)`. It is drawn
as a plot (`equation.ts`) and then treated like a picture of a graph. Photos,
the camera and screen sharing were removed with the move to the 3 × 3 board:
a photo has nothing left to recognise on 9 pins.

## The steps

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
   - Tap the graph to choose one curve. Auto Crop goes back to automatic. You
     can also drag the crop box yourself.
7. **Thin lines** are thickened to about half a pin, so a line through a pin
   raises it.
8. **Shapes.** Closed outlines are filled in. Clean triangles, squares,
   circles and so on are redrawn as perfect shapes that fill the grid, with
   small tilts straightened. Turn off the *Snap to …* switch to keep the original.
9. **Pins.** The crop is fitted to the grid. Sensitivity sets how much of a
   pin must be covered before it's raised.

*What the pins see* shows the result, with the removed background as a
checkerboard.

## Graphs

Squeezing a whole curve onto 9 pins can lose its shape. Graph Range starts on
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

The equation is drawn at an exact scale, so the units are always known. The
arrows under Graph Range move the window, and a short text description of the
graph is given for screen readers.

**One-Pin Lines** (on by default) draws the curve as a line one pin wide
(`traceLinePins` in `pinSampling.ts`): the pins where the curve crosses each
pin column's and pin row's centre line. Square corners are then dropped: a pin
whose only raised neighbours are one beside it and one above or below adds
nothing, since those two already touch at their corners. On 3 × 3 that makes
`x^2` a V, its arms down to the middle pin of the bottom row:

```
# . #
# . #
. # .
```
