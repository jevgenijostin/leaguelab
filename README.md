# LeagueLab

LeagueLab is a client-only model of one double round-robin league. This checkpoint implements phases 1–4: a TypeScript/Vite/React scaffold, a tested Dixon–Coles fitting core, league tables, seeded simulation with a Web Worker client, synthetic leagues, and chronological backtesting. Application screens and the import flow remain for phase 5.

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

`src/core/types.ts` defines the brief's data model. `src/config/defaults.ts` contains frozen defaults. `dixonColes.ts` implements scoring rates and the renormalized, truncated joint PMF; `fitter.ts` implements the objective and optimizer; `gradcheck.ts` provides a pure central-difference checker. Tests live under `tests/`. The recovery sampler in `tests/helpers.ts` remains a test fixture; `synth.ts` is the application synthetic generator.

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

Additional checks cover PMF properties, strict cutoff perturbations with identical fits and predictions, input-order invariance, initialization, centering, warm starts, rejection boundaries, and explicit non-convergence. The core portion of G7 is covered; its UI warning remains part of phase 5. G2 now covers the full warm-started backtest block pipeline. G6 is covered by the simulation tests below. G3 and G4 are covered below; G8 remains outside this checkpoint. G9 scans source and this README.

Phase-3 checkpoint on Windows / Node.js 24: **39 tests passed, 0 failed, across 7 files**. Production build and TypeScript checks passed.

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

Timings are local measurements, not hardware-independent guarantees. Forecast timing measures the engine locally; it excludes browser worker startup and rendering. Phase-4 backtest timings appear below.

The next phase is phase 5: UI, including the Evidence screen and importer. The full product README, screenshots, UI controls including the advanced gradient check, and About disclosure belong to later phases. No real-data run has been performed.


## Phase 3 simulation

`table.ts` applies 3/1/0 points to current-season results only, then sorts by points, goal difference, goals for, and a seeded random key. There is no head-to-head rule. `rng.ts` implements Mulberry32 with an explicit unsigned 32-bit seed. `simulate.ts` requires a fit whose cutoff is the day after the latest completed match, and precomputes a flat, renormalized joint CDF for each unlocked fixture. One uniform samples both scores. Each run starts with the current table plus fixed what-if scores and uses fresh random tie-break keys. Inputs are not mutated.

With no remaining fixtures, the table's seeded final tie draw is held fixed across all runs, so the finished-season forecast equals that table exactly. This resolves the brief's zero-fixture determinism requirement alongside its random final tie-break rule. Locks can exceed the sampling grid; their scores are added exactly once. Unknown lock IDs, invalid scores, duplicate fixture IDs, stale cutoffs, invalid counts, and invalid thresholds fail explicitly.

Outputs include each team's full position distribution, title/top-K/bottom-K probabilities and Monte Carlo standard errors, expected rank, expected points, and nearest-rank empirical 5th–95th point percentiles. Defaults are 10,000 runs, top four and bottom three (clamped to league size). The core accepts up to 100,000 runs; free/Pro limits belong to the phase-6 entitlement module. More simulations reduce simulation noise and do **not** reduce model uncertainty.

Browser callers use `startSimulation(input, onProgress)` in `simulationClient.ts`, which returns `{ result, cancel }`. It creates a module Web Worker for the actual run, reports progress at zero, every 250 runs, and completion, and terminates on completion, error, or cancellation. Cancellation rejects the result promise with `AbortError`; callers must handle it. Worker errors propagate to the caller. UI controls and seed reshuffling belong to phase 5; rating-uncertainty bootstrap remains an unimplemented stretch goal.

G6 tests cover finished-season determinism including exact ties, row/column position sums, independent three-team exact enumeration with fair tie splitting, sampled means within six standard errors at negligible truncation, seeded reproduction, every tie-break criterion, locked results, CDF boundaries, and request validation. Additional worker tests cover transport, cleanup, progress, cancellation, and errors. An integration test bundles the actual worker with Vite and runs it in a Node worker thread using a browser-message transport adapter; a real-browser UI smoke test remains for phase 5. There are no phase-3 algorithmic deviations beyond the documented finished-season tie interpretation, and no new runtime dependencies. Work is committed directly to main as requested, overriding the brief's branch convention.

## Phase 4 evidence

