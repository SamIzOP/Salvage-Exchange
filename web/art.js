// Interface icons, the drone glyph used in small controls, and the logo mark. The illustrated
// artwork (sites, yard, cargo, insignia) lives in scene.js.
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
  sound: '<path d="M4 9h4l5-4v14l-5-4H4zM16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/>',
};

export const icon = (name, cls = '') =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;

// A salvage drone: hull, side thrusters and two grapples.
export const drone = (cls = '') =>
  `<svg class="icon drone ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 8h8l3 4-3 4H8l-3-4zM5 12H2M19 12h3M9 16l-2 4M15 16l2 4M11 12h2"/></svg>`;

export const mark = (cls = '') =>
  `<svg class="mark ${cls}" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect x="1" y="1" width="30" height="30" rx="6"/><path d="M9 12h11l3 3M23 20H12l-3-3"/></svg>`;
