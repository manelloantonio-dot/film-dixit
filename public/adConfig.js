// adConfig.js
// Gestisce lo slot pubblicitario nella schermata risultati.
// Pensato per essere sostituito facilmente con un network reale (AdSense, Ezoic, ecc.)
// senza toccare app.js o server.js.

const AD_CONFIG = {
  // Metti true solo dopo aver configurato un publisher ID reale e approvato.
  enabled: false,

  // 'house' = annuncio statico tuo (es. promo di un mazzo premium, link Ko-fi);
  // 'adsense' = Google AdSense (richiede approvazione account + ca-pub-ID nel <head>);
  provider: 'house',

  // Mostra l'annuncio solo ogni N round, per non essere troppo invasivo (1 = ogni round).
  showEveryNRounds: 2,

  // Contenuto per gli "house ads" (annunci tuoi, zero dipendenze esterne, zero approvazione).
  houseAdHtml: `
    <div style="text-align:left">
      <strong>🎬 Sbloccca il Mazzo Premium "Cult Horror"</strong>
      <p style="margin:6px 0; font-size:0.85rem;">30 nuove sinossi difficilissime. Solo 2,99€.</p>
      <button style="background:#5b46d1;color:white;border:none;padding:8px 14px;border-radius:6px;">Scopri di più</button>
    </div>
  `,
};

let roundsShown = 0;

function maybeShowAd() {
  const slot = document.getElementById('ad-slot');
  if (!slot) return;

  roundsShown += 1;
  const shouldShow = AD_CONFIG.enabled && (roundsShown % AD_CONFIG.showEveryNRounds === 0);

  if (!shouldShow) {
    slot.classList.add('hidden');
    return;
  }
  slot.classList.remove('hidden');

  if (AD_CONFIG.provider === 'house') {
    slot.innerHTML = AD_CONFIG.houseAdHtml;
    slot.classList.add('loaded');
  } else if (AD_CONFIG.provider === 'adsense') {
    // Richiede che lo script adsbygoogle sia abilitato in index.html (rimuovi data-ad-disabled)
    // e che tu abbia un blocco annuncio reale creato nel pannello AdSense.
    slot.innerHTML = `
      <ins class="adsbygoogle"
           style="display:block"
           data-ad-client="ca-pub-XXXXXXXXXXXXXXXX"
           data-ad-slot="0000000000"
           data-ad-format="auto"
           data-full-width-responsive="true"></ins>
    `;
    slot.classList.add('loaded');
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (e) {
      console.warn('AdSense non disponibile:', e);
    }
  }
}

// Esposto globalmente così app.js può richiamarlo quando arriva 'round-results'.
window.maybeShowAd = maybeShowAd;
