# LeagueLab

LeagueLab is a client-only model of one double round-robin league. This checkpoint implements phases 1–2: a TypeScript/Vite/React scaffold and a pure, tested Dixon–Coles fitting core. The application screens, import flow, tables, simulation, and backtest are not implemented in this checkpoint.

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

Additional checks cover PMF properties, strict cutoff perturbations with identical fits and predictions, input-order invariance, initialization, centering, warm starts, rejection boundaries, and explicit non-convergence. The core portion of G7 is covered; its UI warning remains part of phase 5. G2's core cutoff protection is tested, but the full backtest gate remains part of phase 4. G3, G4, G6, and G8 are outside this checkpoint. G9 scans source and this README.

Measured checkpoint on Windows / Node.js 24: **17 tests passed, 0 failed, across 4 files**. Production build and TypeScript checks passed.

| Check | Measured result |
|---|---|
| G1 | Worst relative gradient error 7.39e-10 |
| PMF properties | All four tests passed, including 250 seeded parameter combinations |
| G5 attack | Correlation 0.9933; RMSE 0.0397 |
| G5 defense | Correlation 0.9717; RMSE 0.0679 |
| G5 global parameters | ρ = −0.10921 (truth −0.10); η = 0.19409 (truth 0.20) |
| G5 convergence | 1,060 iterations; objective 1.552996; gradient norm 1.45e-5; relative objective tolerance |
| Recovery fit duration | 220 ms for 2,280 matches |
| Default fit duration | 76 ms for 760 matches, below the 1-second budget |
| G9 | Passed |

Timings are local measurements, not hardware-independent guarantees. Simulation and backtest timings are not yet measurable.

The next phase is table calculation, seeded season simulation, and their correctness tests (G6). The full product README, screenshots, UI controls including the advanced gradient check, and About disclosure belong to later phases. No real-data run has been performed.
