# LeagueLab

LeagueLab is a client-only model of one double round-robin league. This checkpoint implements phases 1–3: a TypeScript/Vite/React scaffold, a tested Dixon–Coles fitting core, league tables, and seeded simulation with a Web Worker client. The application screens, import flow, and backtest are not implemented in this checkpoint.

<!-- scope-statement:start -->
LeagueLab supports one flat double round-robin league with 3/1/0 points. It does not provide betting, odds conversion, or tips.
<!-- scope-statement:end -->

## Development

Use Node.js 22.12+ (this checkpoint was tested with Node.js 24).

```sh
npm ci
npm run dev
npm test
npm run build
```

`src/core/types.ts` defines the brief's data model. `src/config/defaults.ts` contains frozen defaults. `dixonColes.ts` implements scoring rates and the renormalized, truncated joint PMF; `fitter.ts` implements the objective and optimizer; `gradcheck.ts` provides a pure central-difference checker. Tests live under `tests/`. The synthetic sampler in `tests/helpers.ts` is only a test fixture, not the phase-4 application generator.

There are no application network calls or backend. React and its DOM renderer are the only runtime packages. Keep user-supplied data in gitignored `data/local/`; no real data is bundled or has been evaluated. CSV import instructions and a product screenshot will accompany their implemented screens.

## Implemented method

For home h and away a, `log λ = c + η + attack[h] − defense[a]` and `log μ = c + attack[a] − defense[h]`. Both rating vectors are centered. Higher defense reduces conceded goals. The raw parameter vector is `[c, η, r, attackRaw..., defenseRaw...]`, with `ρ = rhoCap × tanh(r)`.

The four correction factors are `1−λμρ`, `1+λρ`, `1+μρ`, and `1−ρ` at scores 0–0, 0–1, 1–0, and 1–1 respectively; all others are one. The PMF truncates each score at `maxGoals` and renormalizes. A bound on ρ alone cannot ensure valid corrections for every scoring rate: invalid PMFs throw an explicit error.

Training uses only dates strictly before the cutoff. Weights are `exp(−ln(2) × ageDays / halfLifeDays)`. The minimized objective is weighted negative log likelihood divided by total weight, omitting constant log-factorials, plus `ridge × (sum(attack²) + sum(defense²))`. **Ridge regularization is a deviation from the original Dixon–Coles model**, used here to stabilize small samples. The training objective is the specified untruncated likelihood; prediction uses the truncated PMF.

The analytic derivatives include the correction terms, tanh chain rule, ridge, and projection through centering. Any observed correction ≤ 1e-6 gives an infinite objective. Gradient descent uses Armijo constant 1e-4, step halving, and step doubling after success. It starts at zero except for the log weighted mean goals. Stopping criteria are gradient infinity norm < 1e-7, the iteration limit, or five consecutive relative objective decreases < 1e-12. Relative decrease uses `max(1, abs(previous objective))` as denominator. Diagnostics distinguish gradient convergence, objective convergence, exhausted iterations, and line-search failure. Objective convergence does not imply the gradient threshold was reached.

Warm starts map a previous `FitResult` by team name. Team and match ordering is canonicalized for reproducibility. All-zero training goals are explicitly rejected because their prescribed initial intercept is negative infinity; empty or numerically zero-weight training is also rejected. The line search has a 100-backtrack safety bound and reports failure without claiming convergence.

## Validation checkpoint

The G1 test checks all nine coordinates at five seeded random points with nonzero ρ, nonzero ridge, unequal decay weights, all four low-score cases, and higher scores. Required maximum relative error: < 1e-5.

The G5 recovery experiment uses 20 teams, six double round-robin seasons (2,280 matches), and fixed seed 20261101. It explicitly uses **no decay** to retain the six-season sample, with the default ridge and other settings unchanged. Predeclared thresholds: attack and defense correlation > 0.9, each RMSE < 0.12, absolute ρ error < 0.05, and absolute home-advantage error < 0.08. This is a synthetic recovery test, not evidence of predictive performance on real matches. Defaults have not been tuned against evaluation windows.

