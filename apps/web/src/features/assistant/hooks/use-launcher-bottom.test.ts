import { describe, expect, it } from 'vitest';

import { LAUNCHER_INSET, launcherBottomFor } from './use-launcher-bottom';

/** A rect from x, y, width and height, as the QA report gives them. */
function box(x: number, y: number, width: number, height: number) {
  return { left: x, right: x + width, top: y, bottom: y + height };
}

describe('launcherBottomFor', () => {
  const vw = 1425;
  const vh = 900;

  it('stays at rest when nothing marked is near the launcher', () => {
    expect(launcherBottomFor([box(0, 840, 300, 60)], vw, vh)).toBe(LAUNCHER_INSET);
  });

  it('steps above the composer, then above the chips it would land on (OV1)', () => {
    // Chat thử at 1440×900: the composer at the bottom, the chips block just above it.
    const composer = box(1005, 825, 420, 75);
    const chips = box(1062, 603, 337, 202);
    // The chips do not touch the rest place; only the lifted launcher would cover them.
    expect(launcherBottomFor([composer], vw, vh)).toBe(vh - 825 + 8);
    expect(launcherBottomFor([chips, composer], vw, vh)).toBe(vh - 603 + 8);
  });

  it('ignores hidden elements and never leaves the screen', () => {
    expect(launcherBottomFor([box(1300, 850, 0, 0)], vw, vh)).toBe(LAUNCHER_INSET);
    expect(launcherBottomFor([box(1000, 0, 425, 900)], vw, vh)).toBe(vh - 56 - LAUNCHER_INSET);
  });
});
