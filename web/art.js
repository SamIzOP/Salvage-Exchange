// Original line-art for the three salvage sites and a small icon set. Every drawing uses
// currentColor with one stroke weight so the identities stay consistent wherever they appear.
const SITES = [
  // Crystal Belt: a fractured mineral belt strung along an orbit.
  `<path class="o" d="M4 76C48 54 104 44 156 50"/>
  <path class="f" d="M14 70l5-10 7 3-2 9z"/>
  <path class="f" d="M33 64l5-16 9-4 5 11-6 9z"/><path class="d" d="M38 48l6 8 2 8M44 56l8-1"/>
  <path class="f" d="M66 60l5-26 9-10 8 14-2 20-10 6z"/><path class="d" d="M80 24l-2 20-2 20M78 44l10-6M71 34l7 10"/>
  <path class="f" d="M86 58l8-16 7 6-3 12z"/>
  <path class="f" d="M110 56l4-12 10-4 6 9-6 9z"/><path class="d" d="M114 44l7 6 3 8M121 50l9-1"/>
  <path class="f" d="M138 54l3-8 7-1 2 7-6 4z"/>
  <g class="p"><circle cx="28" cy="57" r="1"/><circle cx="58" cy="44" r="1"/><circle cx="104" cy="38" r="1"/><circle cx="134" cy="39" r="1"/><circle cx="153" cy="60" r="1"/></g>`,
  // Derelict Cruiser: a hull broken in two, ribs exposed at the fracture.
  `<path class="o" d="M4 80h152"/>
  <path class="f" d="M8 58l18-12 32-6 8 2-4 6 6 4-6 6-32 4z"/>
  <path class="d" d="M34 45l4-9h12l2 6M40 51h4M48 50h4"/>
  <path class="f" d="M80 38l4 6-6 4 6 6-4 6 38 2 20-4 12-8-12-8-20-6z"/>
  <path class="d" d="M89 38v22M96 37v24M103 36v26M108 49h28M138 42v16M150 46h6M150 54h6"/>
  <path class="f" d="M70 44l4-2 1 4zM71 56l4-2 1 4z"/>
  <g class="p"><circle cx="76" cy="50" r="1"/><circle cx="66" cy="34" r="1"/><circle cx="92" cy="68" r="1"/></g>`,
  // Void Rift: a jagged tear that bends the space around it.
  `<path class="o" d="M4 20c46 0 56-8 76-8s30 8 76 8M4 76c46 0 56 8 76 8s30-8 76-8"/>
  <path class="d" d="M4 36c40 0 54-6 66-6M90 30c12 0 26 6 66 6M4 60c40 0 54 6 66 6M90 66c12 0 26-6 66-6"/>
  <path class="f" d="M80 8l6 16-4 10 8 14-8 14 4 12-6 16-6-18 4-12-8-12 8-12-4-14z"/>
  <path class="d" d="M80 20l-2 16 6 12-6 14 2 16"/>
  <g class="p"><circle cx="62" cy="48" r="1"/><circle cx="99" cy="44" r="1"/><circle cx="68" cy="22" r="1"/><circle cx="94" cy="76" r="1"/></g>`,
];

export const art = (j, cls = '') =>
  `<svg class="site-art ${cls}" viewBox="0 0 160 96" aria-hidden="true" focusable="false">${SITES[j]}</svg>`;

const ICONS = {
  copy: '<path d="M9 9h10v10H9zM5 15V5h10"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  lock: '<path d="M7.5 11V8a4.5 4.5 0 0 1 9 0v3M5.5 11h13v9h-13z"/>',
  alert: '<path d="M12 4l9 16H3zM12 10v4M12 17v.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  replay: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4"/>',
  skip: '<path d="M6 6l6 6-6 6M13 6l6 6-6 6"/>',
  up: '<path d="M12 18V6M7 11l5-5 5 5"/>',
  down: '<path d="M12 6v12M7 13l5 5 5-5"/>',
  link: '<path d="M10 14l4-4M8.5 11.5l-2 2a3 3 0 0 0 4 4l2-2M15.5 12.5l2-2a3 3 0 0 0-4-4l-2 2"/>',
  key: '<circle cx="8" cy="15" r="3.5"/><path d="M10.5 12.5L19 4M16 7l2.5 2.5M13.5 9.5l2 2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.4v.6M12 16.8v.5"/>',
  leave: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>',
  ledger: '<path d="M6 4h12v16H6zM9 8h6M9 12h6M9 16h3"/>',
  ops: '<path d="M4 18l5-6 4 3 7-9M15 6h5v5"/>',
  sync: '<path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3M18 3v4h-4M6 21v-4h4"/>',
  dot: '<circle cx="12" cy="12" r="3"/>',
};

export const icon = (name, cls = '') =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;

// A salvage drone: hull, side thrusters and two grapples.
export const drone = (cls = '') =>
  `<svg class="icon drone ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 8h8l3 4-3 4H8l-3-4zM5 12H2M19 12h3M9 16l-2 4M15 16l2 4M11 12h2"/></svg>`;

export const mark = (cls = '') =>
  `<svg class="mark ${cls}" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect x="1" y="1" width="30" height="30" rx="6"/><path d="M9 12h11l3 3M23 20H12l-3-3"/></svg>`;
