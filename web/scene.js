// Illustrated artwork for the salvage yard. Original SVG made for this project (see
// docs/ART_DIRECTION.md); nothing here is licensed from elsewhere. One key light comes from the
// upper left everywhere, surfaces are charcoal and steel, and colour is kept for light sources,
// cargo and signals. All drawings are decorative: the text beside them carries the meaning.

// Shared gradients and filters. Each drawing gets its own prefix so several can share a page.
const defs = p => `<defs>
  <linearGradient id="${p}-steel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a616c"/><stop offset=".45" stop-color="#363b44"/><stop offset="1" stop-color="#1c1f25"/></linearGradient>
  <linearGradient id="${p}-steel-dark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3f48"/><stop offset="1" stop-color="#15171c"/></linearGradient>
  <linearGradient id="${p}-rock" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4b4741"/><stop offset=".55" stop-color="#2b2926"/><stop offset="1" stop-color="#171615"/></linearGradient>
  <radialGradient id="${p}-glow-ice" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#bfe3ff" stop-opacity=".55"/><stop offset="1" stop-color="#bfe3ff" stop-opacity="0"/></radialGradient>
  <radialGradient id="${p}-glow-reactor" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffb37a" stop-opacity=".9"/><stop offset=".4" stop-color="#e2734a" stop-opacity=".45"/><stop offset="1" stop-color="#e2734a" stop-opacity="0"/></radialGradient>
  <radialGradient id="${p}-glow-rift" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#0b0814"/><stop offset=".42" stop-color="#140d24"/><stop offset=".62" stop-color="#7c5cd6" stop-opacity=".55"/><stop offset="1" stop-color="#7c5cd6" stop-opacity="0"/></radialGradient>
  <linearGradient id="${p}-crystal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e9f6ff"/><stop offset=".5" stop-color="#9cccec"/><stop offset="1" stop-color="#3f6f93"/></linearGradient>
  <filter id="${p}-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
  <filter id="${p}-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.4"/></filter>
</defs>`;

// ---------- the three sites (320 × 200 each) ----------

// Crystal Belt: fractured basalt masses split open by mineral light, with a claim beacon.
const belt = p => `
  <ellipse cx="170" cy="104" rx="130" ry="70" fill="url(#${p}-glow-ice)"/>
  <g class="drift">
    <path d="M40 132l18-20 22 4 6 18-20 12-24-2z" fill="url(#${p}-rock)"/>
    <path d="M58 112l22 4-8 6-18 2z" fill="#5e5952"/>
    <path d="M262 70l14-10 16 6-2 14-16 6z" fill="url(#${p}-rock)"/><path d="M276 60l16 6-12 3z" fill="#5e5952"/>
  </g>
  <path d="M96 150l24-58 52-26 58 18 26 46-30 34-78 8z" fill="url(#${p}-rock)"/>
  <path d="M120 92l52-26 58 18-52 4z" fill="#615b53"/>
  <path d="M226 130l30-0-30 34-30 6z" fill="#121110" opacity=".55"/>
  <g filter="url(#${p}-blur)" opacity=".85"><path d="M150 96l18-58 16 52zM196 98l26-40 6 46zM128 110l-6-34 22 26z" fill="#9cccec"/></g>
  <path d="M150 96l18-58 16 52-14 14z" fill="url(#${p}-crystal)"/><path d="M168 38l16 52-14 14z" fill="#5d8db3"/>
  <path d="M196 98l26-40 6 46-14 8z" fill="url(#${p}-crystal)"/><path d="M222 58l6 46-14 8z" fill="#4b7aa0"/>
  <path d="M128 110l-6-34 22 26-4 14z" fill="url(#${p}-crystal)"/><path d="M144 102l-4 14-18-40z" fill="#4b7aa0"/>
  <path d="M176 120l8-20 10 16-6 8z" fill="#d7ecff"/><path d="M110 140l6-14 8 10-4 6z" fill="#9cccec"/>
  <path d="M120 92l30 4 18 6-48 4z" fill="#d7ecff" opacity=".18"/>
  <path d="M168 40l-12 52M222 60l-18 40" stroke="#ffffff" stroke-opacity=".65" stroke-width="1.2"/>
  <g stroke="#2a2723" stroke-width="1.5" fill="none" opacity=".8"><path d="M118 132l30 4 22-8M200 140l24-14"/></g>
  <g><path d="M244 112v-22" stroke="#9aa3ad" stroke-width="2"/><path d="M238 112h12" stroke="#9aa3ad" stroke-width="2"/>
    <circle cx="244" cy="88" r="3" fill="#f2c25c"/><circle cx="244" cy="88" r="8" fill="#f2c25c" opacity=".2"/></g>
  <g fill="#cfe8ff"><circle cx="72" cy="70" r="1.5"/><circle cx="252" cy="160" r="1.3"/><circle cx="284" cy="120" r="1"/><circle cx="60" cy="166" r="1"/></g>`;