Additional checks cover PMF properties, strict cutoff perturbations with identical fits and predictions, input-order invariance, initialization, centering, warm starts, rejection boundaries, and explicit non-convergence. The core portion of G7 is covered; its UI warning remains part of phase 5. G2's core cutoff protection is tested, but the full backtest gate remains part of phase 4. G6 is covered by the simulation tests below. G3, G4, and G8 are outside this checkpoint. G9 scans source and this README.

Measured checkpoint on Windows / Node.js 24: **39 tests passed, 0 failed, across 7 files**. Production build and TypeScript checks passed.

| Check | Measured result |
|---|---|
| G1 | Worst relative gradient error 7.39e-10 |
| PMF properties | All four tests passed, including 250 seeded parameter combinations |
| G5 attack | Correlation 0.9933; RMSE 0.0397 |
| G5 defense | Correlation 0.9717; RMSE 0.0679 |
| G5 global parameters | ρ = −0.10921 (truth −0.10); η = 0.19409 (truth 0.20) |
| G5 convergence | 1,060 iterations; objective 1.552996; gradient norm 1.45e-5; relative objective tolerance |
| Recovery fit duration | 301 ms for 2,280 matches |
| Default fit duration | 79 ms for 760 matches, below the 1-second budget |
| G6 exact enumeration | Largest position-probability error 0.001742 over 100,000 simulations; all cells within six standard errors + 0.0001 |
| Forecast engine duration | 139 ms for 10,000 simulations, 20 teams and 190 remaining fixtures; below the 4-second budget |
| G9 | Passed |

Timings are local measurements, not hardware-independent guarantees. Forecast timing measures the engine locally; it excludes browser worker startup and rendering. Backtest timing is not yet measurable.

The next phase is metrics, the application synthetic generator, and chronological backtesting with full gates G2–G4. The full product README, screenshots, UI controls including the advanced gradient check, and About disclosure belong to later phases. No real-data run has been performed.


## Phase 3 simulation

`table.ts` applies 3/1/0 points to current-season results only, then sorts by points, goal difference, goals for, and a seeded random key. There is no head-to-head rule. `rng.ts` implements Mulberry32 with an explicit unsigned 32-bit seed. `simulate.ts` requires a fit whose cutoff is the day after the latest completed match, and precomputes a flat, renormalized joint CDF for each unlocked fixture. One uniform samples both scores. Each run starts with the current table plus fixed what-if scores and uses fresh random tie-break keys. Inputs are not mutated.

With no remaining fixtures, the table's seeded final tie draw is held fixed across all runs, so the finished-season forecast equals that table exactly. This resolves the brief's zero-fixture determinism requirement alongside its random final tie-break rule. Locks can exceed the sampling grid; their scores are added exactly once. Unknown lock IDs, invalid scores, duplicate fixture IDs, stale cutoffs, invalid counts, and invalid thresholds fail explicitly.

Outputs include each team's full position distribution, title/top-K/bottom-K probabilities and Monte Carlo standard errors, expected rank, expected points, and nearest-rank empirical 5th–95th point percentiles. Defaults are 10,000 runs, top four and bottom three (clamped to league size). The core accepts up to 100,000 runs; free/Pro limits belong to the phase-6 entitlement module. More simulations reduce simulation noise and do **not** reduce model uncertainty.

Browser callers use `startSimulation(input, onProgress)` in `simulationClient.ts`, which returns `{ result, cancel }`. It creates a module Web Worker for the actual run, reports progress at zero, every 250 runs, and completion, and terminates on completion, error, or cancellation. Cancellation rejects the result promise with `AbortError`; callers must handle it. Worker errors propagate to the caller. UI controls and seed reshuffling belong to phase 5; rating-uncertainty bootstrap remains an unimplemented stretch goal.

G6 tests cover finished-season determinism including exact ties, row/column position sums, independent three-team exact enumeration with fair tie splitting, sampled means within six standard errors at negligible truncation, seeded reproduction, every tie-break criterion, locked results, CDF boundaries, and request validation. Additional worker tests cover transport, cleanup, progress, cancellation, and errors. An integration test bundles the actual worker with Vite and runs it in a Node worker thread using a browser-message transport adapter; a real-browser UI smoke test remains for phase 5. There are no phase-3 algorithmic deviations beyond the documented finished-season tie interpretation, and no new runtime dependencies. Work is committed directly to main as requested, overriding the brief's branch convention.
