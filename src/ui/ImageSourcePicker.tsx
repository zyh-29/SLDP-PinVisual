import { Section } from './components';
import { EquationInput } from './EquationInput';

/** Text column width for this page before there's a graph: lists read best at about this width. */
export const PICKER_WIDTH = 680;

/** The Image tab before there is a graph: the equation to draw, as an inset grouped list. */
export function ImageSourcePicker({ onEquation, equationError }: { onEquation: (text: string) => void; equationError: string | null }) {
  return (
    <Section title="Equation" padded={false} footer="Draws its graph on the pins. For example sin(x), 1/x or y = x^2 - 3.">
      <EquationInput row onDraw={onEquation} error={equationError} />
    </Section>
  );
}