// Derelict Cruiser: a hull snapped in two, ribs bare at the break, the reactor still faintly lit.
const cruiser = p => `
  <ellipse cx="206" cy="112" rx="70" ry="44" fill="url(#${p}-glow-reactor)" opacity=".7"/>
  <path d="M18 112l26-22 70-10 14 4v52l-14 4-70-8z" fill="url(#${p}-steel)"/>
  <path d="M44 90l70-10 14 4-84 8z" fill="#7b828c"/>
  <path d="M58 82l8-16h28l6 12z" fill="url(#${p}-steel)"/><path d="M66 66h28l-2 4H68z" fill="#8a919b"/>
  <g fill="#f2d7a3" opacity=".75"><rect x="70" y="72" width="4" height="3"/><rect x="78" y="72" width="4" height="3"/><rect x="86" y="72" width="4" height="3"/></g>
  <g stroke="#1b1e23" stroke-width="1.2"><path d="M44 104h84M50 120h78M70 92v38M92 88v44"/></g>
  <g stroke="#7b828c" stroke-width="2" fill="none"><path d="M128 86v52M136 88l-4 46M144 92l-2 40"/></g>
  <path d="M128 98c10 4 8 20 18 24M128 124c8 2 6 14 14 16" stroke="#9aa3ad" stroke-width="1" fill="none"/>
  <g transform="rotate(-6 230 112)">
    <path d="M168 84l10 6v52l-10 6h104l34-14v-36l-34-14z" fill="url(#${p}-steel)"/>
    <path d="M168 84h104l34 14H178z" fill="#7b828c"/>
    <g stroke="#7b828c" stroke-width="2" fill="none"><path d="M176 92v46M184 90v50M192 90v50"/></g>
    <ellipse cx="226" cy="118" rx="14" ry="10" fill="#ffb37a" opacity=".9"/><ellipse cx="226" cy="118" rx="6" ry="4" fill="#fff1dc"/>
    <path d="M206 104h40v28h-40z" fill="none" stroke="#1b1e23" stroke-width="1.5"/>
    <g stroke="#1b1e23" stroke-width="1.2"><path d="M196 96v48M258 92v54M178 128h120"/></g>
    <path d="M306 104l12-6v40l-12-6z" fill="#2a2e35"/><path d="M318 98l6 2v36l-6 2z" fill="#4a3226"/>
  </g>
  <g fill="#c9ced6"><path d="M150 152l6-2 2 5-6 2z"/><path d="M160 72l4-1 1 4-4 1z"/><path d="M140 160l3-1 1 3-3 1z"/></g>
  <circle cx="226" cy="117" r="30" fill="url(#${p}-glow-reactor)" opacity=".5"/>`;

// Void Rift: a tear that bends light, broken relic segments caught at its edge.
const rift = p => `
  <g fill="none" stroke-linecap="round">
    <ellipse cx="160" cy="100" rx="150" ry="62" stroke="#7c5cd6" stroke-opacity=".18" stroke-width="2"/>
    <ellipse cx="160" cy="100" rx="122" ry="50" stroke="#9f86ea" stroke-opacity=".28" stroke-width="1.5"/>
    <path d="M20 70c60-30 220-30 280 0M20 130c60 30 220 30 280 0" stroke="#cbbcff" stroke-opacity=".22"/>
  </g>
  <ellipse cx="160" cy="100" rx="96" ry="78" fill="url(#${p}-glow-rift)"/>
  <path d="M160 26c-10 22 6 36-6 54s10 30-2 48 8 30 8 48" stroke="#e4dbff" stroke-width="2" fill="none" opacity=".9"/>
  <path d="M160 26c-10 22 6 36-6 54s10 30-2 48 8 30 8 48" stroke="#b99cff" stroke-width="7" fill="none" opacity=".35" filter="url(#${p}-soft)"/>
  <g transform="rotate(-18 92 74)"><path d="M70 64h40l6 10h-52z" fill="url(#${p}-steel)"/><path d="M76 70h4M86 70h4M96 70h4" stroke="#d6c7ff" stroke-width="1.5"/></g>
  <g transform="rotate(24 236 132)"><path d="M214 124l38-6 8 10-40 8z" fill="url(#${p}-steel-dark)"/><path d="M222 128l4-1M232 126l4-1M242 124l4-1" stroke="#d6c7ff" stroke-width="1.5"/></g>
  <path d="M226 52a34 34 0 0 1 32 26" stroke="#8b919b" stroke-width="6" fill="none"/><path d="M226 52a34 34 0 0 1 32 26" stroke="#d6c7ff" stroke-width="1" stroke-dasharray="2 5" fill="none"/>
  <path d="M84 140l14-18 10 6-8 20z" fill="#3b3550"/><path d="M98 122l10 6-6 3z" fill="#9f86ea"/>
  <g fill="#efe9ff"><circle cx="160" cy="60" r="1.6"/><circle cx="150" cy="118" r="1.2"/><circle cx="174" cy="146" r="1"/><circle cx="60" cy="40" r="1"/><circle cx="280" cy="170" r="1"/></g>`;

