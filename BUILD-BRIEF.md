# Round 4: claude2 on convergence, plus the full build brief

## (a) My reaction

I agree with OddsLab over FixtureForge. I reached that on my own and didn't just take Ada's word for it. I'd defend FixtureForge on one point: it has the clearer buyer, because league organizers pay for schedulers. But its overnight risk is a solver that times out at 16 teams, and the honest "no schedule found" outcome makes for a thin morning demo. OddsLab's risk is bad fitting or leakage. Both can be caught by tests we write, so the result is falsifiable either way.

I'm changing three things from the pitch and from Ada's framing:

1. **Rename the product.** "OddsLab" contradicts the "no odds, no betting" boundary, and the name would show up in the UI, the store listing and the SEO. I'm using **LeagueLab** as the working name. Ada or JJ can override it, but the name shouldn't be "Odds" anything.
2. **Don't gate on beating the baseline with real data.** Over one season the confidence interval on the improvement often includes zero, so a gate on real data would be flaky or tempt us to tune until it passes. The hard gates run on synthetic data with a known truth. On real data the app reports whatever it finds, including "did not beat baseline."
3. **Add a null-world canary.** I generate data where every team is equal, and the model must not appear to beat the baseline. A leaky pipeline would "beat" the baseline even on pure noise, so this catches leakage that reassuring charts would hide.

The commercial caveat stands: this is easier to demonstrate than to sell. The paid tier targets club, fan-blog and local-league publishers who want embeddable forecasts. I'd treat tonight as demonstrating the technique, not as validating revenue.

---

## (b) BUILD BRIEF: LeagueLab (for Codex)

**Goal.** A client-only web app. The user imports completed results and a separate remaining-fixtures list for one double-round-robin league. It fits a time-decayed Dixon-Coles model, simulates the rest of the season, and shows standings probabilities. It also runs a leakage-free chronological backtest against a naive baseline and shows the outcome honestly.

