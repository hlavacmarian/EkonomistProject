// Predefined scenarios of the shock lab. Pure data + spec builders, no DOM.
//
// A scenario has
//   defaults        UI settings it starts from (shock, horizon, policy extras, mode)
//   params          parameter overrides applied when the scenario is selected
//   fixedKind       the shock kind cannot be changed in this scenario
//   extras          which scenario-specific controls are shown ('delay', 'fg')
//   build(p, s)     -> { main, alt? }: model specs for the main run and an optional
//                      comparison run drawn dashed in the same charts

const shockOf = (s) => ({
  kind: s.kind,
  size: s.size,
  rho: s.rho,
  shape: s.shape,
  duration: s.duration,
});

const baseSpec = (p, s) => ({
  params: p,
  shocks: [shockOf(s)],
  horizon: s.horizon,
  policy: { delay: s.delay || 0 },
  forwardGuidance: s.shape === 'step' ? s.fg || 0 : 0,
});

export const SCENARIOS = [
  {
    id: 'custom',
    defaults: { mode: 'rational', kind: 'rn', size: -2, rho: 0.8, shape: 'ar1', duration: 4, horizon: 24, delay: 0, fg: 0 },
    params: {},
    extras: ['delay', 'fg'],
    build: (p, s) => ({ main: { spec: baseSpec(p, s), label: 'run.main' } }),
  },
  {
    id: 'oil',
    defaults: { mode: 'rational', kind: 'u', size: 1.5, rho: 0.8, shape: 'ar1', duration: 4, horizon: 24, delay: 0, fg: 0 },
    params: {},
    fixedKind: true,
    extras: [],
    build: (p, s) => ({
      main: { spec: baseSpec(p, s), label: 'run.main' },
      alt: { spec: baseSpec({ ...p, phiPi: 3 }, s), label: 'run.hawk' },
    }),
  },
  {
    id: 'pandemic',
    defaults: { mode: 'rational', kind: 'rn', size: -2, rho: 0.8, shape: 'ar1', duration: 4, horizon: 24, delay: 0, fg: 0 },
    params: {},
    fixedKind: true,
    extras: [],
    build: (p, s) => ({
      main: { spec: baseSpec(p, s), label: 'run.main' },
      alt: { spec: baseSpec({ ...p, sigma: 0.2 }, s), label: 'run.hall' },
    }),
  },
  {
    id: 'zlb',
    defaults: { mode: 'rational', kind: 'rn', size: -5, rho: 0.8, shape: 'step', duration: 6, horizon: 32, delay: 0, fg: 1 },
    params: {},
    fixedKind: true,
    fixedShape: true,
    extras: ['fg'],
    build: (p, s) => ({
      main: { spec: baseSpec(p, s), label: 'run.withPromise' },
      alt: { spec: { ...baseSpec(p, s), forwardGuidance: 0 }, label: 'run.noPromise' },
    }),
  },
  {
    id: 'deanchor',
    defaults: { mode: 'hybrid', kind: 'u', size: 2.5, rho: 0.85, shape: 'ar1', duration: 4, horizon: 32, delay: 4, fg: 0 },
    params: { endogenousAnchoring: true, anchoring: 0.8 },
    fixedKind: true,
    extras: ['delay'],
    build: (p, s) => ({
      main: { spec: baseSpec(p, s), label: 'run.delayed' },
      alt: { spec: { ...baseSpec(p, s), policy: { delay: 0 } }, label: 'run.timely' },
    }),
  },
];

export const scenarioById = (id) => SCENARIOS.find((s) => s.id === id) || SCENARIOS[0];

// Expand a built scenario into concrete runs for the chosen expectations mode
// ('rational', 'hybrid' or 'both').
export function buildRuns(built, mode) {
  const modes = mode === 'both' ? ['rational', 'hybrid'] : [mode];
  const runs = [];
  for (const m of modes) {
    runs.push({ key: `${m}-main`, mode: m, variant: 'main', label: built.main.label, spec: built.main.spec });
    if (built.alt) runs.push({ key: `${m}-alt`, mode: m, variant: 'alt', label: built.alt.label, spec: built.alt.spec });
  }
  return runs;
}
