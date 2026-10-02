// Mockup harness: the app's components, ported to HTML/SVG at their exact geometry.
// Tokens come from src/theme.ts via tokens.json (tokens.mjs writes it). Every number below cites its
// component. How to render, and what was calibrated: README.md.
'use strict';

const q = new URLSearchParams(location.search);
const THEME = q.get('theme') || 'day';
const W = +(q.get('w') || 390);
const H = +(q.get('h') || 844);
const INSET = +(q.get('inset') || 47);
const INSET_BOTTOM = +(q.get('insetBottom') || 34);
const SCENE = q.get('scene') || 'calib-lists';

let C; // palette
const isDay = THEME === 'day';

// ---------- small helpers ----------
const px = (n) => `${n}px`;
const UNITLESS = new Set(['opacity', 'flex', 'zIndex', 'fontWeight']);
function el(tag, cls, style, html) {
  const s = style ? ` style="${Object.entries(style).map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${typeof v === 'number' && !UNITLESS.has(k) ? v + 'px' : v}`).join(';')}"` : '';
  return `<${tag} class="${cls || ''}"${s}>${html ?? ''}</${tag}>`;
}
const V = (style, html, cls = '') => el('div', 'v ' + cls, style, html);
const R = (style, html, cls = '') => el('div', 'v row ' + cls, style, html);
const T = (style, text) => el('div', 't', style, esc(text));
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
const fontOf = { sans: 'NS400', sansMedium: 'NS500', sansSemiBold: 'NS600', serif: 'SS400' };
// `bandAt(colors, i)` for i < 64, precomputed by tokens.mjs, so the bounce lives only in bands.ts.
const band = (i) => C.bandList[Math.max(i, 0)];
let uid = 0;
const id = (p) => `${p}${++uid}`;

// ---------- icons (src/components/icons.tsx) ----------
const ICON = {
  trash: '<path d="M4 6.5h16M9.5 6.5V4.5h5v2M6.5 6.5l1.1 12.6a1 1 0 0 0 1 .9h6.8a1 1 0 0 0 1-.9l1.1-12.6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  restore: '<path d="M4.5 10a7.5 7.5 0 1 1 1.9 6.6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 5v5h5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  pencil: '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4L16.5 3.5z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M14.5 5.5l3 3" stroke-width="2" stroke-linecap="round"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
  chevronRight: '<path d="M9 5l7 7-7 7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  chevronLeft: '<path d="M15 5l-7 7 7 7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  // New: SearchIcon, drawn in PencilIcon/TrashIcon's style.
  search: '<circle cx="10.5" cy="10.5" r="6.5" stroke-width="2"/><path d="M15.5 15.5L20 20" stroke-width="2" stroke-linecap="round"/>',
  // New: PlusIcon, CloseIcon, ArrowUpIcon, ArrowDownIcon, same style.
  plus: '<path d="M12 5v14M5 12h14" stroke-width="2" stroke-linecap="round"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke-width="2" stroke-linecap="round"/>',
  arrowUp: '<path d="M12 19V5M6.5 10.5L12 5l5.5 5.5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  arrowDown: '<path d="M12 5v14M6.5 13.5L12 19l5.5-5.5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
};
const icon = (name, color, size) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}">${ICON[name]}</svg>`;

