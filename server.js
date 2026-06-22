// server.js — Film Dixit backend
// Node.js + Express + Socket.io
// Stato in memoria; riavvio server = partite perse (MVP)

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// --- Carica sinossi ---
const synopsesRaw = JSON.parse(fs.readFileSync(path.join(__dirname, 'synopses.json'), 'utf8'));
// Supporta sia formato vecchio [{ titolo, sinossi }]
// che nuovo [{ titolo: {it,en}, sinossi: {it,en} }]

app.use(express.static(path.join(__dirname, 'public')));

// --- Stato globale ---
const rooms = {}; // code -> Room

// --- Utilità ---
function randomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function pickSynopsis(usedIndices, lang) {
  const available = synopsesRaw
    .map((s, i) => i)
    .filter(i => !usedIndices.includes(i));

  if (available.length === 0) {
    // Mazzo esaurito: ricomincia
    usedIndices.length = 0;
    available.push(...synopsesRaw.map((_, i) => i));
  }

  const idx = available[Math.floor(Math.random() * available.length)];
  usedIndices.push(idx);
  const entry = synopsesRaw[idx];

  // Gestisce entrambi i formati
  const titolo = typeof entry.titolo === 'object' ? (entry.titolo[lang] || entry.titolo.it) : entry.titolo;
  const sinossi = typeof entry.sinossi === 'object' ? (entry.sinossi[lang] || entry.sinossi.it) : entry.sinossi;

  return { titolo, sinossi };
}

function broadcastState(room) {
  const players = room.players.map(p => ({ id: p.id, name: p.name, score: p.score }));
  room.players.forEach(p => {
    const socketObj = io.sockets.sockets.get(p.id);
    if (socketObj) {
      socketObj.emit('state', {
        phase: room.phase,
        players,
        timeLeft: room.timeLeft,
        round: room.round,
      });
    }
  });
}

function clearRoomTimer(room) {
  if (room.timer) {
    clearInterval(room.timer);
    room.timer = null;
  }
}

// --- Fasi di gioco ---

function startReading(room) {
  room.phase = 'reading';
  room.timeLeft = 10;

  const { titolo, sinossi } = pickSynopsis(room.usedIndices, room.language);
  room.currentTitolo = titolo;
  room.currentSinossi = sinossi;
  room.submissions = {}; // id -> titolo scritto dal giocatore

  // Rivela la sinossi a tutti
  room.players.forEach(p => {
    const s = io.sockets.sockets.get(p.id);
    if (s) s.emit('synopsis-revealed', { sinossi });
  });

  broadcastState(room);

  clearRoomTimer(room);
  room.timer = setInterval(() => {
    room.timeLeft--;
    io.to(room.code).emit('tick', room.timeLeft);
    if (room.timeLeft <= 0) {
      clearRoomTimer(room);
      startWriting(room);
    }
  }, 1000);
}

function startWriting(room) {
  room.phase = 'writing';
  room.timeLeft = 60;
  broadcastState(room);

  clearRoomTimer(room);
  room.timer = setInterval(() => {
    room.timeLeft--;
    io.to(room.code).emit('tick', room.timeLeft);
    if (room.timeLeft <= 0) {
      clearRoomTimer(room);
      startVoting(room);
    }
  }, 1000);
}

function startVoting(room) {
  room.phase = 'voting';
  room.votes = {}; // votante id -> id del votato
  room.timeLeft = 0;
  clearRoomTimer(room);

  // Costruisce le opzioni: risposte dei giocatori + titolo vero
  // Il titolo vero viene inserito come voce anonima con id speciale '__true__'
  const options = [];

  // Aggiungi risposte dei giocatori che hanno inviato
  room.players.forEach(p => {
    if (room.submissions[p.id]) {
      options.push({ id: p.id, text: room.submissions[p.id] });
    }
  });

  // Aggiungi titolo vero
  options.push({ id: '__true__', text: room.currentTitolo });

  // Mescola (Fisher-Yates)
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }

  room.votingOptions = options;
  broadcastState(room);

  // Manda le opzioni a ogni giocatore
  room.players.forEach(p => {
    const s = io.sockets.sockets.get(p.id);
    if (s) s.emit('voting-options', options);
  });
}

function checkAllVoted(room) {
  const eligibleVoters = room.players.filter(p => io.sockets.sockets.get(p.id));
  return eligibleVoters.every(p => room.votes[p.id] !== undefined);
}

function endRound(room) {
  clearRoomTimer(room);
  room.phase = 'results';

  // Calcola punteggi
  const voteCounts = {}; // id -> array di nomi di chi ha votato
  room.votingOptions.forEach(o => { voteCounts[o.id] = []; });

  Object.entries(room.votes).forEach(([voterId, targetId]) => {
    if (voteCounts[targetId] !== undefined) {
      const voter = room.players.find(p => p.id === voterId);
      if (voter) voteCounts[targetId].push(voter.name);
    }
  });

  // +1 per ogni voto ricevuto sul proprio titolo falso
  room.players.forEach(p => {
    if (voteCounts[p.id]) {
      p.score += voteCounts[p.id].length;
    }
  });

  // +2 per chi ha votato il titolo vero
  const trueVoters = voteCounts['__true__'] || [];
  room.players.forEach(p => {
    if (trueVoters.includes(p.name)) {
      p.score += 2;
    }
  });

  // Costruisce il riepilogo per il client
  const opzioni = room.votingOptions.map(o => {
    const autorePlayer = room.players.find(p => p.id === o.id);
    return {
      id: o.id,
      text: o.text,
      isTrue: o.id === '__true__',
      autore: autorePlayer ? autorePlayer.name : null,
      votanti: voteCounts[o.id] || [],
    };
  });

  const players = room.players.map(p => ({ id: p.id, name: p.name, score: p.score }));

  io.to(room.code).emit('round-results', {
    titoloVero: room.currentTitolo,
    opzioni,
    players,
  });

  room.round++;
}

