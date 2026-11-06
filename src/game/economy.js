// The economy a game is played in: the closed hybrid model, or the small open
// economy (hybrid expectations). Both expose the same three functions, so the
// game logic does not depend on which one it is.

import { stepHybrid, initialHybridState, solveHybrid } from '../model/hybrid.js';
import { stepOpen, initialOpenState, solveOpenHybrid } from '../model/open.js';

const CLOSED = {
  economy: 'closed',
  step: (p, state, shock, rate) => stepHybrid(p, state, shock, rate),
  init: initialHybridState,
  solve: solveHybrid,
  shockKinds: ['rn', 'u'],
  pathKeys: ['x', 'pi', 'i', 'Ex', 'Epi', 'w'],
};

const OPEN = {
  economy: 'open',
  step: (p, state, shock, rate) => stepOpen(p, state, shock, rate, null),
  init: initialOpenState,
  solve: solveOpenHybrid,
  shockKinds: ['rn', 'u', 'istar', 'ystar', 'chi'],
  pathKeys: ['x', 'pi', 'i', 'Ex', 'Epi', 'w', 'q', 'e', 'piH', 'piF'],
};

export const gameModel = (economy) => (economy === 'open' ? OPEN : CLOSED);

// Shock of quarter k (model units) for the step function.
export function shockAt(model, paths, k) {
  const out = {};
  for (const kind of model.shockKinds) out[kind] = paths[kind]?.[k] || 0;
  return out;
}