// ---------- IconButton (36 round; fill / 1pt outline) ----------
function IconButton({ fill, outline, glyph, dot }) {
  const style = { width: 36, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center' };
  if (fill) style.backgroundColor = fill;
  if (outline) style.border = `1px solid ${outline}`;
  const d = dot
    ? V({ position: 'absolute', top: -2, right: -2, width: 12, height: 12, borderRadius: 999, backgroundColor: C.primary, border: `2px solid ${C.skyTop}` })
    : '';
  return V(style, glyph + d);
}

// ---------- PillButton (sm 36, outline / filled) ----------
function PillButton({ label, variant = 'outline' }) {
  const filled = variant === 'filled';
  return R(
    { height: 36, paddingLeft: 16, paddingRight: 16, borderRadius: 999, border: `1px solid ${filled ? C.primary : C.outline}`, backgroundColor: filled ? C.primary : 'transparent', alignItems: 'center', justifyContent: 'center' },
    T({ fontFamily: filled ? fontOf.sansSemiBold : fontOf.sans, fontSize: filled ? 16 : 17, color: filled ? C.onPrimary : C.text, whiteSpace: 'nowrap' }, label)
  );
}

// ---------- AddBar (52 pill: input + filled button, 20 inset) ----------
const barSurface = () => ({ marginLeft: 20, marginRight: 20, borderRadius: 999, border: `1px solid ${C.surfaceOutline}`, backgroundColor: C.surface, boxShadow: `0px 3px 16px ${C.barShadow}` });
function AddBar({ placeholder, value = '', button, disabled }) {
  return R(
    { ...barSurface(), height: 52, alignItems: 'center', gap: 8, paddingLeft: 16, paddingRight: 4 },
    R({ flex: 1, height: '100%', alignItems: 'center' }, T({ fontFamily: fontOf.sans, fontSize: 17, color: value ? C.text : C.textMuted }, value || placeholder)) +
      R({ height: 40, paddingLeft: 16, paddingRight: 16, borderRadius: 999, backgroundColor: disabled ? C.primaryDisabled : C.primary, alignItems: 'center', justifyContent: 'center' },
        T({ fontFamily: fontOf.sansSemiBold, fontSize: 17, color: C.onPrimary }, button))
  );
}

// ---------- New: the search panel (field on the bar's surface + small surface picker) ----------
function SearchField({ placeholder, value }) {
  return R(
    { ...barSurface(), height: 52, alignItems: 'center', gap: 8, paddingLeft: 16, paddingRight: 4 },
    icon('search', C.textMuted, 18) +
      R({ flex: 1, height: '100%', alignItems: 'center' }, T({ fontFamily: fontOf.sans, fontSize: 17, color: value ? C.text : C.textMuted }, value || placeholder)) +
      (value ? V({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, icon('close', C.textMuted, 18)) : V({ width: 44, height: 44 }))
  );
}
// Sort buttons: equal widths, so a face changing (A–Z → Z–A) never shifts its neighbours.
// On: a `primary` pill like the picker's checked segment. Off: the bar's `surface`.
function SortButton({ face, arrow, on }) {
  const ink = on ? C.onPrimary : C.text;
  return R({ flex: '1 1 0', height: 36, paddingLeft: 6, paddingRight: 6, gap: 4, borderRadius: 999, alignItems: 'center', justifyContent: 'center', border: `1px solid ${on ? C.primary : C.surfaceOutline}`, backgroundColor: on ? C.primary : C.surface },
    T({ fontFamily: on ? fontOf.sansMedium : fontOf.sans, fontSize: 15.5, color: ink, whiteSpace: 'nowrap' }, face).replace('class="t"', 'class="t seg"') +
    (arrow ? icon(arrow, ink, 16) : '')).replace('class="v row ', 'class="v row sortbtn ');
}
function SortRow(buttons) {
  return R({ marginLeft: 20, marginRight: 20, marginTop: 8, gap: 8 }, buttons.map(SortButton).join(''));
}
// SegmentedPicker size="small" track="surface": 36 tall, padding 3, options flex 1, padding 6, 15.5.
function SegmentedPicker({ options, checked, style = {} }) {
  return R(
    { height: 36, padding: 3, borderRadius: 999, border: `1px solid ${C.surfaceOutline}`, backgroundColor: C.surface, ...style },
    options.map((o) => {
      const on = o === checked;
      return V({ flex: '1 1 0', paddingLeft: 6, paddingRight: 6, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.primary : 'transparent', overflow: 'hidden' },
        T({ fontFamily: on ? fontOf.sansMedium : fontOf.sans, fontSize: 15.5, color: on ? C.onPrimary : C.text, whiteSpace: 'nowrap' }, o).replace('class="t"', 'class="t seg"'));
    }).join('')
  );
}
function SearchPanel({ placeholder, value, sorts }) {
  return V({}, SearchField({ placeholder, value }) + SortRow(sorts));
}

// ---------- New: the coverage line (under the slot) ----------
function CoverageLine({ text, tryAgain }) {
  return R(
    { marginTop: 10, paddingLeft: 24, paddingRight: 20, alignItems: 'center', gap: 12 },
    T({ flex: 1, fontFamily: fontOf.sans, fontSize: 15, lineHeight: '20px', color: C.textSecondary }, text) +
      (tryAgain ? PillButton({ label: 'Try again' }) : '')
  );
}

// ---------- The limit sentence's surface (ListsScreen `full`), reused for the bin sentence ----------
function Sentence({ text }) {
  return V(
    { justifyContent: 'center', minHeight: 52, marginLeft: 20, marginRight: 20, paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8, borderRadius: 20, border: `1px solid ${C.surfaceOutline}`, backgroundColor: C.surface, boxShadow: `0px 3px 16px ${C.barShadow}` },
    T({ fontFamily: fontOf.sans, fontSize: 15, lineHeight: '20px', color: C.text }, text)
  );
}

// ---------- ShowDeletedToggle ----------
function Toggle({ checked, label }) {
  return R(
    { alignItems: 'center', gap: 12, paddingLeft: 24, paddingRight: 24, paddingTop: 8, paddingBottom: 8, alignSelf: 'flex-start' },
    V({ width: 36, height: 22, borderRadius: 999, padding: 2, justifyContent: 'center', backgroundColor: checked ? C.primary : C.switchTrack },
      V({ width: 18, height: 18, borderRadius: 999, alignSelf: checked ? 'flex-end' : 'flex-start', backgroundColor: checked ? C.onPrimary : C.switchKnob })) +
      T({ fontFamily: fontOf.sans, fontSize: 17, color: C.text }, label)
  );
}

// ---------- Sky (Lists' 520pt layer) ----------
const STARS = [
  [7, 18, 1.1, 0.8], [18, 42, 0.7, 0.5], [24, 12, 0.9, 0.65], [33, 58, 1.3, 0.9],
  [41, 24, 0.6, 0.4], [52, 46, 1, 0.7], [61, 15, 0.8, 0.55], [68, 66, 1.2, 0.85],
  [77, 30, 0.7, 0.5], [85, 10, 1, 0.75], [92, 50, 0.9, 0.6], [12, 70, 0.8, 0.45],
  [28, 82, 1.1, 0.7], [46, 74, 0.6, 0.4], [58, 88, 0.9, 0.6], [72, 78, 1.2, 0.8],
  [88, 68, 0.7, 0.5], [4, 40, 0.9, 0.55], [96, 30, 0.8, 0.65], [37, 8, 1, 0.7],
  [64, 40, 0.6, 0.4], [15, 25, 1.1, 0.8], [80, 84, 0.8, 0.5], [50, 6, 0.7, 0.45],
];
function Sky(height) {
  const g = id('sky');
  const stars = isDay ? '' : STARS.map(([x, y, r, o]) => `<ellipse cx="${(x / 100) * W}" cy="${(y / 100) * height}" rx="${r * W / 400}" ry="${r}" fill="${C.celestial}" opacity="${o}"/>`).join('');
  return `<svg width="${W}" height="${height}"><defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.skyTop}"/><stop offset="1" stop-color="${C.skyHorizon}"/></linearGradient></defs><rect width="${W}" height="${height}" fill="url(#${g})"/>${stars}</svg>`;
}
// SkyFill: List detail's header block; stars by points.
const FILL_STARS = [
  [95.9, 15, 0.9, 0.8], [49.8, 17, 1.4, 0.9], [56.4, 22, 0.9, 0.8], [41.6, 24.5, 1, 0.9],
  [24.8, 28.5, 1.4, 0.75], [99.3, 28, 0.6, 0.4], [64.5, 44.5, 0.9, 0.8], [40.6, 49.5, 1.4, 0.95],
  [51.5, 53, 0.7, 0.6], [29.1, 72, 0.7, 0.5], [41.9, 75, 1, 0.65], [35, 98, 1, 0.9],
  [42.3, 98.5, 0.8, 0.55], [90.8, 109, 1, 0.6], [1, 120, 1.4, 0.55], [99.3, 123, 1, 0.65],
  [72.5, 123, 0.8, 0.95], [90.6, 132, 0.9, 0.75], [94.5, 139, 0.7, 0.5], [66.2, 150, 0.8, 0.8],
  [93.7, 159, 0.9, 0.5], [1, 172, 0.6, 0.5], [99.4, 180, 1, 0.55],
];
function SkyFill(height) {
  const g = id('fill');
  const stars = isDay ? '' : FILL_STARS.map(([x, y, r, o]) => `<circle cx="${(x / 100) * W}" cy="${y}" r="${r}" fill="${C.celestial}" opacity="${o}"/>`).join('');
  return `<svg width="${W}" height="${height}"><defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.skyTop}"/><stop offset="1" stop-color="${C.skyHorizon}"/></linearGradient></defs><rect width="${W}" height="${height}" fill="url(#${g})"/>${stars}</svg>`;
}

// ---------- Horizon (Lists) ----------
const HILL_H = 20;
const HILL_EDGE = [0, 18, 25, 18, 45, 14, 62, 8, 72, 4.5, 88, 3, 100, 6];
const SUN_FROM_RIGHT = 75;
const SUN_LIFT = HILL_H - 5;
function hillEdge(sx, dy = 0) {
  const at = (i) => `${+(HILL_EDGE[i] * sx).toFixed(2)},${HILL_EDGE[i + 1] + dy}`;
  let d = `M${at(0)}`;
  for (let i = 2; i < HILL_EDGE.length; i += 6) d += ` C${at(i)} ${at(i + 2)} ${at(i + 4)}`;
  return d;
}
// The rim: on native, react-native-svg replaces the stop colour's alpha with stopOpacity.
const rimStops = () => `<stop offset="0" stop-color="${C.bandRim.replace(/rgba\((\d+),(\d+),(\d+),[\d.]+\)/, 'rgb($1,$2,$3)')}" stop-opacity="0.2"/><stop offset="1" stop-color="${C.bandRim.replace(/rgba\((\d+),(\d+),(\d+),[\d.]+\)/, 'rgb($1,$2,$3)')}" stop-opacity="0"/>`;
function Horizon({ ground, children }) {
  const CEL_RIGHT = 20, CEL_W = 170, CEL_R = 25, CEL_H = 72;
  const cx = CEL_W - (SUN_FROM_RIGHT - CEL_RIGHT), cy = CEL_H - SUN_LIFT;
  const g = id('glow'), rim = id('rim');
  const birds = isDay
    ? `<g stroke="${C.textMuted}" stroke-width="1.6" stroke-linecap="round" fill="none"><path d="M${cx - 66} ${cy - 28} q6 -5 12 0"/><path d="M${cx - 50} ${cy - 34} q6 -5 12 0"/><path d="M${cx - 38} ${cy - 18} q6 -5 12 0"/></g>`
    : '';
  const cel = `<svg width="${CEL_W}" height="${CEL_H}" viewBox="0 0 ${CEL_W} ${CEL_H}"><defs><radialGradient id="${g}" cx="${cx}" cy="${cy}" r="${CEL_R * 2.2}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.celestial}" stop-opacity="${isDay ? 0.55 : 0.2}"/><stop offset="1" stop-color="${C.celestial}" stop-opacity="0"/></radialGradient></defs><circle cx="${cx}" cy="${cy}" r="${CEL_R * 2.2}" fill="url(#${g})"/><circle cx="${cx}" cy="${cy}" r="${CEL_R}" fill="${C.celestial}"/>${birds}</svg>`;
  const HILL = `${hillEdge(1)} L100,${HILL_H} L0,${HILL_H} Z`;
  const hill = `<svg width="${W}" height="${HILL_H}" viewBox="0 0 100 ${HILL_H}" preserveAspectRatio="none"><defs><linearGradient id="${rim}" x1="0" y1="0" x2="0" y2="1">${rimStops()}</linearGradient></defs><path d="${HILL}" fill="${ground}"/><path d="${HILL}" fill="url(#${rim})"/></svg>`;
  return V({ minHeight: 72, paddingBottom: 8, justifyContent: 'center' },
    V({ position: 'absolute', right: CEL_RIGHT, bottom: 0 }, cel) +
    V({ position: 'absolute', left: 0, right: 0, bottom: 0, height: HILL_H }, hill) +
    (children || ''));
}

// ---------- Hillside (List detail) ----------
function Hillside({ ground, children }) {
  const STRIP_H = 82, CEL_Y = STRIP_H - SUN_LIFT;
  const cx = W - SUN_FROM_RIGHT, r = isDay ? 36 : 34;
  const BIRDS = [[-85, -31], [-64, -37], [-51, -21]];
  const LOW_STARS = [[89, 7.5, 1.1, 0.75], [45.5, 18, 1.1, 0.8], [31, 24.5, 1.1, 0.9], [388, 34, 0.6, 0.8]];
  const edge = hillEdge(W / 100, STRIP_H - HILL_H);
  const land = `${edge} L${W},${STRIP_H} L0,${STRIP_H} Z`;
  const g = id('hsGlow'), rim = id('hsRim');
  const svg = `<svg width="${W}" height="${STRIP_H}"><defs><radialGradient id="${g}" cx="${cx}" cy="${CEL_Y}" r="${r * 1.6}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.celestial}" stop-opacity="${isDay ? 0.6 : 0.22}"/><stop offset="1" stop-color="${C.celestial}" stop-opacity="0"/></radialGradient><linearGradient id="${rim}" x1="0" y1="0" x2="0" y2="1">${rimStops()}</linearGradient></defs>
    <rect width="${W}" height="${STRIP_H}" fill="${C.skyHorizon}"/>
    ${isDay ? '' : LOW_STARS.map(([fr, y, sr, o]) => `<circle cx="${W - fr}" cy="${y}" r="${sr}" fill="${C.celestial}" opacity="${o}"/>`).join('')}
    <circle cx="${cx}" cy="${CEL_Y}" r="${r * 1.6}" fill="url(#${g})"/><circle cx="${cx}" cy="${CEL_Y}" r="${r}" fill="${C.celestial}"/>
    ${isDay ? `<g stroke="${C.textMuted}" stroke-width="1.4" stroke-linecap="round" fill="none">${BIRDS.map(([dx, dy]) => `<path d="M${cx + dx},${CEL_Y + dy} q3.25,-3.5 6.5,0 q3.25,-3.5 6.5,0"/>`).join('')}</g>` : ''}
    <path d="${land}" fill="${ground}"/><path d="${land}" fill="url(#${rim})"/></svg>`;
  return V({ height: STRIP_H, paddingTop: 8 }, V({ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, svg) + (children || ''));
}

// ---------- Band + ListRow (Lists) ----------
const WAVE_H = 20;
const WAVES = [
  `M0,12 C15,4 35,4 50,10 C65,16 85,16 100,8 L100,${WAVE_H} L0,${WAVE_H} Z`,
  `M0,7 C20,15 35,17 55,11 C75,5 90,3 100,9 L100,${WAVE_H} L0,${WAVE_H} Z`,
  `M0,14 C18,6 40,4 58,9 C76,14 88,17 100,11 L100,${WAVE_H} L0,${WAVE_H} Z`,
];
function Band(index, children, style = {}) {
  const b = band(index);
  let deco = '';
  if (index > 0) {
    const above = band(index - 1), rim = id('bandRim'), wave = WAVES[index % WAVES.length];
    deco = V({ position: 'absolute', top: 0, left: 0, right: 0, height: WAVE_H },
      `<svg width="${W}" height="${WAVE_H}" viewBox="0 0 100 ${WAVE_H}" preserveAspectRatio="none"><defs><linearGradient id="${rim}" x1="0" y1="0" x2="0" y2="1">${rimStops()}</linearGradient></defs><rect width="100" height="${WAVE_H}" fill="${above.color}"/><path d="${wave}" fill="${b.color}"/><path d="${wave}" fill="url(#${rim})"/></svg>`);
  }
  return V({ backgroundColor: b.color, ...style }, deco + children);
}
function ListRow(list, index) {
  const b = band(index);
  const deleted = !!list.deleted, shared = list.role !== 'owner', owner = !shared;
  const subtitle = shared ? (list.role === 'writer' ? 'Shared with you · can edit' : 'Shared with you · view only') : null;
  const text = V({ flex: 1, gap: 2 },
    T({ fontFamily: fontOf.sansMedium, fontSize: 22, color: b.ink }, list.name) +
    (subtitle ? T({ fontFamily: fontOf.sans, fontSize: 15, color: b.ink }, subtitle) : ''));
  const tap = R({ alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 16, paddingTop: 28, paddingBottom: 20, minHeight: 104 },
    text + (owner ? V({ width: 36 }) : '') + icon('chevronRight', b.ink, 16));
  const action = owner
    ? V({ position: 'absolute', top: 0, bottom: 0, right: 16 + 16 + 12, justifyContent: 'center' },
      IconButton({ fill: b.iconFill, glyph: icon(deleted ? 'restore' : 'trash', b.ink, 16) }))
    : '';
  return Band(index, tap + action);
}

// ---------- ItemRow (List detail) ----------
function ItemRow(item, index, editable = true) {
  const b = band(index);
  const done = !!item.done, deleted = !!item.deleted, inactive = !editable || deleted;
  const box = V({ width: 26, height: 26, borderRadius: 999, border: `2px solid ${b.ink}`, alignItems: 'center', justifyContent: 'center', backgroundColor: done ? b.ink : 'transparent', opacity: inactive ? 0.45 : 1 },
    done ? icon('check', b.color, 14) : '');
  const title = T({ flex: 1, fontFamily: done ? fontOf.sans : fontOf.sansMedium, fontSize: 19, color: b.ink, textDecoration: done ? 'line-through' : 'none' }, item.title);
  const tap = R({ flex: 1, alignItems: 'center', gap: 14, paddingLeft: 24, paddingTop: 12, paddingBottom: 12 }, box + title);
  const pencil = editable && !deleted ? IconButton({ fill: b.iconFill, glyph: icon('pencil', b.ink, 16) }) : '';
  const trash = editable ? IconButton({ fill: b.iconFill, glyph: icon(deleted ? 'restore' : 'trash', b.ink, 16) }) : '';
  return R({ alignItems: 'center', minHeight: 60, gap: 12, paddingRight: 26, backgroundColor: b.color }, tap + pencil + trash);
}

// ---------- EmptyState ----------
function EmptyState({ title, hint, ink }) {
  return V({ alignItems: 'center', paddingLeft: 24, paddingRight: 24, paddingTop: 48, gap: 8 },
    T({ fontFamily: fontOf.sansSemiBold, fontSize: 17, color: ink, textAlign: 'center' }, title) +
    T({ fontFamily: fontOf.sans, fontSize: 15, color: ink, textAlign: 'center' }, hint));
}

// ---------- Status bar and home indicator, as the existing mockups draw them ----------
function StatusBar() {
  const ink = C.text, faint = isDay ? 'rgba(44,47,78,0.4)' : 'rgba(238,240,250,0.4)';
  const bars = [[309, 32.3, 5.4], [315.5, 29.7, 8], [322, 27.3, 10.4], [328.5, 25, 12.7]]
    .map(([x, y, h], i) => `<rect x="${x + (W - 390)}" y="${y}" width="3.3" height="${h}" rx="1" fill="${i < 2 ? ink : faint}"/>`).join('');
  const bx = 334.3 + (W - 390);
  const battery = `<rect x="${bx}" y="24.4" width="24.6" height="13" rx="4" fill="none" stroke="${ink}" stroke-width="1.3"/><rect x="${bx + 2.2}" y="26.6" width="20.2" height="8.6" rx="2.2" fill="${ink}"/><path d="M${bx + 25.8} 29.2 a2 2 0 0 1 0 4" fill="${faint}" stroke="${faint}" stroke-width="1.6"/>`;
  return `<svg class="abs" style="left:0;top:0" width="${W}" height="${INSET}"><text x="34" y="40" font-family="-apple-system, 'SF Pro Text', system-ui" font-weight="600" font-size="18.5" fill="${ink}" letter-spacing="-0.2">9:41</text>${bars}${battery}</svg>`;
}
// iOS picks the indicator's shade from what is under it: dark on the pale bands, light on the dark.
function HomeIndicator() {
  return V({ position: 'absolute', left: (W - 134) / 2, top: H - 13, width: 134, height: 5, borderRadius: 3, backgroundColor: 'var(--home)' }).replace('class="v ', 'class="v home ');
}
function shadeHomeIndicator(root) {
  const home = root.querySelector('.home');
  home.style.display = 'none';
  let e = document.elementFromPoint(W / 2, H - 10), bg = 'rgba(0, 0, 0, 0)';
  while (e && (bg = getComputedStyle(e).backgroundColor) === 'rgba(0, 0, 0, 0)') e = e.parentElement;
  home.style.display = '';
  const [r, g, b] = bg.match(/\d+/g).map(Number);
  const dark = 0.2126 * r + 0.7152 * g + 0.0722 * b < 140;
  home.style.backgroundColor = dark ? 'rgba(244,244,250,0.9)' : C.text;
}

// ---------- Screens ----------
function ListsScreen(s) {
  const SKY_HEIGHT = 520;
  const rows = s.rows || [];
  const ground = band(Math.max(rows.length, 1) - 1);
  const right = R({ alignItems: 'center', gap: 12 }, headerButton(s) + PillButton({ label: 'Account' }));
  const titleRow = R({ alignItems: 'center', justifyContent: 'space-between', paddingTop: INSET + 16, paddingLeft: 16, paddingRight: 16, paddingBottom: 12 },
    T({ fontFamily: fontOf.serif, fontSize: 40, color: C.text }, 'My Lists') + right);
  const header = V({},
    V({ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }, Sky(SKY_HEIGHT)) +
    titleRow + slot(s) + (s.coverage ? CoverageLine(s.coverage) : '') +
    Horizon({ ground: band(0).color, children: s.toggle ? Toggle(s.toggle) : '' }));
  const body = rows.length
    ? rows.map((r, i) => ListRow(r, i)).join('') + V({ minHeight: SKY_HEIGHT, backgroundColor: ground.color })
    : Band(0, s.empty ? EmptyState({ ...s.empty, ink: band(0).ink }) : '', { minHeight: SKY_HEIGHT });
  return V({ width: W, height: H, overflow: 'hidden', backgroundColor: ground.color },
    V({ position: 'absolute', top: 0, left: 0, right: 0, height: SKY_HEIGHT }, Sky(SKY_HEIGHT)) +
    V({}, header + body) + StatusBar() + HomeIndicator());
}

function ListDetailScreen(s) {
  const rows = s.rows || [];
  const last = band(Math.max(rows.length, 1) - 1);
  const pills = R({ gap: 12, alignItems: 'center' },
    headerButton(s) +
    (s.manageable !== false ? PillButton({ label: 'Rename' }) : '') + PillButton({ label: 'Share' }));
  const headerRow = R({ height: 36, alignItems: 'center', justifyContent: 'space-between', paddingLeft: 20, paddingRight: 20 },
    IconButton({ outline: C.outline, glyph: icon('chevronLeft', C.text, 18) }) + pills);
  // iOS sets a 40pt glyph 1.33pt higher in a 52pt line than CSS's half-leading does (calibrated
  // against task 20 step 5's 17e shots), hence `top`.
  const title = T({ marginTop: 10, paddingLeft: 20, paddingRight: 20, fontFamily: fontOf.serif, fontSize: 40, lineHeight: '52px', top: -1.33, color: C.text }, s.title || 'Groceries');
  const sl = slot(s);
  const block = V({ paddingTop: INSET + 13 },
    V({ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, '<div class="skyfill"></div>') +
    headerRow + title + (sl ? V({ marginTop: 14 }, sl) : '') + (s.coverage ? CoverageLine(s.coverage) : ''));
  const header = V({ backgroundColor: C.skyHorizon }, block + Hillside({ ground: band(0).color, children: s.toggle ? Toggle(s.toggle) : '' }));
  const body = rows.length ? rows.map((r, i) => ItemRow(r, i, s.editable !== false)).join('') : (s.empty ? EmptyState({ ...s.empty, ink: last.ink }) : '');
  return V({ width: W, height: H, overflow: 'hidden', backgroundColor: last.color },
    V({ paddingBottom: INSET_BOTTOM + 24 }, header + body) + StatusBar() + HomeIndicator());
}

function headerButton(s) {
  if (!s.button) return '';
  return IconButton({ outline: C.outline, glyph: icon(s.button.glyph, C.text, 18), dot: s.button.dot });
}

function slot(s) {
  const k = s.slot;
  if (!k) return '';
  if (k.kind === 'add') return AddBar(k);
  if (k.kind === 'sentence') return Sentence(k) + (k.panelHeight ? V({ height: 44 }) : '');
  if (k.kind === 'search') return SearchPanel(k);
  return '';
}

// ---------- Scenes ----------
const L = (name, role = 'owner', deleted = false) => ({ name, role, deleted });
const I = (title, done = false, deleted = false) => ({ title, done, deleted });
// Sort buttons. Fixed priority: To Do, then A–Z, then date. Date is always on, as the last tie-break.
const dateBtn = (dir = 'up') => ({ face: 'Date', arrow: dir === 'up' ? 'arrowUp' : 'arrowDown', on: true });
const azBtn = (dir) => ({ face: dir === 'desc' ? 'Z–A' : 'A–Z', on: !!dir });
const todoBtn = (dir) => ({ face: dir === 'last' ? 'To Do Last' : 'To Do First', on: !!dir });
// Left to right in priority order: the leftmost lit button decides first.
const listSorts = ({ date, az } = {}) => [azBtn(az), dateBtn(date)];
const itemSorts = ({ date, az, todo } = {}) => [todoBtn(todo), azBtn(az), dateBtn(date)];
const PLUS = { glyph: 'plus' };
const MAGNIFIER = (dot) => ({ glyph: 'search', dot });

const SCENES = {
  // Calibration: the app as task 20 step 5 shot it on the 17e.
  'calib-lists': {
    screen: 'lists',
    slot: { kind: 'add', placeholder: 'New list name', button: 'Create', disabled: true },
    toggle: { checked: false, label: 'Show 24 deleted' },
    rows: [L('Groceries'), L('Hardware store'), L('Pharmacy'), L('Weekend BBQ', 'writer'), L('Birthday party', 'reader'), L('Camping trip')],
  },
  'calib-detail': {
    screen: 'detail',
    slot: { kind: 'add', placeholder: 'Add an item', button: 'Add', disabled: true },
    toggle: { checked: true, label: 'Show 1 deleted' },
    rows: [I('Milk'), I('Bread', true), I('Eggs'), I('Apples'), I('Coffee', false, true)],
  },

  // The ten. Bin mode entered from the default search mode: the sentence takes the field's place,
  // the sort row's 44pt stays as sky, so `Show deleted` does not move.
  'lists-screen-bin': {
    screen: 'lists',
    slot: { kind: 'sentence', text: 'Deleted lists, newest first.', panelHeight: true },
    toggle: { checked: true, label: 'Show deleted' },
    rows: [L('Christmas dinner', 'owner', true), L('Ski trip', 'writer', true), L('Moving house', 'owner', true), L('Old groceries', 'owner', true)],
  },
  'list-detail-screen-bin': {
    screen: 'detail',
    slot: { kind: 'sentence', text: 'Deleted items, newest first.', panelHeight: true },
    toggle: { checked: true, label: 'Show deleted' },
    rows: [I('Paper towels', false, true), I('Coffee', true, true), I('Butter', false, true), I('Rice', false, true)],
  },
  'lists-screen-search': {
    screen: 'lists',
    button: PLUS,
    slot: { kind: 'search', placeholder: 'Search lists', value: 'gro', sorts: listSorts({ az: 'asc' }) },
    coverage: { text: 'Searching 100 of 240 lists · loading the rest…' },
    toggle: { checked: false, label: 'Show deleted' },
    rows: [L('Big grocery run'), L('Groceries'), L('Grove Street party'), L('Weekend groceries', 'writer')],
  },
  'list-detail-screen-search': {
    screen: 'detail',
    button: PLUS,
    slot: { kind: 'search', placeholder: 'Search items', value: 'mi', sorts: itemSorts({ az: 'asc', todo: 'first' }) },
    coverage: { text: 'Searched the 400 loaded items. The rest need a connection.', tryAgain: true },
    toggle: { checked: false, label: 'Show deleted' },
    rows: [I('Jasmine rice'), I('Mince'), I('Mint'), I('Miso paste'), I('Salami'), I('Oat milk', true)],
  },
  'list-detail-screen-search-sorted': {
    screen: 'detail',
    button: MAGNIFIER(true),
    slot: { kind: 'add', placeholder: 'Add an item', button: 'Add', disabled: true },
    toggle: { checked: false, label: 'Show deleted' },
    rows: [I('Oat milk'), I('Eggs'), I('Cherry tomatoes'), I('Coffee beans'), I('Greek yogurt'), I('Sourdough bread', true), I('Olive oil', true), I('Bananas', true)],
  },

  // Review drafts only: the empty bin (question 7) and the new resting state (search mode).
  'lists-screen-bin-empty': {
    screen: 'lists',
    slot: { kind: 'sentence', text: 'Deleted lists, newest first.', panelHeight: true },
    toggle: { checked: true, label: 'Show deleted' },
    rows: [],
    empty: { title: 'The bin is empty', hint: 'Deleted lists wait here for 30 days.' },
  },
  'list-detail-screen-bin-empty': {
    screen: 'detail',
    slot: { kind: 'sentence', text: 'Deleted items, newest first.', panelHeight: true },
    toggle: { checked: true, label: 'Show deleted' },
    rows: [],
    empty: { title: 'The bin is empty', hint: 'Deleted items wait here for 30 days.' },
  },
  'lists-screen-search-resting': {
    screen: 'lists',
    button: PLUS,
    slot: { kind: 'search', placeholder: 'Search lists', value: '', sorts: listSorts() },
    toggle: { checked: false, label: 'Show deleted' },
    rows: [L('Groceries'), L('Hardware store'), L('Pharmacy'), L('Weekend BBQ', 'writer'), L('Birthday party', 'reader'), L('Camping trip')],
  },
  'list-detail-screen-search-resting': {
    screen: 'detail',
    button: PLUS,
    slot: { kind: 'search', placeholder: 'Search items', value: '', sorts: itemSorts() },
    toggle: { checked: false, label: 'Show deleted' },
    rows: [I('Milk'), I('Bread', true), I('Eggs'), I('Apples'), I('Coffee beans'), I('Bananas')],
  },
};

// ---------- Boot ----------
(async () => {
  const tokens = await (await fetch('tokens.json')).json();
  C = tokens[THEME];
  const s = SCENES[SCENE];
  const root = document.getElementById('root');
  root.innerHTML = s.screen === 'lists' ? ListsScreen(s) : ListDetailScreen(s);
  // SkyFill measures its region, as the component does.
  for (const holder of root.querySelectorAll('.skyfill')) {
    const box = holder.parentElement.getBoundingClientRect();
    holder.outerHTML = SkyFill(Math.round(box.height));
  }
  document.body.style.width = px(W);
  shadeHomeIndicator(root);
  await document.fonts.ready;
  // Report any segment title that does not fit its segment.
  const fit = [...root.querySelectorAll('.sortbtn')].map((b) => {
    const t = b.querySelector('.seg'), need = t.scrollWidth + (b.querySelector('svg') ? 20 : 0);
    return [t.textContent, need, b.clientWidth - 12];
  });
  const clipped = fit.filter(([, need, room]) => need > room + 0.5).map(([f]) => f);
  const top = (txt) => { const e = [...root.querySelectorAll('.t')].find((t) => t.textContent === txt); return e ? +e.closest('.row').getBoundingClientRect().top.toFixed(1) : null; };
  const rect = (e) => e ? [+e.getBoundingClientRect().top.toFixed(1), +e.getBoundingClientRect().bottom.toFixed(1)] : null;
  const m = q.get('measure') ? {
    field: rect([...root.querySelectorAll('.t')].find((t) => /^(Search|gro$|mi$|Deleted|Add an|New list)/.test(t.textContent))?.closest('.row')),
    sorts: rect(root.querySelector('.sortbtn')),
    toggle: top(s.toggle.label),
    firstRow: s.rows && s.rows.length ? rect([...root.querySelectorAll('.t')].find((t) => t.textContent === (s.rows[0].name || s.rows[0].title)).closest('.row').parentElement) : null,
  } : undefined;
  document.title = JSON.stringify({ ready: true, clipped, segs: fit, m });
})();
