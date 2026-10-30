
import { smartCutoutAvailable } from '@/imaging/segment';
import type { ConversionPrefs } from '@/state/useConversionSettings';
import type { useImageConversion } from '@/state/useImageConversion';
import { Label, Section, Separator } from './components';
import { EquationInput } from './EquationInput';
import { GraphRangeControl } from './GraphRangeControl';
import { SliderRow, SwitchRow } from './SettingRows';
import { announce } from '@/voice/announce';

/** The Image tab's Conversion card: how the picture becomes pins. Rows appear only where they apply. */
export function ConversionSettings({
  settings: s,
  set,
  conversion: c,
  live,
  equation,
  onEquation,
  equationError,
}: {
  settings: ConversionPrefs;
  set: <K extends keyof ConversionPrefs>(key: K, value: ConversionPrefs[K]) => void;
  conversion: ReturnType<typeof useImageConversion>;
  live: boolean;
  /** The typed equation being shown, if the picture was drawn from one. */
  equation: string | null;
  onEquation: (text: string) => void;
  equationError: string | null;
}) {
  const { graph, fg, shape } = c;
  if (!fg) return null;
  return (
    <Section title="Conversion">
      {equation !== null ? (
        <>
          <EquationInput key={equation} initial={equation} onDraw={onEquation} error={equationError} />
          <Separator />
        </>
      ) : null}
      {graph ? (
        <>
          <GraphRangeControl
            graph={graph}
            range={s.graphRange}
            onChange={(v) => set('graphRange', v)}
            readingNumbers={c.readingNumbers}
            pan={s.graphPan}
            live={live}
            onPan={(p) => {
              set('graphPan', p);
              announce(
                p.x === 0 && p.y === 0 ? 'Back on the curve' : `Moved ${Math.abs(p.x)} ${p.x < 0 ? 'left' : 'right'}, ${Math.abs(p.y)} ${p.y < 0 ? 'down' : 'up'}`,
              );
            }}
          />
          <Separator />
        </>
      ) : null}
      <SwitchRow
        title="Remove Background"
        hint="Anything that differs from the edge colour counts as the subject"
        value={s.removeBackground}
        onChange={(v) => set('removeBackground', v)}
      />
      {s.removeBackground ? (
        <>
          {/* Always offered for a still picture: on by itself for photos with a busy background, and anyone can turn
              it on or off whatever the app made of the picture. */}
          {smartCutoutAvailable && !live ? (
            <>
              <Separator />
              <SwitchRow
                title="Smart Cut-Out"
                hint="Uses on-device AI to separate the main subject from a busy background"
                value={c.cutoutOn}
                onChange={(v) => set('cutoutOverride', v)}
              />
              {__DEV__ && c.pictureCheck ? <PictureCheck check={c.pictureCheck} /> : null}
            </>
          ) : null}
          {fg.lines.length > 0 || s.linesOverride !== null ? (
            <>
              <Separator />
              <SwitchRow
                title="Remove Axes & Grid"
                hint="Removes long straight lines such as graph axes and gridlines, and stretches the graph to fill the pins"
                value={fg.linesRemoved}
                onChange={(v) => set('linesOverride', v)}
              />
            </>
          ) : null}
          <Separator />
          <SwitchRow
            title="Ignore Labels & Text"
            hint="Drops labels, text and specks much smaller than the main shape"
            value={s.removeClutter}
            onChange={(v) => set('removeClutter', v)}
          />
          {c.shapesApply && shape ? (
            <>
              <Separator />
              <SwitchRow
                title={`Snap to ${shape.name}`}
                hint={`Draws a perfect ${shape.name.toLowerCase()} on the pins instead of following the pixels`}
                value={s.snap}
                onChange={(v) => set('snap', v)}
              />
            </>
          ) : null}
        </>
      ) : null}
      {s.removeBackground && c.curves ? (
        <>
          <Separator />
          <SwitchRow
            title="One-Pin Lines"
            hint="Draws graph curves as a line one pin wide, following the curve's centre, instead of every pin they touch"
            value={s.thinLines}
            onChange={(v) => set('thinLines', v)}
          />
        </>
      ) : null}
      {/* Tolerance only matters when the subject is separated by colour (not by a curve's colour or the AI). */}
      {s.removeBackground && !c.subjectKnown ? (
        <>
          <Separator />
          <SliderRow
            title="Tolerance"
            value={fg.tolerance}
            display={s.toleranceOverride === null ? `Auto · ${fg.tolerance}` : String(s.toleranceOverride)}
            min={8}
            max={160}
            step={2}
            onChange={(v) => set('toleranceOverride', v)}
            onAuto={s.toleranceOverride === null ? undefined : () => set('toleranceOverride', null)}
            hint="Set automatically for each image. Higher ignores faint colours, shadows and paper texture; lower keeps pale fills."
          />
        </>
      ) : null}
      {c.traced ? null : (
        <>
          <Separator />
          <SliderRow
            title="Sensitivity"
            value={s.sensitivity}
            display={`${s.sensitivity}%`}
            min={5}
            max={95}
            step={5}
            onChange={(v) => set('sensitivity', v)}
            hint={`Higher raises more pins. A pin is raised when at least ${100 - s.sensitivity}% of it is ${s.removeBackground ? 'subject' : 'dark'}.`}
          />
        </>
      )}
    </Section>
  );
}

/**
 * Development builds only: what the app made of the picture and why, to check one it misjudges. Photo or not by
 * its grain (see pictureKind in smartCrop.ts), and Smart Cut-Out on by itself when a photo's edge is busy.
 */
function PictureCheck({ check }: { check: NonNullable<ReturnType<typeof useImageConversion>['pictureCheck']> }) {
  const grain = `grain ${check.grain.toFixed(2)} ${check.photo ? '≥' : '<'} ${check.photoGrain}`;
  const edge = check.edgeNoise === null ? '' : `, edge ${check.edgeNoise.toFixed(0)} ${check.edgeNoise > check.busyEdge ? '>' : '≤'} ${check.busyEdge}`;
  const auto = check.photo && check.edgeNoise !== null && check.edgeNoise > check.busyEdge ? 'Smart Cut-Out on by itself' : 'Smart Cut-Out off by itself';
  return (
    <Label variant="footnote" secondary>
      {`Debug: ${check.photo ? 'photo' : 'screenshot or drawing'} (${grain}${edge}). ${auto}.`}
    </Label>
  );
}
