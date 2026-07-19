import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Every locale file under locales/<lang>/<namespace>.json is picked up automatically —
// adding a new namespace just means adding the matching file in each language folder,
// nothing here needs to change.
const modules = import.meta.glob('./locales/*/*.json', { eager: true });

const resources = {};
const namespaceSet = new Set();
for (const path in modules) {
  const match = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/);
  if (!match) continue;
  const [, lang, ns] = match;
  namespaceSet.add(ns);
  resources[lang] = resources[lang] || {};
  resources[lang][ns] = modules[path].default ?? modules[path];
}

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', nativeLabel: 'English', dir: 'ltr' },
  { code: 'ps', label: 'Pashto', nativeLabel: 'پښتو', dir: 'rtl' },
  { code: 'prs', label: 'Dari', nativeLabel: 'دری', dir: 'rtl' },
];
export const RTL_LANGUAGES = SUPPORTED_LANGUAGES.filter(l => l.dir === 'rtl').map(l => l.code);
export const DEFAULT_LANGUAGE = 'en';

/** Turns an unresolved key like "brandingForm.errors.nameRequired" into "Name required" —
    used only as a last resort (see parseMissingKeyHandler below) so a missing/mistyped key
    reads as a plausible label instead of dumping raw dotted key syntax on screen. */
function humanizeMissingKey(key) {
  const last = key.split('.').pop().replace(/_(one|other|zero|few|many|two)$/, '');
  const spaced = last.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
  if (!spaced) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

i18n.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  ns: [...namespaceSet],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  returnEmptyString: false,
  // A missing/mistyped key should never surface its raw dotted path to a user — fall back to
  // a humanized guess instead. saveMissing + missingKeyHandler additionally warns in the
  // console during development so the real gap gets caught and fixed at the source.
  saveMissing: import.meta.env.DEV,
  missingKeyHandler: (lngs, ns, key) => {
    console.warn(`[i18n] Missing translation key "${key}" in namespace "${ns}" (${lngs.join(', ')})`);
  },
  parseMissingKeyHandler: humanizeMissingKey,
});

/** Applies dir/lang attributes to <html> and keeps i18next's active language in sync — the
    single place both concerns live, so every caller (boot, login, the language switcher) goes
    through the same path instead of repeating this logic. */
export function applyLanguage(lang) {
  const code = SUPPORTED_LANGUAGES.some(l => l.code === lang) ? lang : DEFAULT_LANGUAGE;
  i18n.changeLanguage(code);
  const meta = SUPPORTED_LANGUAGES.find(l => l.code === code);
  document.documentElement.lang = code;
  document.documentElement.dir = meta.dir;
}

export default i18n;
