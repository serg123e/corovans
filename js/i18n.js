// i18n - lightweight localization.
//
// Detects browser language, falls back to English.
// Usage:  import { t } from './i18n.js';
//         t('hud.wave', { wave: 5 })  →  "Wave: 5"

import en from './lang/en.js';
import ru from './lang/ru.js';

const LANGS = { en, ru };

function detectLang() {
  const nav = (typeof navigator !== 'undefined') ? navigator.language || '' : '';
  if (nav.startsWith('ru')) return 'ru';
  return 'en';
}

let current = LANGS[detectLang()] || en;

export function setLang(code) {
  current = LANGS[code] || en;
}

export function getLang() {
  return current === ru ? 'ru' : 'en';
}

/** Translate key, interpolating `{name}` placeholders from `params`. */
export function t(key, params) {
  let s = current[key];
  if (s === undefined) s = en[key];
  if (s === undefined) return key;
  if (params) {
    for (const k in params) {
      s = s.replaceAll(`{${k}}`, params[k]);
    }
  }
  return s;
}
