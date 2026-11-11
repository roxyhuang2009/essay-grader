// ============================================================
// 配色主題：預設主題、自訂顏色、深淺模式、字體大小
// ============================================================

export const PRESETS = [
  { id: 'fresh', name: '清新藍綠', p1: '#C6E5F7', p2: '#ADEDCF', p3: '#91A3FB', ink: '#0D0D0D' },
  { id: 'peach', name: '蜜桃奶茶', p1: '#FFE0D1', p2: '#FFEDB0', p3: '#F6A6B6', ink: '#1C1412' },
  { id: 'matcha', name: '抹茶拿鐵', p1: '#E4EFD3', p2: '#C5E7D5', p3: '#9DCB9F', ink: '#12211A' },
  { id: 'lavender', name: '薰衣草', p1: '#E8E0FA', p2: '#FAD9E8', p3: '#B5A3F4', ink: '#151226' },
  { id: 'ocean', name: '海洋', p1: '#CDEBF5', p2: '#BCE5E0', p3: '#7FB6E8', ink: '#0B1A2A' },
  { id: 'mono', name: '極簡灰', p1: '#EEEEEC', p2: '#DFDFDB', p3: '#C4C4BE', ink: '#111111' },
];

const DEFAULTS = { preset: 'fresh', custom: null, mode: 'light', fontSize: 'm' };
const KEY = 'appearance';

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
  applyTheme(s);
}

export function resetSettings() {
  saveSettings({ ...DEFAULTS });
  return { ...DEFAULTS };
}

export function currentColors(s = loadSettings()) {
  if (s.preset === 'custom' && s.custom) return s.custom;
  return PRESETS.find((p) => p.id === s.preset) || PRESETS[0];
}

// 顏色亮度（0 = 黑、1 = 白），用來自動決定文字要用黑色或白色
function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function isDarkMode(mode) {
  if (mode === 'dark') return true;
  if (mode === 'auto') return window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  return false;
}

export function applyTheme(s = loadSettings()) {
  const c = currentColors(s);
  const dark = isDarkMode(s.mode);
  const inkIsDark = luminance(c.ink) < 0.25;
  const onPastel = inkIsDark ? c.ink : '#0D0D0D';

  const vars = dark
    ? {
        '--bg': '#111214', '--surface': '#1A1B1F', '--surface-2': '#222328', '--line': '#2E3036',
        '--text': '#F2F2F0', '--muted': '#9A9CA3', '--btn': '#F2F2F0', '--btn-fg': '#111214',
      }
    : {
        '--bg': '#F6F6F2', '--surface': '#FFFFFF', '--surface-2': '#F4F4F0', '--line': '#E8E8E2',
        '--text': c.ink, '--muted': '#6E7076', '--btn': c.ink, '--btn-fg': luminance(c.ink) < 0.4 ? '#FFFFFF' : '#0D0D0D',
      };

  Object.assign(vars, { '--p1': c.p1, '--p2': c.p2, '--p3': c.p3, '--on-pastel': onPastel });
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.mode = dark ? 'dark' : 'light';
  root.style.fontSize = { s: '14px', m: '15px', l: '16.5px' }[s.fontSize] || '15px';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', vars['--bg']);
}

// 跟隨系統時，系統切換深淺色要即時更新
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
  if (loadSettings().mode === 'auto') applyTheme();
});
