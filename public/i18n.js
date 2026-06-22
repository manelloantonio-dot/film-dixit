// i18n.js
// Carica il file di traduzione corretto e aggiorna tutti gli elementi
// con attributo data-i18n / data-i18n-placeholder.
// Lingua di default: italiano. Si può forzare con localStorage/selettore.

const SUPPORTED_LANGUAGES = ['it', 'en'];
let currentTranslations = {};
let currentLang = 'it';

async function loadLanguage(lang) {
  if (!SUPPORTED_LANGUAGES.includes(lang)) lang = 'it';
  const res = await fetch(`locales/${lang}.json`);
  currentTranslations = await res.json();
  currentLang = lang;
  applyTranslations();
}

function t(key) {
  return currentTranslations[key] || key;
}

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  const titleEl = document.getElementById('app-title');
  if (titleEl) titleEl.textContent = t('app_title');
  document.title = t('app_title');
}

// Esposto globalmente: app.js lo usa per impostare la lingua scelta
// (in fase di creazione stanza) o quella ricevuta dal server (in fase di join).
window.i18n = { loadLanguage, t, get currentLang() { return currentLang; } };

// Carica subito la lingua di default per la schermata iniziale.
loadLanguage('it');
