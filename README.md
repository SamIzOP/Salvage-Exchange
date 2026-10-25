# SALVAGE EXCHANGE

A multiplayer browser game concept about salvaging a wrecked starship and trading on the markets your extraction affects.

**Current status: economy design and offline simulation are complete. The browser game, multiplayer server, end-to-end browser testing, and public deployment have not been built yet.**

## Work saved

- [Project brief](PROJECT_BRIEF.md): the full game requirements and five-step process.
- [Economy v0.2](ECONOMY.md): exact rules and tuned parameters for the first implementation.
- [Balance report](BALANCE_REPORT.md): 35,800 final-rules automated matches, strategy win rates, checks, and limitations.
- [Simulator](simulation/README.md): reproducible Python simulation, parameter files, and raw results.
- [Sprint status](SPRINT_STATUS.md): completed work and the next authorized step.

## Simulation

Use Python 3.12 or later. No third-party packages are required.

```sh
python simulation/test_economy.py
python simulation/reproduce.py
python simulation/report.py
```

The 10,000-match mixed-strategy four-player benchmark put all five policies below a 40% win rate, with 32 passing regression/invariant checks. This does **not** establish universal balance: a lone extractor strongly counters three pure traders, and pure trading is weak in two-player matches. See the full report before interpreting the results.

## Next sprint

Build the server-authoritative multiplayer game using `ECONOMY.md` and `simulation/rules-v0.2.json`, including room codes, private plans, market previews, reconnect support, and responsive sci-fi UI. The project is being completed one process step at a time; the separate full-match test and deployment sprints follow afterward.
