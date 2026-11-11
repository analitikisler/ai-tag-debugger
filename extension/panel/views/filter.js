// The Events platform filter as a pure function, so its behaviour is tested without a browser. The state is
// { on: Set | null, extra: Set }: on = the selected platforms pressed (null = all of them, the default), extra =
// platforms recorded but not selected (and "other" for other requests) shown on top.

/** The keys shown with this filter. */
export function shownKeys(filter, { selected }) {
  return new Set([...(filter.on ?? selected), ...filter.extra]);
}

/** Every key there is to show: the selected platforms, the unselected ones, and other requests when there are any. */
const everyKey = ({ selected, unselected, hasOther }) => [...selected, ...unselected, ...(hasOther ? ["other"] : [])];

/** Whether everything captured is shown, which is what "All" means. */
export function allShown(filter, sets) {
  const shown = shownKeys(filter, sets);
  return everyKey(sets).every((k) => shown.has(k));
}

const DEFAULT = () => ({ on: null, extra: new Set() });

/** Back to the default when a filter ends up showing exactly the selected platforms. */
function normalize(filter, { selected }) {
  const on = filter.on ?? new Set(selected);
  return !filter.extra.size && on.size === selected.length && selected.every((k) => on.has(k)) ? DEFAULT() : filter;
}

/**
 * A chip click. key "all": everything captured, or back to the default when everything is already shown. A platform
 * chip toggles that platform in what is shown now (so with All on, it turns that one off); solo (Alt-click or a
 * double click) shows only that platform.
 */
export function chipClick(filter, key, sets, { solo = false } = {}) {
  const { selected } = sets;
  if (key === "all") {
    if (allShown(filter, sets)) return DEFAULT();
    return { on: new Set(selected), extra: new Set(everyKey(sets).filter((k) => !selected.includes(k))) };
  }
  const isSelected = selected.includes(key);
  if (solo) return { on: new Set(isSelected ? [key] : []), extra: new Set(isSelected ? [] : [key]) };
  const on = new Set(filter.on ?? selected);
  const extra = new Set(filter.extra);
  const set = isSelected ? on : extra;
  if (set.has(key)) set.delete(key); else set.add(key);
  return normalize({ on, extra }, sets);
}