const SITES = [belt, cruiser, rift];
let serial = 0;

// A full illustration of one site. `id` keeps gradient ids unique on the page.
export const siteArt = (j, id = `sa${serial++}`, cls = '') =>
  `<svg class="site-illo ${cls}" viewBox="0 0 320 200" aria-hidden="true" focusable="false">${defs(id)}${SITES[j](id)}</svg>`;

// ---------- the yard backdrop (1200 × 420) ----------

// Space, a lit planet limb for tonal range, and the home dock: deck, gantry crane, containers and
// numbered pads. Sites sit over this at fixed anchor points (see SITE_ANCHORS).
export function yard(id = `yd${serial++}`) {
  const p = id;
  return `<svg class="yard-art" viewBox="0 0 1200 420" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${defs(p)}
    <defs>
      <linearGradient id="${p}-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0c0e12"/><stop offset="1" stop-color="#14171c"/></linearGradient>
      <radialGradient id="${p}-limb" cx=".38" cy="1.9" r="1.55"><stop offset=".88" stop-color="#2b2a28"/><stop offset=".93" stop-color="#4f4436"/><stop offset=".955" stop-color="#b98a55" stop-opacity=".55"/><stop offset=".975" stop-color="#b98a55" stop-opacity="0"/></radialGradient>
      <pattern id="${p}-hazard" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="14" fill="#c8a24a"/><rect x="7" width="7" height="14" fill="#1b1c1f"/></pattern>
    </defs>
    <rect width="1200" height="420" fill="url(#${p}-sky)"/>
    <g fill="#e8e0cf" opacity=".5"><circle cx="420" cy="40" r="1"/><circle cx="610" cy="22" r="1.2"/><circle cx="760" cy="64" r=".9"/><circle cx="980" cy="30" r="1.1"/><circle cx="1130" cy="90" r=".8"/><circle cx="330" cy="120" r=".8"/><circle cx="870" cy="140" r=".7"/><circle cx="520" cy="96" r=".7"/></g>
    <rect width="1200" height="420" fill="url(#${p}-limb)"/>
    <g class="yard-dock">
      <path d="M0 300h236l18 16v104H0z" fill="url(#${p}-steel-dark)"/>
      <path d="M0 300h236l18 16H0z" fill="#59606a"/>
      <rect x="0" y="316" width="254" height="8" fill="url(#${p}-hazard)" opacity=".75"/>
      <g stroke="#0e1013" stroke-width="1.2"><path d="M60 324v96M140 324v96M220 324v96"/></g>
      <path d="M26 300V96h12v204M26 96h170v12H38" fill="#3c424b"/>
      <path d="M38 108l40-12M60 108l40-12M82 108l40-12M104 108l40-12M126 108l40-12M148 108l40-12" stroke="#2a2e35" stroke-width="3"/>
      <path d="M26 96h170" stroke="#7b828c" stroke-width="2"/>
      <path d="M176 108v58" stroke="#9aa3ad" stroke-width="1.5"/>
      <path d="M166 166h20l-4 12h-12z" fill="#7b828c"/><path d="M168 178l-6 10M184 178l6 10" stroke="#9aa3ad" stroke-width="2"/>
      <g><rect x="44" y="246" width="70" height="54" fill="#5b4632"/><rect x="44" y="246" width="70" height="8" fill="#7a5f43"/>
        <path d="M54 256v40M64 256v40M74 256v40M84 256v40M94 256v40M104 256v40" stroke="#3e3022" stroke-width="2"/>
        <rect x="118" y="262" width="58" height="38" fill="#3e4a52"/><rect x="118" y="262" width="58" height="7" fill="#57656e"/>
        <path d="M128 270v28M138 270v28M148 270v28M158 270v28M168 270v28" stroke="#2b343a" stroke-width="2"/>
        <rect x="56" y="214" width="52" height="32" fill="#4a4f3a"/><rect x="56" y="214" width="52" height="6" fill="#646a4e"/>
        <circle cx="82" cy="231" r="7" fill="none" stroke="#c9b98a" stroke-width="1.5"/></g>
      <rect x="196" y="270" width="6" height="30" fill="#3c424b"/><circle cx="199" cy="266" r="3.5" fill="#f2c25c"/><circle cx="199" cy="266" r="10" fill="#f2c25c" opacity=".18"/>
    </g>
  </svg>`;
}

