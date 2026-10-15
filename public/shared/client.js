// Client temps réel partagé par l'écran TV et l'accueil.
// Nécessite /socket.io/socket.io.js chargé avant ce fichier.
(function () {
  'use strict';

  function connect({ onState, onStatus, onSession } = {}) {
    // Transports par défaut (long-polling puis passage au WebSocket) : l'écran se connecte
    // même si un proxy ou le Wi-Fi du salon bloque les WebSockets.
    const socket = window.io();
    let offset = 0;
    let lastState = null;

    socket.on('state', (state) => {
      offset = state.serverNow - Date.now();
      lastState = state;
      if (onState) onState(state);
    });
    socket.on('session', (session) => onSession && onSession(session));
    socket.on('connect', () => onStatus && onStatus(true));
    socket.on('disconnect', () => onStatus && onStatus(false));
    socket.on('connect_error', () => onStatus && onStatus(false));

    return {
      socket,
      // Heure du serveur, pour des comptes à rebours identiques sur tous les écrans.
      now: () => Date.now() + offset,
      getState: () => lastState,
      // Envoie une action de l'accueil. Résout avec `result`, rejette avec { code, message, details }.
      action(type, payload = {}) {
        return new Promise((resolve, reject) => {
          socket.timeout(10000).emit('action', { type, payload }, (err, res) => {
            if (err) {
              reject(Object.assign(new Error('Le serveur ne répond pas. Vérifiez la connexion.'), { code: 'timeout' }));
            } else if (!res || !res.ok) {
              reject(Object.assign(new Error((res && res.message) || 'Erreur inconnue.'), res || {}));
            } else {
              resolve(res.result);
            }
          });
        });
      },
    };
  }

  // 3 599 000 ms → « 59:59 » ; au-delà d'une heure → « 1:05:00 ».
  function formatRemaining(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  function formatClock(ms) {
    return new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ms));
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[c]);
  }

  window.LobbyClient = { connect, formatRemaining, formatClock, escapeHtml };
})();