**Conventions.**
- The project goes under `C:\Dev\personal\leaguelab\`.
- Use TypeScript, Vite, React and Vitest. If a sibling project from a prior night uses a different stack, match that stack instead.
- No backend, no network calls and no runtime dependencies beyond React. Draw charts as hand-written SVG.
- Git: work on a branch, write short imperative commit messages, and add **no `Co-Authored-By` or AI-attribution trailers**. This overrides any default.
- Don't change the defaults in `config/defaults.ts` after viewing backtest results on any evaluation window.

### 1. Scope boundaries (non-negotiable)

**In scope:**
- One format: a flat **double round-robin league** (N teams, every ordered pair plays exactly once per season, 3/1/0 points).
- Tie-breaks in table order: points, goal difference, goals for, then a seeded random draw. Head-to-head is not implemented. The UI states this.
- Two separate inputs: completed results, and remaining fixtures.
- All computation runs locally in the browser.

**Out of scope, with no stubs and no "coming soon":**
- Other formats: promotion or relegation playoffs, groups, knockouts, split seasons.
- Multiple leagues at once, live data fetching, accounts, a backend, xG or player data.
- **Anything betting-related.** The UI, copy, README, code identifiers and exports must contain no odds conversion, implied probability, "value", stake, tip or bookmaker concepts.
- The CSV importer **whitelists columns**: `Date, HomeTeam, AwayTeam, FTHG, FTAG` (optional `Div`, `Time`). It must never read any other column, so market-odds columns in football-data files are ignored by construction.
- **Lint test:** `tests/copy-lint.test.ts` scans `src/**` and `README.md` for the regex `\b(odds|bet|bets|betting|wager|stake|bookmaker|bookie|gambl\w*|punter|payout|implied probability|value bet)\b` (case-insensitive). The only exemption is the README block between `<!-- scope-statement:start -->` and `<!-- scope-statement:end -->`, which states what the app doesn't do. The test fails if anything else matches.
- No bundled real-world data. A real CSV is the user's own download from football-data.co.uk, kept in a gitignored `data/local/`. The demo uses a synthetic league.

### 2. Data model (`src/core/types.ts`)

```ts
type TeamId = string;                      // normalized trimmed name
interface CompletedMatch { date: string /*ISO yyyy-mm-dd*/; home: TeamId; away: TeamId; hg: number; ag: number; }
interface RemainingFixture { id: string; home: TeamId; away: TeamId; date?: string; }
interface Dataset {
  teams: TeamId[];                         // sorted
  completed: CompletedMatch[];             // all seasons loaded, sorted by date, stable
  remaining: RemainingFixture[];
  seasonStart: string;                     // current season's first date
}
interface FitConfig { halfLifeDays: number /*300*/; ridge: number /*0.01*/; rhoCap: number /*0.2*/; maxGoals: number /*10*/; maxIter: number /*5000*/; }
interface FitResult {
  teams: TeamId[]; attack: number[]; defense: number[];  // centered: sum = 0 each
  baseLog: number; homeAdv: number; rho: number;
  cutoff: string;                          // training used date < cutoff strictly
  nTrain: number; effectiveN: number;      // sum of weights
  diag: { iterations: number; objective: number; gradInfNorm: number; converged: boolean; reason: string };
}
```

**Importer rules:**
- Accept `dd/mm/yyyy`, `dd/mm/yy` and ISO dates. Trim team names. Reject negative or non-integer goals.
- Report line-numbered errors. Skip nothing silently: rows that can't be parsed are listed, and the user must acknowledge them.
- **Format validation (blocking):**
  - Every remaining team must exist in the completed data.
  - Within the current season, each ordered pair (home, away) appears exactly once across completed ∪ remaining.
  - Total fixtures = N(N−1).
  - On a mismatch, show the specific missing, duplicated or unknown pairs and block forecasting.
- **Season start:** default to the first date after the last gap longer than 45 days before the final completed match. The user can override it in a date picker. Training uses all loaded history. The league table uses only matches with `date ≥ seasonStart`.

### 3. Fitter spec (`src/core/dixonColes.ts`, `fitter.ts`, `gradcheck.ts`)

**Model.** For a match with home team h, away team a, goals (x, y):
- `u = log λ = c + η + a_h − d_a`
- `v = log μ = c + a_a − d_h`
- `d` is defensive strength: higher `d` means fewer goals conceded.
- `ρ = ρcap · tanh(r)`, which keeps ρ in (−ρcap, ρcap).

Joint pmf is `P(x,y) = τ(x,y) · Pois(x;λ) · Pois(y;μ)`, with:
- `τ(0,0) = 1 − λμρ`
- `τ(0,1) = 1 + λρ`
- `τ(1,0) = 1 + μρ`
- `τ(1,1) = 1 − ρ`
- `τ = 1` otherwise

The correction mass sums to zero over the infinite support. Truncate at `maxGoals` and **renormalize**. Tests assert the pmf is nonnegative and sums to 1, reduces to independent Poisson at ρ=0, and has no τ ≤ 0.

**Parameters.** `θ = [c, η, r, a_raw[0..n), d_raw[0..n)]`. The effective values are `a = a_raw − mean(a_raw)` and the same for `d`. This is an identifiable parameterization: the centering removes the shift ambiguity between `c`, `a` and `d`.

**Time decay.** For cutoff T and training matches with `date < T` (strict), the weight is `w_i = exp(−ξ·(T − t_i))` with `ξ = ln2 / halfLifeDays` and time in days.

**Objective** (minimize). With `W = Σ w_i`:

`J(θ) = −(1/W) Σ w_i [ log τ_i + x_i·u_i − λ_i + y_i·v_i − μ_i ] + ridge·(Σ a² + Σ d²)`

The ridge term is a **disclosed deviation** from the original Dixon-Coles model. It stabilizes small samples. Say so in the About page and the README. If any `τ_i ≤ 1e-6`, return `+Infinity` so the line search backs off.

**Analytic gradient.** Let `g_u, g_v` be the derivatives of the per-match log-likelihood with respect to `u, v`. The Poisson part contributes `x − λ` to `g_u` and `y − μ` to `g_v`. The τ part contributes:

| Score | ∂logτ/∂u | ∂logτ/∂v | ∂logτ/∂ρ |
|---|---|---|---|
| (0,0) | −λμρ/τ | −λμρ/τ | −λμ/τ |
| (0,1) | λρ/τ | 0 | λ/τ |
| (1,0) | 0 | μρ/τ | μ/τ |
| (1,1) | 0 | 0 | −1/τ |

Chain rule:
- `u` depends on `c` (+1), `η` (+1), `a_h` (+1), `d_a` (−1).
- `v` depends on `c` (+1), `a_a` (+1), `d_h` (−1).
- `dρ/dr = ρcap·(1 − tanh²r)`.
- Project the `a` and `d` gradients by subtracting their means to get the gradient with respect to the raw parameters.
- Add the ridge gradient `2·ridge·a` (and `d`), then project.

**Optimizer.** Hand-written gradient descent with a backtracking Armijo line search (c=1e-4, shrink 0.5, step growth ×2 after a success).
- Start at θ=0, except `c` starts at the log of the weighted mean goals.
- Stop when `‖g‖∞ < 1e-7`, or after `maxIter`, or when the relative objective decrease is below 1e-12 for 5 consecutive iterations.
- Always return `diag` with the iteration count, final objective, gradient norm and `converged`.
- If not converged, the UI shows a **"not converged"** warning and labels the forecast accordingly.
- The backtest warm-starts each block from the previous block's solution.

**Finite-difference gradient check** (`gradcheck.ts`, a pure function plus a test):
- Compute the central difference `(J(θ+he_k) − J(θ−he_k)) / 2h` with `h=1e-6` for **every** coordinate.
- Run it at 5 seeded random θ points with nonzero ρ, nonuniform decay weights and nonzero ridge.
- Use a dataset that contains all four low-score cases (0-0, 0-1, 1-0, 1-1) plus higher scores.
- Pass if the max relative error is below 1e-5, with relative error defined as `|a−n| / max(1, |a|, |n|)`.
- Expose "Run gradient check" in the Model screen's advanced section.

**Fitter tests:**
- **Parameter recovery.** Simulate a 20-team double round-robin repeated for 6 seasons from known θ, with a seeded RNG. The fit must recover `a`, `d` with correlation > 0.9 and RMSE below a documented threshold. It must recover `ρ` within ±0.05 and `η` within ±0.08.
- **Invariance.** Reordering teams or matches gives the same fit.
- **Strictness.** Matches with `date ≥ cutoff` have zero effect on the fit (see §5, G2).
- **Convergence.** The result reports `converged=true` on the recovery data, and a deliberately tiny `maxIter` produces `converged=false` with a reason.

### 4. Simulation spec (`simulate.ts`, `table.ts`, `rng.ts`)

- **RNG.** Seeded PRNG (`mulberry32` or `xoshiro128**`). The seed is shown in the UI and a "reshuffle" button picks a new one. The same seed and inputs must give identical outputs.
- **Per fixture.** Compute λ, μ from the fit at cutoff `T = day after the last completed match`. Precompute the renormalized joint CDF as a flat array and sample the score with one uniform per fixture.
- **Per simulation.** Start from the real table (completed matches in the current season). Add the locked what-if results as fixed scores and the sampled results for all other remaining fixtures. Sort by the tie-break rules in §1, with a per-simulation random key for the final tie-break.
- **Run.** Default 10,000 simulations, configurable up to 50,000 free and 100,000 paid. Run in a Web Worker with a progress callback and cancellation. Target under 4 seconds for 20 teams and 190 fixtures.
- **Outputs.** For each team:
  - the full N×N finishing-position probability matrix;
  - P(title), P(top K), P(bottom K), with K user-configurable (defaults 1, 4, 3);
  - expected points with a 5th–95th percentile range;
  - expected rank.
- **Monte Carlo error.** Show `sqrt(p(1−p)/N)` next to the probabilities. A visible note says that more simulations reduce simulation noise and do **not** reduce model uncertainty.
- **Stretch goal (P2, cut first):** an "include rating uncertainty" option that refits on 30 seeded bootstrap resamples of the training matches and uses one resample per block of simulations.

**Simulation tests:**
- With zero remaining fixtures, the output is deterministic and equals the real table.
- Each team's position distribution sums to 1, and each position column sums to 1 across teams.
- A 3-team toy league with 2 remaining fixtures matches exact enumeration of the pmf within MC tolerance.
- Mean sampled goals match λ and μ within MC tolerance.
- Seeded runs reproduce exactly.
- Tie-break unit tests: points, then GD, then GF, then random.

### 5. Backtest and acceptance-gate design (`backtest.ts`, `metrics.ts`, `synth.ts`)

**Protocol.** This must be leakage-free by construction.
- **Eligibility.** Test matches are the completed matches from the first date at which at least 100 earlier matches exist.
- **Blocks.** Group them into blocks of `blockDays = 7` by date. For each block, the training cutoff is the **block's first date**, and training uses only matches with `date < cutoff` (strict).
- **Prediction.** Fit once per block with warm start, then predict every match in the block from that single fit.
- **Training cutoff.** It is explicit and shown per block in the UI and exported table. The fit never sees the block's own results, and no hyperparameter is selected using test-window results.
- **Hyperparameters.** Fixed defaults only. The half-life sensitivity table (half-life of 120, 300 and 600 days, plus "no decay") is shown as **reported**, not used to pick the winner.
- **Baseline.** Empirical home/draw/away frequencies in the same training window (`date < cutoff`), using the same decay weights, with +1 smoothing.

**Metrics for the 1X2 outcome** (H, D, A ordered):
- **RPS**, defined as `½ Σ_{k=1,2} (cumP_k − cumO_k)²`.
- Multiclass **log loss**, with probabilities clamped to ≥ 1e-12.
- **Brier score**.
- Paired per-match loss differences (baseline minus model, so positive means the model is better) with a **seeded bootstrap 95% CI** (2,000 resamples). Label it approximate, since matches aren't independent.
- **Verdict banner:**
  - "Model better than baseline" only if the CI lower bound is above 0.
  - "Baseline better" if the CI upper bound is below 0.
  - Otherwise "Inconclusive on this sample."
  - If fewer than 200 test matches, add a "small sample" warning.

**Calibration.** Pool all three outcome classes into 10 equal-width bins on predicted probability. Show the count, mean predicted probability, observed frequency and Wilson 95% interval per bin. Grey out and label any bin with n < 20 as "too few to read". Report expected calibration error. Caption: "descriptive evidence from a finite sample, not proof of accuracy".

**Hard gates (all must pass in CI):**

| Gate | Test |
|---|---|
| G1 | Gradient check passes (§3). |
| G2 | **Perturbation leakage test.** Randomize the scores of all matches with `date ≥ cutoff`. The fit at that cutoff and all predictions made from it are **bit-identical** to the unperturbed run. |
| G3 | **Null canary.** Synthetic league with all teams equal (a=d=0, η>0). The backtest must **not** report "Model better". The mean RPS gain must be ≤ +0.001, and the verdict is "Inconclusive" or "Baseline better". |
| G4 | **Signal check.** Synthetic league with realistic strength spread over 3 seasons. The verdict is "Model better" (CI lower bound above 0) at the fixed seed, and the calibration ECE is below a documented threshold. |
| G5 | Parameter recovery (§3). |
| G6 | Simulation correctness tests (§4). |
| G7 | Every fit reports `converged`, and non-convergence surfaces in the UI. |
| G8 | Importer rejects malformed input and the format-validation errors fire. |
| G9 | Copy-lint (§1) passes. |

**Real data is not gated.** If network access is available, you may download one real season CSV into gitignored `data/local/` and run the backtest manually. Record the result in the README as a single run, not committed data, and say honestly whether it beat the baseline. If you don't run it, say so in the README instead of reporting numbers.

### 6. UI screens

Keep the UI to one page with tab navigation. The default state is the synthetic demo league (loaded via a "Load demo league" button). Chart SVGs should be accessible, with a text alternative or table beneath each. Stitch is optional. If used, make the Forecast and Evidence screens the priority.

1. **Data.**
   - Two drop zones: completed results (one or more CSVs) and remaining fixtures.
   - A validation report with line-numbered errors and a blocking format check.
   - Season-start picker and a team list.
   - A "Load demo league" button.
2. **Model.**
   - Shows the training cutoff, the fit button, and the convergence diagnostics (iterations, objective, gradient norm, converged badge).
   - A ratings table (attack, defense, net strength; sortable), plus ρ and home advantage.
   - Advanced settings: half-life, ridge, and "Run gradient check".
3. **Forecast.**
   - Table: team, points, expected points (with range), P(title), P(top K), P(bottom K) and expected rank, with MC error.
   - A position-probability heatmap.
   - Controls for simulation count, seed and K thresholds, with a progress bar and cancel.
4. **What-if.**
   - The remaining fixtures list with a score input to lock a result.
   - A delta table versus the unlocked baseline forecast.
   - Free tier: 1 lock. Paid: unlimited.
5. **Evidence (backtest).**
   - Run button, then a metrics table of model vs baseline with CIs.
   - The verdict banner, the calibration reliability chart with counts, and the half-life sensitivity table.
   - The per-block cutoff table and the small-sample warning.
   - This screen is **free** in both tiers.
6. **Export / Pro.**
   - Free: CSV export of the forecast table, with a footer line crediting LeagueLab.
   - Pro: embeddable static HTML widget generator, SVG/PNG chart export, saved scenarios with a comparison view.
   - License key entry field.
7. **About / Method.** Model description, the ridge deviation, limitations, and the scope statement including that the app has no betting functionality.

### 7. Monetization implementation

**Tier split.** Honest-evidence features are never paywalled.

| Feature | Free | Pro |
|---|---|---|
| Import, fit, forecast (≤ 50k sims) | yes | yes |
| Evidence screen and backtest | yes | yes |
| What-if locks | 1 | unlimited |
| CSV export | yes (with footer credit) | yes (no footer) |
| Embeddable widget, SVG/PNG export | no | yes |
| Saved scenarios and comparison | no | yes (up to 20) |
| Sim count cap | 50,000 | 100,000 |

**Widget.** A self-contained static HTML snippet with inline CSS and no JavaScript. It shows the probability table plus an "as of {date}, simulated from past results, not a guarantee" footer.

**License-key stub pattern** (mirrors prior nights; if a sibling project has a `license.ts`, copy its shape):
- `src/license/license.ts` validates key format `LL1-XXXXX-XXXXX-XXXXX-CCCC`, where the final group is a checksum (HMAC or CRC over the body using a constant in the source).
- `src/license/entitlements.ts` exposes `can(feature)` and `limit(feature)`. **All** gating goes through this single module, and no screen checks the license directly.
- The key is stored in `localStorage`.
- `scripts/make-key.ts` generates valid dev keys for testing.
- The code carries a prominent `// STUB: client-side only, trivially bypassable` comment. The README says this is a stub that **does not validate monetization**, and that real server-side validation is required before charging anyone.
- The Buy button links to a placeholder URL from `config/pricing.ts`. Prices there are placeholders, not a decision.

