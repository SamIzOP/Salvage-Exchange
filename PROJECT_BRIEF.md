You are my game designer and full-stack developer. Build a multiplayer browser game called SALVAGE EXCHANGE and deploy it to a live URL that other people can reach.

## Project requirements (must all be met)
1. At least 2 players can join from separate devices (desktop or mobile browsers).
2. The rules are clear enough that a new player can follow them without me explaining anything (on-screen phase tracker, one-screen briefing each round, tooltips).
3. The game is live at a public URL, and you give me that URL when finished.

## Concept
A starship has broken apart near an asteroid field. Rival corporations race to salvage it AND trade on the market that their salvage moves. Supply from extraction affects commodity prices, which affect everyone's portfolios. The richest corporation after the final round wins.

## Alpha rules (MVP scope)
- 2-4 players, 6 rounds, about 15-20 minutes per match
- 3 salvage sectors: Crystal Belt (low risk, low reward), Derelict Cruiser (medium), Void Rift (high risk, high reward)
- 3 commodity markets: Alloys, Power Cores, Relic Tech
- 3 company stocks (one mining/industrial, one energy, one tech)
- Starting resources per player: 750 Galactic Credits, 2 basic drones, 8 fuel, 0 stock, empty salvage inventory (treat these as starting assumptions to be tuned)

## Round structure (turn-based, no real-time physics)
1. Briefing: public market news, a public hazard table for each sector, and a public supply/demand indicator for each commodity. Players can spend credits on a private scan that reveals either one sector's hidden hazard or one upcoming market event. Private scans improve information but never guarantee a win.
2. Secret planning (simultaneous): each player locks in (a) drone and fuel allocation per sector, (b) a sealed extraction bid for any sector they want exclusive rights to, and (c) buy/sell orders for company stocks and commodities. The server holds every hidden order and reveals nothing until all players have locked in.
3. Resolution: contested sectors go to the highest sealed bid (or split yield proportionally if no one bids). Hazards roll using the public odds. Salvage is added to inventories.
4. Market update: commodity prices move based on total extracted supply, public demand, a limited amount of player trading pressure, and random events with disclosed probabilities. Cap every price change at +/-25% per round.
5. Reveal and upgrade: show net worth changes, then let players buy drones, scanners, repairs, or insurance.

## Key design decisions (follow these)
- Keep commodity markets and company stocks separate. A huge Alloy haul lowers the Alloy price, but a company's stock price depends on its profitability (output x price minus costs), not just how much was extracted. No single buy-and-mine strategy should dominate.
- Make the market understandable: players should be able to learn how prices move. Show the formula inputs in the UI.
- Include a Market-Impact Preview: before locking a plan, the player sees a simulator showing current price, projected price, their extracted units vs. total expected supply, and projected salvage value. Label it as an estimate, since other players' secret choices keep the final price uncertain.
- No bankruptcy elimination. A bankrupt player gets one basic emergency drone with limited extraction capacity so they can rebuild, but earlier losses still count.
- Drones depreciate so hoarding fleet value isn't free. Trading fees and position limits prevent infinite loops.
- Secret corporate objectives (one per player): Industrial Titan (raw material volume), Market Shark (profitable investments), Tech Pioneer (Relic Tech recovered), Logistics Empire (delivery contracts). The bonus should be small, about 5-10% of a typical winning net worth.
- EXCLUDE from v1: sabotage cards, short selling, and loans. List them as "future expansions" only.

## Scoring
Net worth = credits + stock holdings at market value + unsold salvage at market value + completed contracts + remaining fleet value (after depreciation) + objective bonus. Highest net worth after round 6 wins. Show a live net worth breakdown at all times.

## Technical requirements
- Room-code lobby: one player creates a room, others join with the code.
- Server-authoritative: all hidden orders, dice rolls, and resolution happen on the server. Clients never see other players' hidden data before reveal.
- State sync can be simple (WebSockets or polling). Handle disconnects and reconnects gracefully, and let a player rejoin with the same room code.
- Responsive UI that works on phones, with a polished sci-fi look (dark theme, neon accents, clear typography). Include a "How to play" panel and a phase tracker.
- Include a "waiting for players" indicator so everyone can see who has locked in.

## Process (do these in order, and show me your work at each step)
1. ECONOMY FIRST: Propose exact numbers: commodity base prices, sector hazard odds, drone costs and yields, scan costs, stock formulas, fees, depreciation, and the exact price-update formulas. Present them in a table.
2. SIMULATE: Write a quick script that plays thousands of automated matches with different strategies (heavy extractor, safe hauler, scanner-heavy, pure trader, random). Report win rates, check for dominant strategies, runaway wealth, and exploits, then adjust the numbers until no strategy wins more than about 40% in 4-player games.
3. BUILD: Implement the full game using the finalized numbers.
4. TEST: Run a full 2-player match end to end and fix bugs. Confirm that hidden orders stay hidden.
5. DEPLOY: Publish it and give me the live URL, a one-paragraph description of the rules, and a list of known limitations.

Ask me questions only if something is truly blocking. Otherwise, make reasonable assumptions and state them.