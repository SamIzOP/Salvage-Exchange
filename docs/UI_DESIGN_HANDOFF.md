# SALVAGE EXCHANGE — clinical UI design handoff

This is a design-only handoff. The game UI has not been implemented or deployed from these designs. Native editable frames, components, and variables live in Figma; this repository document links to them and records their status.

## Design file and frames

[Open the Figma Design file](https://www.figma.com/design/v1yLgSKHZcMF36tkozZTOb).

The supplied Figma Make file could not accept native Design frame edits, so the redesign was created in a separate Design file.

| Screen | Desktop — 1440 px | Mobile — 375 px |
| --- | --- | --- |
| Lobby | [Frame](https://www.figma.com/design/v1yLgSKHZcMF36tkozZTOb?node-id=2-63) | [Draft frame](https://www.figma.com/design/v1yLgSKHZcMF36tkozZTOb?node-id=2-66) |
| Secret planning | [Frame](https://www.figma.com/design/v1yLgSKHZcMF36tkozZTOb?node-id=2-64) | [Draft frame](https://www.figma.com/design/v1yLgSKHZcMF36tkozZTOb?node-id=2-67) |
| Reveal / upgrade | [Frame](https://www.figma.com/design/v1yLgSKHZcMF36tkozZTOb?node-id=2-65) | [Draft frame](https://www.figma.com/design/v1yLgSKHZcMF36tkozZTOb?node-id=2-68) |

## Status

- Desktop frames passed visual review.
- Mobile frames are drafts: the mission-room card and phase tracker still overflow horizontally. Do not treat them as implementation-ready.
- Figma's Starter tool quota prevented the final mobile corrections. The browser fallback also could not complete them. No successful correction is claimed.
- The frames use editable native layers and auto layout, rather than flattened UI screenshots.
- No game rules, balance numbers, application code, or deployment were changed for this design handoff.

## Design decisions

- Separate left-aligned lobby copy from the ship illustration, with resources below and a dedicated sector label.
- Reserve cyan for the primary action and the player's net worth. Use neutral surfaces for navigation and secondary actions.
- Use Inter for body text and JetBrains Mono for labels and numeric data.
- Use 4 px spacing increments, at most 8 px corner radii, and 1 px borders. Keep glow restrained to the ship and primary action.
- Pair market movement colors with explicit signs or arrows.
- Preserve mission navigation, players, phase tracker, planning controls, market preview, contracts, net-worth breakdown, and upgrade controls.

## Color variables

| Role | Color |
| --- | --- |
| Background | `#05080F` |
| Surface | `#0B111C` |
| Raised surface | `#121A2A` |
| Border | `#1E2A40` |
| Text | `#E8F0FA` |
| Muted text | `#8C9BB5` |
| Accent | `#5CE1FF` |
| On-accent text | `#03121A` |
| Danger / high risk | `#FF3DA5` |
| Crystal Belt | `#4DE3C1` |
| Derelict Cruiser | `#FFC857` |
| Void Rift | `#FF3DA5` |
| Alloys | `#8FB4FF` |
| Power Cores | `#FFC857` |
| Relic Tech | `#B58CFF` |
| Price up | `#3DF2A0` |
| Price down | `#FF3DA5` |

Calculated contrast against the raised surface: muted text 6.19:1; the lowest specified semantic text color 5.35:1. On-accent text against the primary button is 12.37:1. These palette checks are not a completed accessibility audit of an implemented application.

## Reusable Figma components

Button (primary and secondary, default / hover / focus / disabled), Card, Sector tag, Commodity chip, Stat block, Phase step, Order field, and Navigation item. Components use text properties and variable bindings.

## Remaining mobile corrections

Apply to all three mobile frames:

1. Reset the `Mission room` frame width to 311 px. A layout-direction change expanded it to 911 px.
2. Arrange the five existing phase instances into three auto-layout rows containing 2, 2, and 1 steps. Use 151.5 px-wide, 48 px-high instances inside a 311 px row with an 8 px gap. Preserve horizontal instance layout, set its primary axis sizing to fixed, keep the number at 20 px fixed width, and let the label fill the remaining space.
3. Set the mobile `Command deck` spacing to 24 px so the header, tracker, sidebar, and main content have clear separation.
4. Inspect all three mobile frames again for clipping, overlap, text wrapping, and horizontal overflow before marking complete.

The sample reveal reconciles as 636.00 cash + 98.20 shares + 166.91 cargo + 457.60 fleet = 1,358.71 net worth, a gain of 88.71 from the opening 1,270.00. Sample values are design content, not a new balance specification.

Implementation requires a separate instruction; this handoff does not authorize code or deployment changes.
