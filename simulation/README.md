# Offline economy simulator

This directory is Sprint 2 only. It is not a web app, game server, or multiplayer security implementation.

The frozen parameter source is `rules-v0.2.json`; readable rules are in `../ECONOMY.md`. Findings and limitations are in `../BALANCE_REPORT.md`.

From the project root, using Python 3.12 or later:

```text
python simulation/test_economy.py
python simulation/reproduce.py
python simulation/report.py
```

There are no external dependencies. The complete frozen suite plays 35,800 matches. `report.py` checks that the rules, model fingerprint, and seeds in every final result match the current source, reruns the tests, writes the report, and saves sample replay traces for the later implementation.

`economy.py` contains the offline rules and fixed policy implementations. `run.py` defines the tournament fields and per-seat win accounting. `reproduce.py` records all final seeds and sample sizes. To run a single suite:

```text
python simulation/run.py --rules simulation/rules-v0.2.json --games 2000 --seed 20401027 --out simulation/results/final-holdout.json
```

Without `--rules`, the runner uses the original v0.1 parameters with the corrected v2 policy implementation. This supports an apples-to-apples economy comparison. The early model snapshot `economy-policy-v1.py` preserves the first exploration's less effective cautious policy. `tune*.py`, `check_demand.py`, and the earlier result files are exploratory history, not the frozen validation suite; some earlier sweeps used that older policy snapshot. Do not rerun candidate selection/freezing scripts to reproduce final results; they are the historical tuning workflow.

Policy rates use wins divided by that policy's occupied seats; ties split wins. Four-distinct-policy comparisons use every subset of four of the five requested strategies. Duplicate tests cover all 70 four-seat multisets, including homogeneous fields, and report per-seat rather than per-policy-group wins. Do not read aggregate rates as evidence that every specific composition is balanced. The report explicitly retains the strong extractor-versus-traders counter-matchup and weak two-player pure-trading result.

Price, reserve, credit, fuel, and stock-limit assertions run during every simulated round. Tests additionally force rare recovery cases and reject invalid plans. The engine validates all plans before mutating state. Bots receive current public data and their own scan results; current hidden hazards and events are supplied to resolution separately.

Phase durations, real network secrecy, authentication/rejoin tokens, simultaneous locks over a network, phones, and the public deployment URL remain future process steps. No simulator output should be presented as their verification.