// Where things sit on the 1200 × 420 yard, in percent, so HTML tokens and labels can overlay it.
export const SITE_ANCHORS = [{x: 37, y: 47}, {x: 63, y: 40}, {x: 87, y: 47}];
export const DOCK_PADS = [{x: 4.5, y: 66}, {x: 9.5, y: 66}, {x: 14.5, y: 66}, {x: 19.5, y: 66}, {x: 7, y: 54}, {x: 12, y: 54}];

// Route from a dock pad to a point at a site (both in percent), drawn in the 1200 × 420 space.
export function route(pad, j, tx = SITE_ANCHORS[j].x, ty = SITE_ANCHORS[j].y) {
  const a = DOCK_PADS[pad] ?? DOCK_PADS[0];
  const ax = a.x * 12, ay = a.y * 4.2, bx = tx * 12, by = ty * 4.2;
  const mx = (ax + bx) / 2, my = Math.min(ay, by) - 60 - j * 22;
  return `M${ax.toFixed(1)} ${ay.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`;
}

// ---------- small marks ----------

// One drone family: a squat salvage hull with side thrusters and a grapple.
export const droneGlyph = (cls = '') =>
  `<svg class="drone-glyph ${cls}" viewBox="0 0 32 24" aria-hidden="true" focusable="false"><path d="M8 7h16l4 5-4 5H8l-4-5z" fill="currentColor"/><path d="M10 7l2-3h8l2 3" fill="currentColor" opacity=".6"/><path d="M4 12H1M28 12h3" stroke="currentColor" stroke-width="2"/><path d="M13 17l-2 5M19 17l2 5" stroke="currentColor" stroke-width="1.6"/><rect x="13" y="10" width="6" height="3" rx="1" fill="#14161a" opacity=".55"/></svg>`;

// Cargo is told apart by form as well as colour: ingots, power cells and relic shards.
const CARGO = [
  // Alloys: a stack of ingots.
  '<path d="M3 15l3-4h12l3 4z" fill="currentColor" opacity=".55"/><path d="M3 15h18v4H3z" fill="currentColor"/><path d="M6 11l2-3h8l2 3z" fill="currentColor" opacity=".85"/>',
  // Power Cores: a capped cell with a charge band.
  '<rect x="7" y="4" width="10" height="16" rx="2" fill="currentColor"/><rect x="9" y="2" width="6" height="3" rx="1" fill="currentColor" opacity=".7"/><rect x="7" y="10" width="10" height="3" fill="#14161a" opacity=".55"/>',
  // Relic Tech: an angular shard with an etched notch.
  '<path d="M12 2l7 9-4 11H9L5 11z" fill="currentColor"/><path d="M12 6l3 5-3 6-3-6z" fill="#14161a" opacity=".45"/>',
];
export const cargoIcon = (j, cls = '') =>
  `<svg class="cargo-icon c${j} ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${CARGO[j]}</svg>`;

// Company marks: Ferrum's anvil bar, Helion's split sun, Aether's ringed eye.
const INSIGNIA = [
  '<rect x="2" y="2" width="20" height="20" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 9h12l-3 4H9z" fill="currentColor"/><path d="M10 13v4M14 13v4" stroke="currentColor" stroke-width="1.6"/>',
  '<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 6a6 6 0 0 1 0 12z" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" stroke-width="1.6"/>',
  '<path d="M2 12c4-6 16-6 20 0-4 6-16 6-20 0z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/><path d="M5 18l14-12" stroke="currentColor" stroke-width="1.2" opacity=".6"/>',
];
export const insignia = (j, cls = '') =>
  `<svg class="insignia i${j} ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${INSIGNIA[j]}</svg>`;

// Yard Dispatch: the mentor's emblem, a signal mast inside a docking ring.
export const dispatchMark = (cls = '') =>
  `<svg class="dispatch-mark ${cls}" viewBox="0 0 40 40" aria-hidden="true" focusable="false"><circle cx="20" cy="20" r="18" fill="#22252b" stroke="#d9a066" stroke-width="2"/><path d="M8 26a13 13 0 0 1 24 0" fill="none" stroke="#d9a066" stroke-width="1.6" opacity=".55"/><path d="M20 30V12M16 30h8" stroke="#efe7d6" stroke-width="2.2" stroke-linecap="round"/><path d="M14 14a8 8 0 0 1 12 0M11 10a12 12 0 0 1 18 0" fill="none" stroke="#efe7d6" stroke-width="1.6" stroke-linecap="round"/><circle cx="20" cy="12" r="2.2" fill="#d9a066"/></svg>`;