// --- Socket.io ---

io.on('connection', (socket) => {

  // Crea stanza
  socket.on('create-room', ({ name, language }) => {
    if (!name) return socket.emit('error-message', 'Nome richiesto.');
    const lang = ['it', 'en'].includes(language) ? language : 'it';

    let code;
    do { code = randomCode(); } while (rooms[code]);

    rooms[code] = {
      code,
      language: lang,
      phase: 'lobby',
      players: [{ id: socket.id, name, score: 0, isHost: true }],
      round: 1,
      usedIndices: [],
      submissions: {},
      votes: {},
      votingOptions: [],
      currentTitolo: null,
      currentSinossi: null,
      timeLeft: 0,
      timer: null,
    };

    socket.join(code);
    socket.emit('room-created', { code, language: lang });
    broadcastState(rooms[code]);
  });

  // Entra in stanza
  socket.on('join-room', ({ code, name, rejoin }) => {
    if (!name || !code) return socket.emit('error-message', 'Nome e codice richiesti.');
    const room = rooms[code];
    if (!room) return socket.emit('error-message', 'Stanza non trovata.');

    // Riconnessione: cerca giocatore esistente per nome
    if (rejoin) {
      const existing = room.players.find(p => p.name === name);
      if (existing) {
        existing.id = socket.id; // aggiorna socket id
        socket.join(code);
        socket.emit('room-joined', { code, language: room.language });
        broadcastState(room);

        // Rimanda lo stato corrente della fase attiva
        if (room.phase === 'writing' && room.currentSinossi) {
          socket.emit('synopsis-revealed', { sinossi: room.currentSinossi });
          socket.emit('tick', room.timeLeft);
        }
        if (room.phase === 'voting' && room.votingOptions.length) {
          socket.emit('voting-options', room.votingOptions);
        }
        return;
      }
    }

    // Nuovo giocatore (solo in lobby)
    if (room.phase !== 'lobby') {
      return socket.emit('error-message', 'Partita già in corso.');
    }

    room.players.push({ id: socket.id, name, score: 0, isHost: false });
    socket.join(code);
    socket.emit('room-joined', { code, language: room.language });
    broadcastState(room);
  });

  // Avvia partita (solo host)
  socket.on('start-game', () => {
    const room = findRoomBySocket(socket.id);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.isHost) return socket.emit('error-message', "Solo l'host può avviare la partita.");
    if (room.players.length < 2) return socket.emit('error-message', 'Servono almeno 2 giocatori per iniziare.');
    if (room.phase !== 'lobby') return;

    startReading(room);
  });

  // Giocatore invia il titolo
  socket.on('submit-title', ({ titolo }) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.phase !== 'writing') return;
    if (!titolo || !titolo.trim()) return;
    room.submissions[socket.id] = titolo.trim();

    // Se hanno inviato tutti i connessi, passa al voto prima del timer
    const connectedPlayers = room.players.filter(p => io.sockets.sockets.get(p.id));
    const allSubmitted = connectedPlayers.every(p => room.submissions[p.id]);
    if (allSubmitted) {
      clearRoomTimer(room);
      startVoting(room);
    }
  });

  // Giocatore vota
  socket.on('submit-vote', ({ targetId }) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.phase !== 'voting') return;
    if (targetId === socket.id) return; // non può votare se stesso
    if (room.votes[socket.id] !== undefined) return; // vota una sola volta

    room.votes[socket.id] = targetId;

    if (checkAllVoted(room)) {
      endRound(room);
    }
  });

  // Round successivo (solo host)
  socket.on('next-round', () => {
    const room = findRoomBySocket(socket.id);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.isHost) return;
    if (room.phase !== 'results') return;

    startReading(room);
  });

  // Disconnessione
  socket.on('disconnect', () => {
    const room = findRoomBySocket(socket.id);
    if (!room) return;

    // Aspetta 8 secondi prima di agire: dà tempo alla riconnessione automatica
    setTimeout(() => {
      const player = room.players.find(p => p.id === socket.id);
      if (!player) return; // si è già riconnesso e l'id è stato aggiornato

      if (room.phase === 'lobby') {
        room.players = room.players.filter(p => p.id !== socket.id);
        if (room.players.length === 0) {
          clearRoomTimer(room);
          delete rooms[room.code];
          return;
        }
        // Passa l'host al primo giocatore rimasto
        if (player.isHost && room.players.length > 0) {
          room.players[0].isHost = true;
        }
        broadcastState(room);
      }
      // In gioco: mantieni il giocatore nel roster (punteggio preservato)
    }, 8000);
  });
});

// Trova la stanza dato un socket id
function findRoomBySocket(socketId) {
  return Object.values(rooms).find(r => r.players.some(p => p.id === socketId)) || null;
}

server.listen(PORT, () => {
  console.log(`Film Dixit in ascolto su http://localhost:${PORT}`);
});