`metrics.ts` provides ordered H/D/A RPS, multiclass log loss (floor 1e-12), unscaled multiclass Brier, Wilson 95% intervals, and seeded paired bootstrap comparisons. Each metric resamples per-match baseline-minus-model losses 2,000 times and uses interpolated percentile endpoints at 2.5% and 97.5%. These intervals are approximate because matches are not independent. The primary banner uses the RPS interval: strictly positive lower endpoint means "Model better than baseline", strictly negative upper endpoint means "Baseline better", otherwise "Inconclusive on this sample." Fewer than 200 evaluation matches sets the small-sample flag; an empty evaluation returns no metrics and an inconclusive verdict.

`backtest.ts` admits whole dates only after at least 100 strictly earlier matches exist. Seven-day windows are anchored at the first eligible date; empty windows are omitted. Each block's actual first observed date is its explicit training cutoff. One fit predicts the entire block, warm-started from the preceding block. Training and the baseline share strictly earlier observations and identical decay weights. The baseline adds one to each weighted H/D/A count and divides by total weight plus three. Results retain per-block fits, diagnostics, cutoffs, baseline probabilities, and individual predictions with cutoffs for the later UI/export layer. The main run always uses frozen defaults. The separate half-life sensitivity function reports 120, 300, 600 days and no decay, without selecting a winner.

Calibration pools all three classes into ten equal-width bins (the last includes probability one). Each bin exposes its count, mean prediction, observed frequency, and Wilson interval. Empty bins have null statistics. Counts below 20 carry a grey flag and "too few to read" label. ECE weights absolute calibration errors by pooled bin count. Caption: "descriptive evidence from a finite sample, not proof of accuracy".

`synth.ts` generates 20 teams, three complete double round-robin seasons, and 38 weekly rounds per season with an offseason gap. The circle schedule assigns every team one match per round and reverses venues for the second leg. Fixed seed **20261101** controls score sampling. Both worlds have base rate 1.25, home log advantage 0.2, and rho -0.1. Null ratings are exactly zero. Signal ratings are centered `0.42*sin(2.1*i)` attack and `0.38*cos(1.7*i)` defense, stable across all three seasons. Scores use the normalized 0–10 joint grid. The G4 ECE threshold **< 0.05** was declared before the first run. Neither seeds nor model defaults were tuned after evaluation.

Both full backtests evaluate **1,040 matches in 104 blocks** with bootstrap seed 20261101:

| Gate | Measured result |
|---|---|
| G2 | Cutoff 2023-01-02; 220 training matches; all 920 on/after-cutoff scores randomized (907 changed); target block's 10 predictions identical. Maximum numeric difference 0; 584 rating/probability bytes identical. Complete fits, diagnostics, baselines, and predictions also compare exactly across 13 sequential blocks. |
| G3 | Model RPS 0.235365527106; baseline 0.228853446792; mean gain **-0.006512080314**; 95% CI **[-0.010753181068, -0.002409580644]**; **Baseline better**; ECE 0.036206872689. |
| G4 | Model RPS 0.208139786342; baseline 0.233723360924; mean gain **+0.025583574582**; 95% CI **[+0.018186699243, +0.033385073209]**; **Model better than baseline**; ECE **0.020489461851 < 0.05**. |
| Timing | Initial full-suite measurements: null 3.61 seconds, signal 9.16 seconds; each below the 30-second budget. |

**Convergence limitation:** null has 104/104 converged blocks; signal has 77/104. The other 27 signal fits reach the unchanged 5,000-iteration limit, often with rho near the lower cap and slow progress through the tanh parameterization. Their gradient infinity norms range from approximately 6.50e-6 to 0.001384. Each block retains its actual diagnostics and an explicit "not converged" warning; the result also lists every affected cutoff. Predictions from these blocks remain in the evaluation. Phase 5 must render these warnings. This is synthetic evidence, not a claim about real-league accuracy.

The first test run had 51 passes and one failure from an extra assertion requiring every synthetic fit to converge. Inspection confirmed iteration exhaustion rather than a cutoff failure. That assertion was corrected to check honest propagation of convergence diagnostics, with a separate deliberately exhausted-fit test. The specified G2, G3 and G4 numerical requirements were unchanged and already met on the first run. No optimizer, seed, truth, threshold, or default was changed to improve the results.

Final cumulative phase-4 validation: **53 tests passed, 0 failed, across 9 files** (14.20 seconds). TypeScript and the production build passed. The prior 39 tests remain passing, with 14 new tests covering metrics, the generator, protocol, diagnostics, and gates.

Phase-4 protocol and hard gates have no algorithmic deviations from the brief. Window anchoring, Brier scaling, percentile interpolation, and empty-bin behavior above make its unspecified conventions explicit. Direct commits to main follow the user's instruction overriding the branch convention. Rendering banners, greying bins, and exporting cutoff tables belong to the UI/export phases; their data and labels are ready. No real-data run was performed.

