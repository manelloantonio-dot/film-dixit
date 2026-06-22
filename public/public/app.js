const socket = io();

let myId = null;
let isHost = false;
let myName = '';
let currentSinossi = '';

const screens = ['home', 'lobby', 'reading', 'writing', 'voting', 'results'];
function showScreen(name) {
  screens.forEach(s => {
    document.getElementById(`screen-${s}`).classList.toggle('hidden', s !== name);
  });
}

// --- Multilingua ---
// La lingua viene scelta dall'host in fase di creazione stanza; chi entra con
// join-room riceve la lingua già impostata dal server e aggancia l'interfaccia a quella.
document.getElementById('language-select').onchange = (e) => {
  window.i18n.loadLanguage(e.target.value);
};

document.getElementById('btn-create').onclick = () => {
  myName = document.getElementById('name').value.trim();
  if (!myName) return showError(window.i18n.t('error_need_name'));
  const language = document.getElementById('language-select').value;
  socket.emit('create-room', { name: myName, language });
  saveSession({ code: null, name: myName }); // il code arriva su room-created
};

document.getElementById('btn-join').onclick = () => {
  myName = document.getElementById('name').value.trim();
  const code = document.getElementById('code').value.trim().toUpperCase();
  if (!myName) return showError(window.i18n.t('error_need_name'));
  if (!code) return showError(window.i18n.t('error_need_code'));
  socket.emit('join-room', { code, name: myName });
};

function showError(msg) {
  document.getElementById('error').textContent = msg;
}

// --- Riconnessione automatica ---
// Se la connessione cade (es. Wi-Fi instabile), il browser ritenta da solo
// e qui rientriamo nella stessa stanza con lo stesso nome, senza perdere il posto.
function saveSession({ code, name }) {
  sessionStorage.setItem('filmdixit_session', JSON.stringify({ code, name }));
}
function getSession() {
  try { return JSON.parse(sessionStorage.getItem('filmdixit_session')); } catch { return null; }
}

socket.on('connect', () => {
  myId = socket.id;
  const session = getSession();
  if (session && session.code) {
    socket.emit('join-room', { code: session.code, name: session.name, rejoin: true });
  }
});

socket.on('error-message', showError);

socket.on('room-created', ({ code, language }) => {
  isHost = true;
  document.getElementById('room-code').textContent = code;
  window.i18n.loadLanguage(language);
  saveSession({ code, name: myName });
  showScreen('lobby');
});

socket.on('room-joined', ({ code, language }) => {
  document.getElementById('room-code').textContent = code;
  window.i18n.loadLanguage(language);
  saveSession({ code, name: myName || document.getElementById('name').value.trim() });
  showScreen('lobby');
});

document.getElementById('btn-start').onclick = () => socket.emit('start-game');

socket.on('state', (state) => {
  const ptsLabel = window.i18n.t('pts_suffix');
  const list = document.getElementById('player-list');
  list.innerHTML = state.players.map(p =>
    `<div class="player-row"><span>${p.name}</span><span>${p.score} ${ptsLabel}</span></div>`
  ).join('');

  document.getElementById('btn-start').style.display = isHost ? 'block' : 'none';

  if (state.phase === 'reading') {
    showScreen('reading');
    document.getElementById('reading-timer').textContent = state.timeLeft;
  }

  if (state.phase === 'writing') {
    showScreen('writing');
    document.getElementById('write-timer').textContent = state.timeLeft;
    document.getElementById('writing-sinossi').textContent = currentSinossi;
  }

  if (state.phase === 'voting') {
    showScreen('voting');
  }
});

// La sinossi viene rivelata a tutti contemporaneamente, estratta a caso dal mazzo,
// già nella lingua impostata per la stanza (gestita dal server).
socket.on('synopsis-revealed', ({ sinossi }) => {
  currentSinossi = sinossi;
  document.getElementById('reading-sinossi').textContent = sinossi;
  document.getElementById('writing-sinossi').textContent = sinossi;
});

document.getElementById('btn-submit-title').onclick = () => {
  const titolo = document.getElementById('title-input').value.trim();
  if (!titolo) return;
  socket.emit('submit-title', { titolo });
  document.getElementById('title-input').disabled = true;
  document.getElementById('btn-submit-title').disabled = true;
  document.getElementById('submitted-msg').classList.remove('hidden');
};

socket.on('tick', (timeLeft) => {
  const readingEl = document.getElementById('reading-timer');
  const writingEl = document.getElementById('write-timer');
  if (readingEl) readingEl.textContent = timeLeft;
  if (writingEl) writingEl.textContent = timeLeft;
});

socket.on('voting-options', (options) => {
  const container = document.getElementById('options-list');
  container.innerHTML = '';
  options.forEach(opt => {
    if (opt.id === myId) return; // non posso votare la mia risposta
    const div = document.createElement('div');
    div.className = 'option';
    div.textContent = opt.text;
    div.onclick = () => {
      socket.emit('submit-vote', { targetId: opt.id });
      Array.from(container.children).forEach(c => c.style.pointerEvents = 'none');
      div.style.outline = '2px solid #5b46d1';
    };
    container.appendChild(div);
  });
});

socket.on('round-results', (data) => {
  showScreen('results');
  document.getElementById('res-titolo-vero').textContent = data.titoloVero;

  // Mostra eventualmente lo slot pubblicitario (configurabile in adConfig.js)
  if (window.maybeShowAd) window.maybeShowAd();

  const writtenBy = window.i18n.t('written_by');
  const votesLabel = window.i18n.t('votes_label');
  const noVotes = window.i18n.t('no_votes');
  const trueBadge = window.i18n.t('true_badge');

  const resOptions = document.getElementById('res-options');
  resOptions.innerHTML = data.opzioni.map(o => `
    <div class="option ${o.isTrue ? 'true' : ''}">
      <div>${o.text} ${o.isTrue ? trueBadge : (o.autore ? `(${writtenBy} ${o.autore})` : '')}</div>
      <small>${votesLabel} ${o.votanti.length ? o.votanti.join(', ') : noVotes}</small>
    </div>
  `).join('');

  const ptsLabel = window.i18n.t('pts_suffix');
  const resPlayers = document.getElementById('res-players');
  const sorted = [...data.players].sort((a, b) => b.score - a.score);
  resPlayers.innerHTML = sorted.map(p =>
    `<div class="player-row"><span>${p.name}</span><span>${p.score} ${ptsLabel}</span></div>`
  ).join('');

  document.getElementById('btn-next-round').classList.toggle('hidden', !isHost);
  document.getElementById('title-input').disabled = false;
  document.getElementById('btn-submit-title').disabled = false;
  document.getElementById('submitted-msg').classList.add('hidden');
  document.getElementById('title-input').value = '';
});

document.getElementById('btn-next-round').onclick = () => socket.emit('next-round');
