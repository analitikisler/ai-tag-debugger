// Types for pano.js: the Pano tile pattern of Çini (Analitik İşler). Every function returns an inline SVG string,
// seeded (the same seed always draws the same thing), coloured through CSS variables unless you pass colours.

export type Tile = {
  /** Colours: CSS values. Defaults are the roles var(--color-tile), --color-tile-line, --color-tile-accent, --color-point. */
  ground?: string;
  line?: string;
  accent?: string;
  point?: string;
  /** The SVG's class. */
  cls?: string;
  /** An accessible name; without it the drawing is aria-hidden. */
  label?: string;
  /** preserveAspectRatio alignment, e.g. "xMaxYMid"; slice (cover the box) is the default. */
  align?: string;
  slice?: boolean;
};

export type FieldOptions = Tile & {
  /** Size in tiles of 32 units. */
  cols: number;
  rows: number;
  /** Seed: a page path, a report id. Never random. */
  seed: string;
  /** Draw the route (default true; it needs rows >= 3), the row it starts on and the row it ends on (0-based). */
  trace?: boolean;
  startRow?: number;
  endRow?: number;
};

/** The colour roles the pattern uses by default. */
export const ROLES: Required<Pick<Tile, 'ground' | 'line' | 'accent' | 'point'>>;
/** A seamless field: the route crosses it from the left edge to its point. */
export function field(o: FieldOptions): string;
/** A band one tile tall, `length` tiles long: a strap, a section edge. */
export function band(o: Tile & { length: number; seed: string }): string;
/** A framed panel: the field inside a guard band, with corners. */
export function panel(o: Omit<FieldOptions, 'trace' | 'startRow' | 'endRow'>): string;
/** The id of the missing-data pattern, for fill="url(#hatch-missing)". */
export const HATCH_ID: 'hatch-missing';
/** The missing-data hatch as an SVG <pattern> (put it in <defs> once). */
export function hatchPattern(id?: string, ground?: string, ink?: string): string;
/** The same hatch as a CSS mask URL (tokens.css has it as --pattern-missing). */
export const hatchMask: string;