### 8. Test plan

Run Vitest unit and integration tests under `tests/`. Everything in the core is pure and seeded.

- **Importer:** the column whitelist, the date formats, bad rows, and each format-validation failure mode.
- **Dixon-Coles:** the pmf properties from §3.
- **Fitter:** the gradient check (G1), parameter recovery (G5) and convergence reporting (G7).
- **Backtest:** the leakage test (G2), the null canary (G3) and the signal check (G4).
- **Metrics:** hand-computed RPS, log loss and Brier on a few cases, and Wilson intervals against known values.
- **Simulation and table:** the §4 tests (G6).
- **License and entitlements:** valid key, bad checksum and gating through `can()`.
- **Copy-lint:** G9.
- **UI smoke test:** Vitest with jsdom or Playwright if available, covering demo load → fit → forecast → backtest, with the verdict banner rendered and no console errors.

CI command: `npm run test`. All gates G1–G9 must pass. Report timings against these budgets: fit under 1 second for 20 teams and 760 matches, forecast under 4 seconds, and backtest under 30 seconds.

### 9. README structure

1. What it is, in one paragraph and a screenshot.
2. The scope statement, inside the scope-statement markers. It says the app does not do betting, odds conversion or tips, and supports one league format only.
3. Quick start, plus how to use your own CSVs. The user downloads football-data.co.uk data themselves, and the README explains the format.
4. The method: model equations, time decay, the ridge deviation, simulation, and the tie-break rules.
5. **Evidence and honesty.** The leakage-free protocol, the baseline, the gate table with results, and the synthetic-data caveat. Say that calibration from small samples is descriptive and that 10,000 simulations don't remove model uncertainty. Include a real-data run only if one was actually done.
6. Free vs Pro table, and the license stub warning.
7. Known limits: point-estimate ratings, no head-to-head tie-break, a single format, no injuries or lineups.
8. Dev: scripts, tests, folder map.

### 10. Build order and cut order

**Order (about 7 hours):**
1. Scaffold and types (0.5h).
2. Core math, gradient check and fitter tests (1.5h).
3. Table and simulation (1h).
4. Metrics, synthetic generator and backtest with gates G2–G4 (1.5h).
5. UI (2h).
6. License, exports and the README (0.5h).

**If behind, cut in this order:** bootstrap rating uncertainty, the half-life sensitivity table, the widget generator, saved-scenario comparison. **Never cut** the gradient check, the leakage tests, the null canary, or the honest verdict display.

**Morning report from Codex:**
- the gate results table with real measured numbers;
- measured timings;
- any deviation from this brief;
- known limits, stated plainly;
- and an explicit statement of whether a real-data run was done.
