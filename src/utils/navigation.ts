/** The nearest step in the given direction that isn't skipped, or null if there's none. */
export function findStep(
  from: number,
  direction: 1 | -1,
  count: number,
  skip: (index: number) => boolean,
): number | null {
  for (let index = from + direction; index >= 0 && index < count; index += direction) {
    if (!skip(index)) return index;
  }
  return null;
}

/** Scrolls to the element at `#id`, even when that's where the URL already points. */
export function goToAnchor(id: string) {
  // Clear the hash first so jumping to the anchor that's already selected still scrolls
  if (location.hash === `#${id}`) history.replaceState(null, '', location.pathname + location.search);
  location.hash = id;
}