## Phase 5: browser interface

The single-page app now opens with a synthetic demo league: 20 teams, 950 completed results across the loaded history, and 190 remaining fixtures in the current season. **Load demo league** resets the data and derived results. No real data is bundled and no real-data run was performed.

Run `npm install` and `npm run dev`, then use the Data, Model, Forecast, What-if, Evidence, Export / Pro, and About tabs. Fit the model in Model, run the unlocked forecast in Forecast, and run the chronological backtest in Evidence. Evidence remains free. Fitting, gradient checks, backtests and sensitivity runs execute in an analysis worker; simulations execute in their existing worker. Tasks can be cancelled. Changing data, fit settings or simulation inputs invalidates dependent results so old estimates cannot be presented as current.

Data accepts multiple completed-results CSVs selected together and a separate remaining-fixtures CSV. Importing the first file replaces the demo. Selecting new completed files replaces the history, so select all desired seasons together. Results require `Date,HomeTeam,AwayTeam,FTHG,FTAG`; fixtures require `HomeTeam,AwayTeam` with optional `Date`. Names are trimmed, quoted fields are supported, and extra fields are ignored. Accepted dates are ISO, dd/mm/yyyy and dd/mm/yy (two-digit years map to 2000–2099). Invalid rows are listed with file and physical line number and require explicit acknowledgment. Missing, duplicated and unknown pairs, incorrect fixture totals and invalid season boundaries block analysis independently of acknowledgment. The season picker initially follows the last gap longer than 45 days. All loaded history trains the model; only the current season contributes standings.

Evidence displays the actual RPS verdict, all three loss comparisons with paired gain intervals, the small-sample warning when applicable, and unconverged-block warnings. The handwritten SVG reliability chart shows counts and Wilson intervals; its full table includes empty and sparse bins. Half-life sensitivity runs report 120/300/600 days and no decay without selecting a winner. The block audit includes strict cutoff, training/effective sample sizes, test size, convergence, iteration count, objective, gradient norm and termination reason. The default demo evaluates **850 matches**; its rounded RPS gain is **0.0237**, with approximate 95% CI **[0.0147, 0.0319]**, ECE **0.0226**, and **18 unconverged blocks**. These differ from the full three-season G4 gate because the demo reserves its final 190 matches as unobserved fixtures. No frozen defaults were changed.

Forecast includes current and expected points, percentile ranges, title/top/bottom probabilities with Monte Carlo standard errors, expected rank, and an SVG position heatmap with a full table alternative. Seed, simulation count and thresholds are configurable; reshuffling changes the seed. What-if supports one Free result lock and a delta table against the unlocked forecast. About discloses the ridge deviation, tie-break order and model limits. Free CSV export works and includes the LeagueLab credit. The Export / Pro tab describes edition limits and explicitly disables license entry: license validation, centralized entitlements, paid exports, saved scenarios and comparisons are **not implemented yet**. These remain phase 6, together with the full README reorganization. All other requested phase-5 screens are implemented.

Validation for this phase:

| Check | Result |
|---|---|
| Cumulative Vitest suite | **67 passed, 0 failed**, 11 files, 27.52 seconds |
| Chromium browser tests | **2 passed, 0 failed**, 26.6 seconds |
| G8 | **11 importer tests passed**; browser checks also verify acknowledgment and format blocking |
| G9 | Existing exact source/README copy-lint test **passed** without additional exemptions |
| TypeScript / production build | Passed |

The new jsdom smoke test executes the bundled production workers in Node worker threads, adapting only the browser transport. It covers demo → fit → forecast → locked scenario → backtest, actual verdict and sensitivity rendering, invalidation and no console errors. Separate tests cover small samples and keyboard tab navigation. Vitest now discovers both `.test.ts` and `.test.tsx`. The Chromium checks exercise actual browser workers, cancellation, CSV download, import blocking and a 390-pixel mobile layout without page overflow or console errors. Screenshots are generated under gitignored `test-results/`.

For browser checks, run `npx playwright install chromium` once, then `npm run test:browser`. `npm run test` remains the CI unit/integration command, including G8/G9 and the worker-backed UI smoke test. Development-only jsdom and Playwright packages add no runtime dependencies. The existing G1–G6 numerical gates remain passing; convergence limitations remain disclosed rather than hidden. Bootstrap rating uncertainty remains omitted. Next: phase 6 license/entitlements, Pro exports and scenarios, and the complete README with screenshot and consolidated gate/timing report.
