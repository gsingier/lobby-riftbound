// Interface d'accueil (hôtesse), /accueil.
// Organisée autour de la boucle de travail : 01 Inscrire · 02 Appeler · 03 Remettre les goodies ;
// le plan des tables et la file d'attente servent de référence.
// Principes :
//  - le formulaire d'inscription et les modales ne sont JAMAIS re-rendus par un nouvel état ;
//  - les zones dynamiques (tables, panneau d'emplacement, file, goodies, à appeler, recherche) ne sont
//    réécrites que si leurs données ont changé, en conservant le focus clavier (data-focus) ;
//  - les comptes à rebours sont mis à jour chaque seconde sans re-rendu ;
//  - toute donnée saisie est échappée (escapeHtml / textContent).
(function () {
  'use strict';

  const LC = window.LobbyClient;
  const esc = LC.escapeHtml;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const SLOTS = ['A', 'B'];
  const MIN = 60 * 1000;
  const ADJUST_MS = 5 * MIN;
  const NEW_BADGE_MS = 3 * MIN;
  const REVEAL_REG_MS = 10 * 1000;
  const WARN_MS = 5 * MIN;
  const DEFAULT_NO_SHOW_MS = 15 * MIN; // si l'état ne précise pas settings.noShowWindowMs
  const FIELDS = ['firstName', 'lastName', 'email', 'ticket'];
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const LOGIN_URL = '/login';
  const CALLS_KEY = 'rb-accueil-a-appeler-v2';
  const OLD_CALLS_KEYS = ['rb-accueil-a-appeler-v1'];
  const TITLE = document.title;
  const ICON = (id, cls = 'ic') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  // Raccourci de recherche affiché : ⌘K sur Mac (et iPad avec clavier), Ctrl+K ailleurs.
  const IS_MAC = (() => {
    const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    return /mac|iphone|ipad|ipod/i.test(platform) || (!platform && /Macintosh|Mac OS X/i.test(navigator.userAgent || ''));
  })();
  const SEARCH_KBD = IS_MAC ? '⌘ K' : 'Ctrl K';
  const SEARCH_SHORTCUT = IS_MAC ? '⌘K' : 'Ctrl+K';

  let client = null;
  let state = null;
  let stateSeq = 0;
  let where = new Map(); // participantId → emplacement actuel (table, file, goodies)
  let etas = new Map(); // entryId → heure de passage estimée (LobbyClient.estimate)
  let lastRegistration = null;
  let searchResults = null;
  let searchQuery = '';
  let lastSearchSeq = 0;
  const ownMatches = new Set(); // parties créées par une action de l'hôtesse (déjà annoncées)
  const ownPlayers = new Set(); // joueurs inscrits depuis ce poste (présents au comptoir)

  // ================================================================ utilitaires

  function debounce(fn, ms) {
    let timer = null;
    const wrapped = (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
    wrapped.cancel = () => clearTimeout(timer);
    return wrapped;
  }

  const normEmail = (v) => String(v ?? '').trim().toLowerCase();
  // L'email est facultatif (un visiteur peut refuser de le donner) : jamais de séparateur orphelin.
  const hasEmail = (p) => !!(p && String(p.email ?? '').trim());
  // Ce qui empêchera une réinscription : « email et billet », ou le billet seul sans email.
  const idsUsed = (players) => (players.some(hasEmail) ? 'email et billet déjà utilisés' : 'billet déjà utilisé');
  // « email · billet X » ou « sans email · billet X » (HTML échappé).
  function contactHtml(p) {
    const parts = [hasEmail(p) ? esc(String(p.email).trim()) : '<span class="no-email">sans email</span>'];
    if (p.ticket) parts.push(`billet ${esc(p.ticket)}`);
    return parts.join(' · ');
  }
  function contactText(p) {
    const parts = [hasEmail(p) ? String(p.email).trim() : 'sans email'];
    if (p.ticket) parts.push(`billet ${p.ticket}`);
    return parts.join(' · ');
  }
  // Même normalisation que le serveur : \p{Pd} couvre tous les tirets (« - », « – », « — »…).
  const normTicket = (v) => String(v ?? '').trim().toUpperCase().replace(/[\s\p{Pd}_.]/gu, '');
  const cleanName = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');

  function fullName(p) {
    const name = `${p.firstName || ''} ${p.lastName || ''}`.trim();
    return name || p.displayName || '';
  }

  // Même format que l'écran public : « Lucas M. »
  function shortName(p) {
    if (p.displayName) return p.displayName;
    const first = cleanName(p.firstName);
    const last = cleanName(p.lastName);
    const chars = Array.from(last);
    const letter = chars.find((c) => /\p{L}/u.test(c)) || chars[0];
    return [first, letter ? `${letter.toLocaleUpperCase('fr-FR')}.` : ''].filter(Boolean).join(' ');
  }

  function joinNames(names) {
    if (names.length <= 1) return names.join('');
    return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
  }

  // Français : 0 et 1 au singulier.
  function plural(n, one, many) {
    return `${n} ${n >= 2 ? many : one}`;
  }

  const clock = (ms) => LC.formatClock(ms);

  const dateFmt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  const parisDayFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parisDate = (ms) => parisDayFmt.format(new Date(ms));

  function formatWait(ms) {
    const minutes = Math.max(0, Math.floor(ms / MIN));
    if (minutes < 1) return "moins d'1 min";
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h} h ${String(m).padStart(2, '0')}`;
  }

  // Attente arrondie (même règle que l'écran TV) : à la minute supérieure sous 10 min, puis aux
  // 5 minutes supérieures (12 min → « ~15 min ») : on ne sous-estime jamais l'attente.
  function waitLabel(ms) {
    let minutes = Math.max(1, Math.ceil(ms / MIN));
    if (minutes >= 10) minutes = Math.ceil(minutes / 5) * 5;
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
  }

  function now() {
    return client ? client.now() : Date.now();
  }

  const isPaused = () => !!(state && state.settings && state.settings.placementsPaused);

  function noShowWindow() {
    const ms = state && state.settings ? Number(state.settings.noShowWindowMs) : NaN;
    return Number.isFinite(ms) && ms >= 0 ? ms : DEFAULT_NO_SHOW_MS;
  }

  // Le matin, journée de la veille encore en cours (« Nouvelle journée » pas encore faite).
  const STALE_MS = 14 * 60 * MIN;
  const isOld = (ms, t) => Number.isFinite(ms) && (parisDate(ms) !== parisDate(t) || t - ms > STALE_MS);

  function staleDay() {
    return !!(state && state.day) && isOld(Number(state.day.startedAt), now());
  }

  function staleQueuePlayers() {
    if (!state) return 0;
    const t = now();
    return state.queue.reduce((n, e) => n + (isOld(Number(e.createdAt), t) ? e.players.length : 0), 0);
  }

  // Ce qu'il advient d'un emplacement qui se libère : réattribué tout de suite, ou laissé libre (et pourquoi).
  function slotFate(table) {
    if (isPaused()) return 'paused';
    if (!table.enabled) return 'disabled';
    return state.queue.some((e) => e.ready) ? 'reassigned' : 'nobody';
  }

  function freeSlotCount() {
    let free = 0;
    for (const t of state.tables) if (t.enabled) for (const s of SLOTS) if (!t.slots[s]) free++;
    return free;
  }

  // Remplace le contenu d'une zone seulement si `key` a changé ; conserve le focus clavier
  // (via l'attribut data-focus) pour ne jamais perdre la position de l'hôtesse.
  function patch(el, key, render) {
    if (el.__key === key) return false;
    const active = document.activeElement;
    const focusKey = active && el.contains(active) ? active.getAttribute('data-focus') : null;
    el.innerHTML = render();
    el.__key = key;
    if (focusKey) {
      const next = el.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`);
      if (next && !next.disabled) next.focus({ preventScroll: true });
    }
    return true;
  }

  function anyDialogOpen() {
    return $$('dialog').some((d) => d.open);
  }

  // Le panneau d'inscription défile seul (fenêtre basse) : on y montre `el` sans faire sortir `keep`.
  const colLeft = $('.panel-register');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function revealInColumn(el, { keep = null, must = null } = {}) {
    if (!el || el.hidden || !colLeft.contains(el)) return;
    const behavior = reducedMotion.matches ? 'auto' : 'smooth';
    if (colLeft.scrollHeight <= colLeft.clientHeight + 1) {
      el.scrollIntoView({ block: 'nearest', behavior });
      return;
    }
    const pad = 8;
    const col = colLeft.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    let delta = 0;
    if (r.top < col.top + pad) delta = r.top - col.top - pad;
    else if (r.bottom > col.bottom - pad) delta = r.bottom - col.bottom + pad;
    if (keep) delta = Math.min(delta, keep.getBoundingClientRect().top - col.top - pad);
    if (must) delta = Math.max(delta, must.getBoundingClientRect().bottom - col.bottom + pad);
    if (Math.abs(delta) >= 1) colLeft.scrollTo({ top: colLeft.scrollTop + delta, behavior });
  }

  // ================================================================ toasts

  // Une seule notification à la fois, posée sur la barre du haut (au-dessus des statistiques) :
  // elle ne recouvre jamais un panneau de travail, un menu ni le panneau d'un emplacement. Texte
  // affiché en entier (jamais tronqué). À la souris, elle laisse passer les clics (seule la croix est
  // cliquable) et s'estompe sous le pointeur ; au toucher (rien à survoler), un tap dessus la ferme au
  // lieu d'actionner à l'aveugle le bouton caché dessous. Elle se retire dès que le focus clavier
  // entre dans la barre du haut. Les placements à annoncer et le résultat d'une inscription ont
  // leurs propres zones persistantes.
  const toastBox = $('#toasts');

  function toast(message, type = 'success', timeout) {
    for (const old of toastBox.children) {
      old.classList.add('is-leaving');
      setTimeout(() => old.remove(), 200);
    }
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    const msg = document.createElement('div');
    msg.className = 'toast-msg';
    msg.textContent = message;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Fermer la notification');
    close.textContent = '×';
    el.append(msg, close);
    toastBox.append(el);
    requestAnimationFrame(updateToastPeek);
    el.dismiss = () => {
      if (!el.isConnected || el.classList.contains('is-leaving')) return;
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 220);
    };
    // Croix, ou tap n'importe où sur la notification (seulement en mode tactile, voir .is-touch).
    el.addEventListener('click', el.dismiss);
    setTimeout(el.dismiss, timeout || (type === 'error' ? 8000 : type === 'info' ? 6000 : 4000));
  }

  function dismissToasts() {
    for (const t of toastBox.children) t.dismiss?.();
  }

  // Mode tactile (tablette) : la notification capte les taps (voir .is-touch .toast dans le CSS).
  const rootEl = document.documentElement;
  rootEl.classList.toggle('is-touch', !!window.matchMedia?.('(hover: none)').matches);
  document.addEventListener('pointerdown', (e) => {
    rootEl.classList.toggle('is-touch', e.pointerType === 'touch' || e.pointerType === 'pen');
  }, true);

  // Focus clavier dans la barre du haut (Maj+Tab vers « Rechercher », « Réglages »…) : la
  // notification ne doit pas le masquer.
  $('#topbar').addEventListener('focusin', (e) => {
    if (e.target.matches(':focus-visible')) dismissToasts();
  });

  // Sous la souris, la notification s'estompe (on voit et on clique ce qu'elle recouvre).
  let pointer = null;
  let peekFrame = 0;
  const inside = (r, p) => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;

  function updateToastPeek() {
    for (const t of toastBox.children) {
      const close = t.querySelector('.toast-close');
      const peek = !!pointer && inside(t.getBoundingClientRect(), pointer) && !inside(close.getBoundingClientRect(), pointer);
      t.classList.toggle('is-peek', peek);
    }
  }

  document.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    pointer = { x: e.clientX, y: e.clientY };
    if (!peekFrame && toastBox.firstElementChild) {
      peekFrame = requestAnimationFrame(() => {
        peekFrame = 0;
        updateToastPeek();
      });
    }
  });
  document.documentElement.addEventListener('pointerleave', () => {
    pointer = null;
    updateToastPeek();
  });

  // Exécute une action serveur ; affiche l'erreur en toast (sauf `quiet`).
  async function run(type, payload, { button, success, quiet } = {}) {
    if (button) button.disabled = true;
    try {
      const result = await client.action(type, payload);
      if (success) toast(typeof success === 'function' ? success(result) : success, 'success');
      return result;
    } catch (err) {
      if (!quiet) toast(err.message || 'Erreur inconnue.', 'error');
      throw err;
    } finally {
      if (button && button.isConnected) button.disabled = false;
    }
  }

  // ================================================================ modales

  function openDialog(dialog, focusEl) {
    closeRowMenu();
    closeMoreMenu();
    if (!dialog.open) dialog.showModal();
    if (focusEl) setTimeout(() => focusEl.focus(), 0);
  }

  function closeDialog(dialog) {
    if (dialog.open) dialog.close();
  }

  for (const dialog of $$('dialog')) {
    dialog.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) closeDialog(dialog);
    });
  }

  // Confirmation générique. `html` : contenu déjà échappé.
  const confirmDialog = (() => {
    const dialog = $('#confirm-dialog');
    const title = $('#confirm-title');
    const body = $('#confirm-body');
    const ok = $('#confirm-ok');
    const cancel = $('#confirm-cancel');
    let resolver = null;

    function finish(value) {
      const r = resolver;
      resolver = null;
      closeDialog(dialog);
      if (r) r(value);
    }
    ok.addEventListener('click', () => finish(true));
    cancel.addEventListener('click', () => finish(false));
    dialog.addEventListener('close', () => {
      if (!dialog.open) finish(false);
    });

    return function confirm({ title: t, html, ok: okLabel = 'Confirmer', tone = 'primary', focus = 'ok' }) {
      if (resolver) finish(false);
      title.textContent = t;
      body.innerHTML = html;
      ok.textContent = okLabel;
      ok.className = `btn ${{ danger: 'btn-danger', warn: 'btn-primary', success: 'btn-dark btn-success' }[tone] || 'btn-dark'}`;
      return new Promise((resolve) => {
        resolver = resolve;
        openDialog(dialog, focus === 'cancel' ? cancel : ok);
      });
    };
  })();

  // ================================================================ index de l'état

  function buildWhere(s) {
    const map = new Map();
    for (const t of s.tables) {
      for (const slot of SLOTS) {
        const m = t.slots[slot];
        if (m) for (const p of m.players) map.set(p.id, { type: 'table', table: t, slot, match: m, player: p });
      }
    }
    for (const e of s.queue) for (const p of e.players) map.set(p.id, { type: 'queue', entry: e, player: p });
    for (const g of s.goodies || []) if (!map.has(g.id)) map.set(g.id, { type: 'goodies', player: g });
    return map;
  }

  function etaText(entryId) {
    const at = etas.get(entryId);
    if (at === undefined) return null;
    if (at - now() < 2 * MIN) return 'passage imminent';
    return `passage estimé vers ${clock(at)}`;
  }

  function findParticipant(id) {
    const loc = where.get(id);
    if (loc) return loc.player;
    return (searchResults || []).find((p) => p.id === id) || null;
  }

  function findMatch(matchId) {
    for (const t of state.tables) {
      for (const slot of SLOTS) {
        const m = t.slots[slot];
        if (m && m.matchId === matchId) return { table: t, slot, match: m };
      }
    }
    return null;
  }

  function matchNames(m, full = true) {
    const names = m.players.map(full ? fullName : shortName);
    if (m.vsAnimator) names.push('Animateur');
    return names;
  }

  // ================================================================ « À appeler » (mémorisé sur ce poste)

  // Parties placées automatiquement que l'hôtesse doit annoncer (y compris le joueur seul qui
  // attendait ailleurs et que l'on vient d'associer, ou le joueur « placé quand même »).
  // Mémorisées dans le navigateur (survivent à un rechargement) ; au premier état reçu (nouvel
  // appareil, stockage effacé, autre base), les placements de moins de 3 minutes sont repris.
  // Retirées par « Installés », « Tout marquer installés » ou à la fin de la partie.
  //
  // Une base remise à zéro (ou restaurée depuis une sauvegarde) réattribue les mêmes numéros de
  // journée et de partie : la mémoire est donc rattachée à la base (« id:début » de la journée) et
  // chaque partie est reconnue par son numéro ET son heure de début, jamais par son numéro seul.
  const RECENT_CALL_MS = 3 * MIN;
  const SEEN_MAX = 500;
  const calls = new Map(); // matchId → heure de début de la partie (null : pas encore reçue)
  let callsSeen = new Map(); // matchId → heure de début des parties déjà examinées
  let callsBase = null; // « jour.id:jour.startedAt » de la base dont viennent ces numéros
  let callsSynced = false;

  const baseKey = (day) => (day ? `${day.id}:${day.startedAt}` : null);
  const isStamp = (v) => v === null || Number.isFinite(v);

  function loadCalls() {
    try {
      for (const k of OLD_CALLS_KEYS) window.localStorage.removeItem(k); // format sans base : ignoré
      const raw = window.localStorage.getItem(CALLS_KEY);
      const data = raw ? JSON.parse(raw) : null;
      if (data && typeof data.base === 'string' && Array.isArray(data.pending) && Array.isArray(data.seen)) {
        callsBase = data.base;
        for (const c of data.pending) {
          if (c && Number.isSafeInteger(c.matchId) && isStamp(c.startedAt)) calls.set(c.matchId, c.startedAt);
        }
        for (const c of data.seen) {
          if (Array.isArray(c) && Number.isSafeInteger(c[0]) && isStamp(c[1])) callsSeen.set(c[0], c[1]);
        }
      }
    } catch {
      /* stockage indisponible (navigation privée…) : la liste ne survit simplement pas au rechargement */
    }
  }

  function saveCalls() {
    if (callsBase === null) return; // rien de fiable à rattacher avant le premier état
    while (callsSeen.size > SEEN_MAX) callsSeen.delete(callsSeen.keys().next().value);
    try {
      window.localStorage.setItem(CALLS_KEY, JSON.stringify({
        base: callsBase,
        pending: [...calls].map(([matchId, startedAt]) => ({ matchId, startedAt })),
        seen: [...callsSeen],
      }));
    } catch {
      /* idem */
    }
  }

  // Heure de début d'une partie en cours (null si l'état ne la contient pas encore).
  function matchStartedAt(matchId) {
    for (const t of state?.tables || []) {
      for (const s of SLOTS) if (t.slots[s]?.matchId === matchId) return t.slots[s].startedAt;
    }
    return null;
  }

  function addCall(matchId) {
    const startedAt = callsSeen.get(matchId) ?? matchStartedAt(matchId);
    callsSeen.delete(matchId);
    callsSeen.set(matchId, startedAt);
    if (!calls.has(matchId)) calls.set(matchId, startedAt);
    saveCalls();
  }

  function removeCall(matchId) {
    if (!calls.delete(matchId)) return false;
    saveCalls();
    return true;
  }

  // Ajoute les nouveaux placements à annoncer, oublie les parties terminées et ce qui vient d'une
  // autre journée ou d'une autre base. Renvoie le nombre de nouveaux appels.
  function syncCalls(s) {
    let changed = false;
    const base = baseKey(s.day);
    if (callsBase !== base) {
      calls.clear();
      callsSeen = new Map();
      callsSynced = false;
      callsBase = base;
      changed = true;
    }
    const t0 = now();
    const active = new Map();
    for (const t of s.tables) for (const slot of SLOTS) if (t.slots[slot]) active.set(t.slots[slot].matchId, t.slots[slot]);
    let fresh = 0;
    for (const [id, m] of active) {
      const known = callsSeen.has(id) ? callsSeen.get(id) : undefined;
      if (known === m.startedAt) continue;
      changed = true;
      if (known === null) {
        // Ajoutée par une action de ce poste avant de recevoir l'état : on note son heure de début.
        callsSeen.set(id, m.startedAt);
        if (calls.has(id)) calls.set(id, m.startedAt);
        continue;
      }
      // Numéro inconnu, ou déjà vu pour une AUTRE partie (sauvegarde restaurée) : nouvelle partie.
      calls.delete(id);
      callsSeen.delete(id);
      callsSeen.set(id, m.startedAt);
      // Partie lancée par l'inscription faite au comptoir : rien à annoncer… sauf si un joueur seul
      // déjà en file (absent du comptoir) a été associé aux nouveaux inscrits.
      if (ownMatches.has(id) && m.players.every((p) => ownPlayers.has(p.id))) continue;
      // Premier état reçu : seules les parties qui viennent de commencer restent à appeler.
      if (!callsSynced && t0 - m.startedAt > RECENT_CALL_MS) continue;
      calls.set(id, m.startedAt);
      if (callsSynced) fresh++;
    }
    for (const [id, startedAt] of [...calls]) {
      const m = active.get(id);
      if (!m || (startedAt !== null && startedAt !== m.startedAt)) {
        calls.delete(id);
        changed = true;
      }
    }
    callsSynced = true;
    if (changed) saveCalls();
    return fresh;
  }

  // ================================================================ connexion & état

  const connEl = $('#conn');
  const connLabel = $('#conn-label');
  const offlineBanner = $('#offline-banner');
  let everConnected = false;

  function setConnection(online) {
    connEl.dataset.state = online ? 'online' : 'offline';
    connLabel.textContent = online ? 'Connecté' : 'Déconnecté';
    connEl.title = online ? 'Connecté au serveur (temps réel)' : 'Déconnecté du serveur – reconnexion en cours';
    offlineBanner.hidden = online || !everConnected;
    document.body.classList.toggle('is-offline', !online && everConnected);
    if (online) everConnected = true;
  }

  function onState(next) {
    const prev = state;
    state = next;
    stateSeq++;
    where = buildWhere(next);
    etas = LC.estimate(next, now()).etas;
    if (prev) notifyChanges(prev, next);
    const fresh = syncCalls(next);
    renderAll();
    if (fresh) flashCalls();
    for (const resolve of stateWaiters.splice(0)) resolve();
  }

  // Résout à la réception du prochain état (au plus tard après `ms`).
  const stateWaiters = [];
  function nextState(ms = 2000) {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        const i = stateWaiters.indexOf(done);
        if (i >= 0) stateWaiters.splice(i, 1);
        resolve();
      };
      const timer = setTimeout(done, ms);
      stateWaiters.push(done);
    });
  }

  // Fins de partie → courte notification « goodies à remettre » (la liste 03 fait foi).
  // Les placements automatiques vont dans la liste persistante « À appeler » (syncCalls).
  // Joueurs dont l'hôtesse vient de terminer la partie (« Terminer la partie (goodies) ») : sa
  // propre notification suffit, pas de seconde « fin de partie » à la réception de l'état.
  const quietGoodies = new Set();

  function notifyChanges(prev, next) {
    if (prev.day.id !== next.day.id) return;
    const prevGoodies = new Set((prev.goodies || []).map((g) => g.id));
    const ended = (next.goodies || []).filter((g) => {
      if (prevGoodies.has(g.id) || g.goodiesGivenAt) return false;
      return !quietGoodies.delete(g.id);
    });
    const byMatch = new Map();
    for (const g of ended) {
      const k = `${g.tableNo}${g.slot}`;
      if (!byMatch.has(k)) byMatch.set(k, { tableNo: g.tableNo, slot: g.slot, names: [] });
      byMatch.get(k).names.push(shortName(g));
    }
    const groups = [...byMatch.values()];
    if (groups.length === 1) {
      const m = groups[0];
      toast(`Fin de partie Table ${m.tableNo} · ${m.slot} : goodies à remettre à ${joinNames(m.names)} (liste 03).`, 'info');
    } else if (groups.length) {
      toast(`${groups.length} fins de partie : ${plural(ended.length, 'joueur', 'joueurs')} à qui remettre les goodies (liste 03).`, 'info');
    }
  }

  function renderAll() {
    if (!state) return;
    renderTopbar();
    renderCalls();
    renderTables();
    renderSlotPop();
    renderQueue();
    renderGoodies();
    renderLastRegistration();
    renderSearchResults();
    updateSettingsDialog();
    updateNewDayDialog();
    tick();
  }

  // ================================================================ barre du haut

  function renderTopbar() {
    const st = state.stats || {};
    $('#day-badge').textContent = `Jour ${state.day.number}`;
    $('#stat-waiting').textContent = st.waiting ?? '–';
    $('#stat-playing').textContent = st.playing ?? '–';
    $('#stat-completed').textContent = st.completedToday ?? '–';
    $('#stat-goodies').textContent = st.goodiesPending ?? '–';
    $('#stat-total').textContent = st.totalParticipants ?? '–';
    $('#stat-goodies-box').classList.toggle('is-pending', (st.goodiesPending || 0) > 0);
    renderStandState();
  }

  // ---------------------------------------------------------------- « Fermer le stand » / « Rouvrir le stand »

  const standBtn = $('#btn-stand');
  const standLabel = $('.btn-stand-label', standBtn);
  const newDayBtn = $('#btn-newday');
  const closedBanner = $('#closed-banner');
  const closedDetail = $('#closed-detail');
  const closedNewDay = $('#closed-newday');
  const closedReopen = $('#closed-reopen');
  const formPaused = $('#form-paused');
  let standKey = '';

  // Bouton, bandeau et avertissement du formulaire : simples bascules (aucun re-rendu du formulaire).
  // Stand fermé : le bouton de la barre disparaît, l'action est dans le bandeau (une seule fois).
  // Appelée aussi par tick() : au petit matin, le bandeau passe de lui-même en mode « Nouvelle journée ».
  const closedTitle = $('#closed-title');
  const moreDot = $('#more-dot');

  function renderStandState() {
    if (!state) return;
    const paused = isPaused();
    const morning = paused && staleDay();
    const stalePlayers = morning ? staleQueuePlayers() : 0;
    const key = JSON.stringify([paused, morning, stalePlayers, state.day.number, state.day.startedAt]);
    if (key === standKey) return;
    standKey = key;
    const label = paused ? 'Rouvrir le stand' : 'Fermer le stand';
    if (standLabel.textContent !== label) standLabel.textContent = label;
    standBtn.hidden = paused;
    document.body.classList.toggle('is-dusk', paused); // fond « crépuscule » (theme.css, .rb-aura.is-dusk)
    standBtn.title = 'Le soir, à la fermeture : plus aucun placement automatique';
    newDayBtn.classList.toggle('is-morning', morning);
    moreDot.hidden = !morning;
    closedBanner.hidden = !paused;
    closedBanner.classList.toggle('is-morning', morning);
    closedNewDay.hidden = !morning;
    closedReopen.textContent = morning ? 'Rouvrir quand même…' : 'Rouvrir le stand';
    closedReopen.classList.toggle('btn-on-dark', !morning);
    closedReopen.classList.toggle('btn-ghost-on-dark', morning);
    closedTitle.textContent = morning
      ? 'Stand fermé depuis la veille : démarrez la nouvelle journée'
      : 'Stand fermé : aucun nouveau placement';
    closedDetail.textContent = morning
      ? `Jour ${state.day.number} commencé le ${dateFmt.format(new Date(state.day.startedAt))}` +
        (stalePlayers ? ` · ${plural(stalePlayers, 'joueur attend', 'joueurs attendent')} depuis la veille` : '') +
        ' · « Nouvelle journée » vide la file et rouvre le stand.'
      : "Les parties en cours vont jusqu'au bout (goodies compris). Le matin : « Nouvelle journée ».";
    formPaused.hidden = !paused;
  }

  closedNewDay.addEventListener('click', () => openNewDay());
  closedReopen.addEventListener('click', () => standBtn.click());

  function placementsOnReopen() {
    let free = 0;
    for (const t of state.tables) if (t.enabled) for (const s of SLOTS) if (!t.slots[s]) free++;
    const ready = state.queue.filter((e) => e.ready);
    const placed = ready.slice(0, free);
    return {
      free,
      ready: ready.length,
      matches: placed.length,
      players: placed.reduce((n, e) => n + e.players.length, 0),
    };
  }

  standBtn.addEventListener('click', async () => {
    if (!state) return;
    if (!isPaused()) {
      const waitingPlayers = state.queue.reduce((n, e) => n + e.players.length, 0);
      let matches = 0;
      for (const t of state.tables) for (const s of SLOTS) if (t.slots[s]) matches++;
      const ok = await confirmDialog({
        title: 'Fermer le stand ?',
        html: `<p class="confirm-text">Plus <strong>aucun joueur ne sera placé</strong> automatiquement aux tables.</p>
          <ul class="confirm-list">
            <li>Les parties en cours (<strong>${matches}</strong>) vont jusqu'au bout : leurs joueurs auront leurs goodies.</li>
            <li>La file d'attente (<strong>${plural(waitingPlayers, 'joueur', 'joueurs')}</strong>) reste affichée ici, mais personne n'y sera placé ; l'écran TV affiche à la place un message de fermeture.</li>
            <li>Les inscriptions restent possibles : les nouveaux inscrits attendront en file.</li>
          </ul>
          <p class="confirm-note">À utiliser le soir, à la fermeture, pour que la file ne soit pas placée pendant la nuit.
            Le matin, « Nouvelle journée » rouvre le stand ; les joueurs encore en file pourront se réinscrire.
            Pour une pause en journée, mettez plutôt les tables hors service (Réglages).</p>`,
        ok: 'Fermer le stand',
        tone: 'warn',
        focus: 'cancel',
      });
      if (!ok) return;
      run('setPlacementsPaused', { paused: true }, {
        button: standBtn,
        success: "Stand fermé : plus aucun nouveau placement. Les parties en cours vont jusqu'au bout.",
      }).catch(() => {});
    } else {
      const morning = staleDay();
      const stalePlayers = morning ? staleQueuePlayers() : 0;
      const p = placementsOnReopen();
      const rest = p.ready - p.matches;
      const now0 = p.matches
        ? `<strong>${plural(p.matches, 'partie lancée', 'parties lancées')} tout de suite</strong> (${plural(p.players, 'joueur placé', 'joueurs placés')} aux emplacements libres)` +
          (rest ? `, puis ${rest >= 2 ? `les ${rest} entrées suivantes` : "l'entrée suivante"} de la file au fil des fins de partie.` : '.')
        : p.ready
          ? `Aucun emplacement libre : ${p.ready >= 2 ? `les ${p.ready} entrées prêtes de la file seront placées` : "l'entrée prête de la file sera placée"} au fil des fins de partie.`
          : "Personne n'est placé tout de suite : aucun joueur prêt dans la file.";
      const dayLine = `Journée en cours : <strong>jour ${state.day.number}</strong>, commencée le ${esc(dateFmt.format(new Date(state.day.startedAt)))}.`;
      const warning = morning
        ? `<div class="confirm-alert">
            <p><strong>Le stand est fermé depuis la veille.</strong>${stalePlayers ? ` ${plural(stalePlayers, 'joueur attend', 'joueurs attendent')} en file depuis hier soir : ${stalePlayers >= 2 ? "ils seraient placés alors qu'ils ne sont sans doute plus là" : "il serait placé alors qu'il n'est sans doute plus là"}.` : ''}</p>
            <p>Le matin, utilisez plutôt <strong>« Nouvelle journée »</strong> : elle vide la file (les joueurs pourront se réinscrire), passe au jour ${state.day.number + 1} et rouvre le stand.</p>
            <p><button type="button" class="btn btn-primary btn-sm" data-open-newday>Nouvelle journée…</button></p>
          </div>`
        : '<p class="confirm-note">Le matin, utilisez plutôt « Nouvelle journée » : elle vide la file de la veille et rouvre aussi le stand.</p>';
      const ok = await confirmDialog({
        title: 'Rouvrir le stand ?',
        html: `${warning}
          <p class="confirm-text">Les placements automatiques reprennent :</p>
          <ul class="confirm-list">
            <li>${now0}</li>
            <li>${dayLine}</li>
          </ul>`,
        ok: morning ? 'Rouvrir quand même' : 'Rouvrir le stand',
        tone: morning ? 'warn' : 'primary',
        focus: 'cancel',
      });
      if (!ok) return;
      run('setPlacementsPaused', { paused: false }, {
        button: standBtn,
        success: (r) =>
          r.placed
            ? `Stand rouvert : ${plural(r.placed, 'partie lancée', 'parties lancées')} (voir « À appeler »).`
            : 'Stand rouvert : les placements automatiques reprennent.',
      }).catch(() => {});
    }
  });

  // ---------------------------------------------------------------- menu « ⋯ » de la barre

  const moreBtn = $('#btn-more');
  const moreMenu = $('#more-menu');

  function openMoreMenu() {
    moreMenu.hidden = false;
    moreBtn.setAttribute('aria-expanded', 'true');
    const visible = $$('.menu-item', moreMenu).find((el) => el.offsetParent !== null);
    if (visible) visible.focus({ preventScroll: true });
  }

  function closeMoreMenu(restoreFocus = false) {
    if (moreMenu.hidden) return;
    moreMenu.hidden = true;
    moreBtn.setAttribute('aria-expanded', 'false');
    if (restoreFocus) moreBtn.focus({ preventScroll: true });
  }

  moreBtn.addEventListener('click', () => (moreMenu.hidden ? openMoreMenu() : closeMoreMenu()));
  moreMenu.addEventListener('click', (e) => {
    if (e.target.closest('[data-open-newday]')) {
      closeMoreMenu();
      openNewDay();
    } else if (e.target.closest('a, button')) {
      // Les liens et le formulaire de déconnexion suivent leur cours ; on referme juste le menu.
      setTimeout(() => closeMoreMenu(), 0);
    }
  });

  // Flèches haut/bas dans les menus.
  function menuKeys(menu, e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = $$('.menu-item', menu).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? items[(i + 1) % items.length] : items[(i - 1 + items.length) % items.length];
    next.focus();
  }
  moreMenu.addEventListener('keydown', (e) => menuKeys(moreMenu, e));

  // ================================================================ 02 · à appeler

  const callsPanel = $('#panel-calls');
  const callsList = $('#calls-list');
  const callsCount = $('#calls-count');
  const callsSub = $('#calls-sub');
  const callsClear = $('#calls-clear');

  function callItems() {
    const items = [];
    for (const t of state.tables) {
      for (const s of SLOTS) {
        const m = t.slots[s];
        if (m && calls.has(m.matchId)) items.push({ table: t, slot: s, match: m });
      }
    }
    return items.sort((a, b) => a.match.startedAt - b.match.startedAt || a.table.no - b.table.no);
  }

  function callHtml({ table, slot, match: m }) {
    const id = m.matchId;
    const names = joinNames(matchNames(m));
    const many = m.players.length >= 2;
    const animator = m.vsAnimator ? '<span class="call-chip">Prévenir un animateur</span>' : '';
    return `<li class="call" data-match="${id}">
      <button type="button" class="call-place" data-action="open-slot" data-table="${table.no}" data-slot="${slot}" data-focus="call-open-${id}"
        title="Ouvrir le panneau de l'emplacement (±5 min, Absent, Terminer, Libérer)" aria-label="${esc(`Table ${table.no}, emplacement ${slot} : ouvrir le panneau`)}">
        <span class="plate"><small>Table</small>${table.no}</span><span class="call-slot">${slot}</span>
      </button>
      <div class="call-main">
        <span class="call-names" title="${esc(names)}">${esc(names)}</span>
        <span class="call-meta"><span>${slot === 'A' ? 'Moitié gauche' : 'Moitié droite'} · ${many ? 'placés' : 'placé'} <span data-ago="${m.startedAt}"></span></span>${animator}</span>
      </div>
      <div class="call-actions">
        <button type="button" class="btn btn-dark" data-action="seated" data-match="${id}" data-focus="call-done-${id}"
          aria-label="${esc(`${names} : ${many ? 'installés' : 'installé'} à la table ${table.no} ${slot}`)}">${ICON('check')}${many ? 'Installés' : 'Installé'}</button>
        <button type="button" class="btn btn-ghost btn-icon" data-action="call-menu" data-match="${id}" data-focus="call-menu-${id}"
          aria-haspopup="menu" aria-expanded="false" aria-label="${esc(`Autres actions (absent…) : table ${table.no} ${slot}`)}">${ICON('more')}</button>
      </div>
    </li>`;
  }

  function renderCalls() {
    const items = callItems();
    const n = items.length;
    callsPanel.classList.toggle('has-calls', n > 0);
    callsCount.textContent = String(n);
    callsCount.classList.toggle('is-pending', n > 0);
    callsClear.hidden = n < 2;
    callsPanel.classList.toggle('has-many', n >= 2);
    callsSub.textContent = n
      ? 'Annoncez la table aux joueurs, puis « Installés »'
      : 'Personne à appeler pour l’instant';
    const title = n ? `(${n}) À appeler – ${TITLE}` : TITLE;
    if (document.title !== title) document.title = title;
    const key = JSON.stringify(items.map((x) => [x.match.matchId, x.table.no, x.slot, x.match.vsAnimator, x.match.startedAt, x.match.players.map((p) => [p.id, p.firstName, p.lastName])]));
    patch(callsList, key, () => items.map(callHtml).join(''));
    if (rowMenuFor && rowMenuFor.matchId !== undefined && !items.some((x) => x.match.matchId === rowMenuFor.matchId)) closeRowMenu();
  }

  // Nouveaux placements à annoncer : le panneau s'illumine brièvement (la liste fait foi).
  let flashTimer = null;
  function flashCalls() {
    callsPanel.classList.remove('is-flash');
    void callsPanel.offsetWidth;
    callsPanel.classList.add('is-flash');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => callsPanel.classList.remove('is-flash'), 2400);
  }

  function markSeated(matchId) {
    const focusNext = callsList.contains(document.activeElement);
    const items = [...callsList.querySelectorAll('.call')];
    const i = items.findIndex((li) => Number(li.dataset.match) === matchId);
    if (!removeCall(matchId)) return;
    renderCalls();
    renderTables();
    renderSlotPop();
    if (focusNext) {
      const buttons = $$('[data-action="seated"]', callsList);
      const next = buttons[Math.min(Math.max(i, 0), buttons.length - 1)];
      (next || inputOf(0, 'firstName')).focus({ preventScroll: true });
    }
  }

  callsClear.addEventListener('click', () => {
    const focusIn = callsPanel.contains(document.activeElement);
    for (const id of [...calls.keys()]) removeCall(id);
    renderCalls();
    renderTables();
    renderSlotPop();
    if (focusIn) inputOf(0, 'firstName').focus({ preventScroll: true });
  });

  function openCallSlot(tableNo, slot) {
    setTab('plan');
    const slotBtn = tableEls[tableNo - 1]?.slots[slot];
    if (slotBtn) {
      if (popTarget && popTarget.tableNo === tableNo && popTarget.slot === slot) closeSlotPop();
      openSlotPop(slotBtn, { focus: true });
    }
  }

  callsList.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn || !state) return;
    if (btn.dataset.action === 'seated') markSeated(Number(btn.dataset.match));
    else if (btn.dataset.action === 'open-slot') openCallSlot(Number(btn.dataset.table), btn.dataset.slot);
    else if (btn.dataset.action === 'call-menu') openCallMenu(btn);
  });

  // Menu « ⋯ » d'un appel : « Absent : nom » (pendant les 15 premières minutes) et accès au panneau.
  function openCallMenu(btn) {
    const matchId = Number(btn.dataset.match);
    const found = findMatch(matchId);
    if (!found) return;
    if (rowMenuFor && rowMenuFor.matchId === matchId) {
      closeRowMenu(true);
      return;
    }
    closeRowMenu();
    const { table, slot, match } = found;
    const left = match.startedAt + noShowWindow() - now();
    const items = [];
    if (left > 0) {
      for (const p of match.players) {
        items.push(`<button type="button" class="menu-item is-danger" role="menuitem" data-action="noshow" data-match="${matchId}" data-participant="${p.id}">Absent : ${esc(fullName(p))}<small>retiré sans goodies · encore ${Math.max(1, Math.ceil(left / MIN))} min</small></button>`);
      }
    } else {
      items.push(`<p class="menu-note">« Absent » n'est plus possible : la partie a commencé il y a plus de ${Math.round(noShowWindow() / MIN)} min.</p>`);
    }
    items.push('<div class="menu-sep" role="separator"></div>');
    items.push(`<button type="button" class="menu-item" role="menuitem" data-action="open-slot" data-table="${table.no}" data-slot="${slot}">Ouvrir Table ${table.no} · ${slot}<small>±5 min, Terminer, Libérer</small></button>`);
    showRowMenu(btn, items.join(''), { matchId });
  }

  // ================================================================ plan des tables

  const tablesGrid = $('#tables-grid');
  const tableEls = [];

  function buildTables() {
    for (let no = 1; no <= 9; no++) {
      const card = document.createElement('article');
      card.className = 'table-card';
      card.dataset.table = String(no);
      card.innerHTML = `
        <div class="table-head"><span class="table-no">${no}</span><span class="table-label">Table ${no}</span><span class="table-flag"></span></div>
        <div class="table-slots">
          <button type="button" class="slot" data-table="${no}" data-slot="A" aria-haspopup="dialog" aria-expanded="false"></button>
          <button type="button" class="slot" data-table="${no}" data-slot="B" aria-haspopup="dialog" aria-expanded="false"></button>
        </div>`;
      tablesGrid.append(card);
      tableEls.push({
        card,
        flag: $('.table-flag', card),
        slots: { A: $('[data-slot="A"]', card), B: $('[data-slot="B"]', card) },
      });
    }
  }

  // Chaise de l'animateur (comme sur l'écran TV) : le joueur restant garde sa chaise (seat 1 = haut,
  // 2 = bas), l'animateur prend l'autre. null : deux joueurs.
  function hostChair(m) {
    if (!m.vsAnimator) return null;
    return m.players[0] && m.players[0].seat === 2 ? 'top' : 'bottom';
  }

  // Anneau de temps : part restante (0 → 1), arrondie au 1/200 (un repeint toutes les ~18 s par anneau).
  function ringLeft(start, end, t = now()) {
    const left = 1 - Math.min(1, Math.max(0, (t - start) / Math.max(1, end - start)));
    return String(Math.round(left * 200) / 200);
  }

  // Met à jour les anneaux de `root` (sans repeindre ceux dont la valeur n'a pas changé).
  function syncRings(root = document, t = now()) {
    for (const el of root.querySelectorAll('.rb-ring[data-start][data-end]')) {
      const p = ringLeft(Number(el.dataset.start), Number(el.dataset.end), t);
      if (el.style.getPropertyValue('--p') !== p) el.style.setProperty('--p', p);
    }
  }

  const LONG_NAME = 12; // caractères (« Prénom N. ») au-delà desquels un nom risque d'être coupé

  const remainingText = (endsAt) => {
    const left = endsAt - now();
    return left > 0 ? LC.formatRemaining(left) : 'Terminé';
  };

  // Contenu d'un emplacement : l'essentiel (état, anneau de temps autour de la lettre, chrono, noms
  // dans l'ordre des chaises). Les actions sont dans le panneau. Chrono écrit dès le rendu (pas de
  // case vide jusqu'à la seconde suivante) ; l'anneau est réglé par syncRings juste après.
  function slotHtml(table, slot, m, paused) {
    if (!m) {
      const label = !table.enabled ? 'Hors service' : paused ? 'Libre<small>stand fermé</small>' : 'Libre';
      return `<span class="slot-top"><span class="slot-ring is-empty" aria-hidden="true"><span class="slot-letter">${slot}</span></span></span><span class="slot-state">${label}</span>`;
    }
    // Prénom composé (« Marie-Charlotte D. ») : peut passer sur deux lignes plutôt que d'être coupé.
    const shorts = m.players.map(shortName);
    const longs = shorts.filter((n) => n.length >= LONG_NAME).length;
    const names = shorts.map((n) => `<span class="sn${n.length >= LONG_NAME ? ' is-long' : ''}">${esc(n)}</span>`);
    if (m.vsAnimator) {
      const host = '<span class="sn is-animator">Animateur</span>';
      if (hostChair(m) === 'top') names.unshift(host);
      else names.push(host);
    }
    const chip = calls.has(m.matchId)
      ? '<span class="slot-chip chip-call">À appeler</span>'
      : `<span class="slot-chip chip-new" data-new-until="${m.startedAt + NEW_BADGE_MS}"${now() >= m.startedAt + NEW_BADGE_MS ? ' hidden' : ''}>Nouveau</span>`;
    const left = remainingText(m.endsAt);
    return `${chip}<span class="slot-top"><span class="slot-ring rb-ring" data-start="${m.startedAt}" data-end="${m.endsAt}" aria-hidden="true"><span class="slot-letter">${slot}</span></span><span class="countdown${left.length > 5 ? ' is-long' : ''}" data-ends-at="${m.endsAt}">${left}</span></span>
      <span class="slot-names${longs >= 2 ? ' many-long' : ''}">${names.join('')}</span>
      <span class="slot-end">fin prévue à ${clock(m.endsAt)}</span>`;
  }

  function slotLabel(table, slot, m, paused) {
    const place = `Table ${table.no}, emplacement ${slot}`;
    if (!m) return `${place} : ${!table.enabled ? 'hors service' : paused ? 'libre (stand fermé)' : 'libre'}`;
    return `${place} : ${joinNames(matchNames(m))}${calls.has(m.matchId) ? ' (à appeler)' : ''}. Ouvrir les actions.`;
  }

  function renderTables() {
    let busy = 0;
    let busyOff = 0;
    let capacity = 0;
    const paused = isPaused();
    state.tables.forEach((t, i) => {
      const el = tableEls[i];
      if (!el) return;
      el.card.classList.toggle('is-disabled', !t.enabled);
      const count = SLOTS.filter((s) => t.slots[s]).length;
      if (t.enabled) {
        busy += count;
        capacity += SLOTS.length;
      } else busyOff += count;
      el.flag.textContent = t.enabled ? `${count}/2` : 'Hors service';
      for (const slot of SLOTS) {
        const m = t.slots[slot];
        const node = el.slots[slot];
        node.classList.toggle('is-free', !m && t.enabled && !paused);
        node.classList.toggle('is-paused-free', !m && t.enabled && paused);
        node.classList.toggle('is-off', !m && !t.enabled);
        node.classList.toggle('is-busy', !!m);
        node.classList.toggle('is-call', !!m && calls.has(m.matchId));
        const host = m ? hostChair(m) : null;
        node.classList.toggle('host-top', host === 'top');
        node.classList.toggle('host-bottom', host === 'bottom');
        if (!m) node.classList.remove('is-warn', 'is-over');
        const key = JSON.stringify([
          t.enabled,
          !m && paused,
          m && [m.matchId, m.endsAt, m.startedAt, m.vsAnimator, calls.has(m.matchId), m.players.map((p) => [p.id, p.firstName, p.lastName, p.seat])],
        ]);
        if (patch(node, key, () => slotHtml(t, slot, m, paused))) {
          syncRings(node);
          node.setAttribute('aria-label', slotLabel(t, slot, m, paused));
          node.title = m ? joinNames(matchNames(m)) : '';
        }
      }
    });
    const minutes = Math.round(state.settings.matchDurationMs / MIN);
    const off = state.tables.filter((t) => !t.enabled).length;
    const summary = $('#tables-summary');
    summary.textContent =
      `${busy}/${capacity} occupés · parties de ${minutes} min` +
      (off ? ` · ${plural(off, 'table hors service', 'tables hors service')}` : '') +
      (busyOff ? ` (${plural(busyOff, 'partie', 'parties')} en cours dessus)` : '') +
      (paused ? ' · stand fermé' : '');
    summary.title = summary.textContent; // texte complet si la largeur le coupe
    updateOpenSlot();
  }

  tablesGrid.addEventListener('click', (e) => {
    const slotBtn = e.target.closest('button.slot');
    if (!slotBtn || !state) return;
    openSlotPop(slotBtn, { focus: e.detail === 0 });
  });

  // ---------------------------------------------------------------- actions d'une partie (panneau)

  async function handleSlotAction(btn) {
    const matchId = Number(btn.dataset.match);
    const found = findMatch(matchId);
    if (!found) {
      toast('Cette partie est déjà terminée.', 'error');
      return;
    }
    const { table, slot, match } = found;
    const place = `Table ${table.no} · ${slot}`;

    if (btn.dataset.action === 'adjust') {
      const delta = Number(btn.dataset.delta);
      const left = match.endsAt - now();
      if (delta < 0 && left <= -delta) {
        const owed = match.players.map(fullName);
        const goodiesText = owed.length >= 2
          ? `${joinNames(owed)} auront droit à leurs goodies.`
          : `${joinNames(owed)} aura droit à ses goodies.`;
        const ok = await confirmDialog({
          title: `Terminer la partie ${place} ?`,
          html: `<p class="confirm-text">Il reste moins de 5 minutes : retirer 5 minutes <strong>termine la partie maintenant</strong>.</p>
            <p>${esc(goodiesText)}</p>`,
          ok: 'Terminer la partie',
          tone: 'warn',
        });
        if (!ok) return;
      }
      run('adjustMatch', { matchId, deltaMs: delta }, { button: btn })
        .then((r) => {
          if (r.endsAt > now() + 1000) toast(`${place} : ${delta > 0 ? '+5 min' : '−5 min'} · fin prévue à ${clock(r.endsAt)}`);
          else closeSlotPop();
        })
        .catch(() => {});
    } else if (btn.dataset.action === 'release-goodies' || btn.dataset.action === 'release') {
      const withGoodies = btn.dataset.action === 'release-goodies';
      const many = match.players.length >= 2;
      const fate = {
        paused: "Stand fermé : l'emplacement restera libre.",
        disabled: "Table hors service : l'emplacement restera libre.",
        reassigned: "L'emplacement sera réattribué aux joueurs suivants de la file.",
        nobody: "L'emplacement sera libéré (aucun joueur prêt dans la file pour l'instant).",
      }[slotFate(table)];
      const noShowLeft = match.startedAt + noShowWindow() - now();
      const noShowHint = (consequence) =>
        noShowLeft > 0 && match.players.length
          ? `<p class="confirm-alert">${many ? 'Joueurs pas venus' : 'Joueur pas venu'} ? Utilisez plutôt <strong>« Absent »</strong> à côté
              ${many ? 'de chaque nom' : 'du nom'} (encore ${plural(Math.max(1, Math.ceil(noShowLeft / MIN)), 'min', 'min')}) :
              pas de goodies, et ${many ? 'ils pourront se réinscrire' : 'il/elle pourra se réinscrire'}. ${consequence}</p>`
          : '';
      let ok;
      if (withGoodies) {
        // L'hôtesse confirme la participation : partie terminée, goodies dus, emplacement réattribué.
        const who = joinNames(match.players.map(fullName)) || 'Le joueur';
        const started = `Partie commencée à ${clock(match.startedAt)} (il y a ${formatWait(now() - match.startedAt)}), fin prévue à ${clock(match.endsAt)}.`;
        ok = await confirmDialog({
          title: `Terminer la partie ${place} ?`,
          html: `<p class="confirm-text"><strong>${esc(who)}</strong> ${many ? 'ont' : 'a'} bien joué : la partie est terminée et
              <strong>${many ? 'ils ont' : 'il/elle a'} droit aux goodies</strong> (liste «&nbsp;03 Goodies à remettre&nbsp;»).</p>
            <p class="confirm-note">${esc(fate)} ${esc(started)}</p>
            ${noShowHint(`Avec «&nbsp;Terminer&nbsp;», ${many ? 'ils recevraient' : 'il/elle recevrait'} les goodies.`)}`,
          ok: 'Terminer la partie (goodies)',
          tone: 'success',
        });
      } else {
        ok = await confirmDialog({
          title: `Libérer ${place} sans goodies ?`,
          html: `<p class="confirm-text"><strong>${esc(joinNames(matchNames(match)))}</strong> ${many ? 'quittent' : 'quitte'} la table avant la fin.</p>
            <p class="confirm-note">Départ anticipé : pas de goodies, et ${many ? 'ces joueurs ne pourront plus se réinscrire' : 'ce joueur ne pourra plus se réinscrire'}
              au salon (${idsUsed(match.players)}). ${fate}</p>
            <p class="confirm-note">${many ? 'Ils ont' : 'Il/elle a'} bien joué ? Utilisez plutôt «&nbsp;Terminer la partie (goodies)&nbsp;».</p>
            ${noShowHint(`Avec «&nbsp;Libérer sans goodies&nbsp;», ${many ? 'ils ne le pourront plus' : 'il/elle ne le pourra plus'}.`)}`,
          ok: 'Libérer sans goodies',
          tone: 'danger',
          focus: 'cancel', // action irréversible : Entrée ne doit pas libérer par réflexe
        });
      }
      if (!ok) return;
      await endMatchEarly(found, { withGoodies, button: btn });
    } else if (btn.dataset.action === 'noshow') {
      await declareNoShow(Number(btn.dataset.participant), found, btn);
    }
  }

  // Fin de partie avant le timer. withGoodies : l'hôtesse confirme la participation (partie terminée,
  // goodies dus, listés dans 03) ; sinon départ anticipé, sans goodies. Le serveur répond
  // { released, withGoodies } : goodies dus aussi si le timer venait de s'écouler.
  async function endMatchEarly({ table, slot, match }, { withGoodies, button }) {
    const matchId = match.matchId;
    const place = `Table ${table.no} · ${slot}`;
    const ids = match.players.map((p) => p.id);
    for (const id of ids) quietGoodies.add(id); // notre notification remplace celle de « fin de partie »
    let r;
    try {
      r = await run('releaseMatch', withGoodies ? { matchId, withGoodies: true } : { matchId }, { button });
    } catch {
      for (const id of ids) quietGoodies.delete(id);
      return;
    }
    const names = joinNames(match.players.map(shortName)) || 'le joueur';
    if (r && r.withGoodies) {
      toast(
        withGoodies
          ? `${place} terminée : goodies à remettre à ${names} (liste 03).`
          : `${place} : le temps était écoulé, partie terminée normalement. Goodies à remettre à ${names} (liste 03).`,
        withGoodies ? 'success' : 'info',
        6000,
      );
    } else {
      for (const id of ids) quietGoodies.delete(id);
      toast(`${place} libérée : départ anticipé, sans goodies.`);
    }
    if (popTarget && popTarget.matchId === matchId) closeSlotPop({ restoreFocus: true });
  }

  // Joueur placé qui ne s'est pas présenté (premières minutes de la partie) : retiré sans goodies,
  // il pourra se réinscrire. Son partenaire joue contre un animateur ; sinon la partie est annulée.
  async function declareNoShow(participantId, { table, slot, match }, btn) {
    const p = match.players.find((x) => x.id === participantId);
    if (!p) return;
    const place = `Table ${table.no} · ${slot}`;
    const name = fullName(p);
    const partners = match.players.filter((x) => x.id !== participantId).map(fullName);
    const minutes = Math.round(noShowWindow() / MIN);
    if (now() - match.startedAt >= noShowWindow()) {
      toast(`La partie a commencé il y a plus de ${minutes} min : « Absent » n'est plus possible (personne à la table : « Libérer sans goodies »).`, 'error');
      return;
    }
    const placeNb = place.replace(/ /g, ' ');
    const cancelled = `Plus personne à cette table : la partie est annulée et l'emplacement ${placeNb}`;
    const consequence = partners.length
      ? `Son partenaire, <strong>${esc(joinNames(partners))}</strong>, jouera contre un animateur (même timer, fin prévue à ${clock(match.endsAt)}).`
      : {
          paused: `${cancelled} est libéré (stand fermé : personne n'y sera placé).`,
          disabled: `${cancelled} est libéré (table hors service : personne n'y sera placé).`,
          reassigned: `${cancelled} sera réattribué aux joueurs suivants de la file.`,
          nobody: `${cancelled} est libéré (aucun joueur prêt dans la file pour l'instant).`,
        }[slotFate(table)];
    const ok = await confirmDialog({
      title: `${name} est absent(e) ?`,
      html: `<p class="confirm-text"><strong>${esc(name)}</strong> ne s'est pas présenté(e) à ${placeNb} : il/elle est retiré(e), <strong>sans goodies</strong>, et pourra se réinscrire avec ${hasEmail(p) ? 'le même email et le même billet' : 'le même billet'}.</p>
        <p class="confirm-note">${consequence}</p>`,
      ok: "Confirmer l'absence",
      tone: 'danger',
    });
    if (!ok) return;
    run('noShow', { participantId }, { button: btn })
      .then(async (r) => {
        if (r.cancelled) {
          const slotNow = () => {
            const t = state.tables.find((x) => x.no === table.no);
            return { table: t || table, match: t ? t.slots[slot] : null };
          };
          if (slotNow().match && slotNow().match.matchId === r.matchId) await nextState();
          if (popTarget && popTarget.matchId === r.matchId) closeSlotPop({ restoreFocus: true });
          const cur = slotNow();
          const head = `${name} absent(e), retiré(e) sans goodies. Partie annulée`;
          if (cur.match && cur.match.matchId !== r.matchId) {
            toast(`${place} redonné à ${joinNames(matchNames(cur.match, false))} : voir « À appeler ». ${shortName(p)} absent(e), retiré(e) sans goodies, partie annulée.`);
          } else if (cur.match) {
            toast(`${head} (${place}).`);
          } else {
            const why = isPaused() ? ' (stand fermé)' : !cur.table.enabled ? ' (table hors service)' : '';
            toast(`${head} : ${place} est libre${why}.`);
          }
        } else if (r.vsAnimator && partners.length) {
          const partnersShort = match.players.filter((x) => x.id !== participantId).map((x) => shortName(x));
          toast(`Prévenez un animateur : il joue contre ${joinNames(partnersShort)} (${place}). ${shortName(p)} absent(e), retiré(e) sans goodies.`, 'info');
        } else {
          toast(`${name} absent(e), retiré(e) sans goodies.`);
        }
      })
      .catch(() => {});
  }

  // ---------------------------------------------------------------- panneau d'emplacement (popover)

  const pop = $('#slot-pop');
  let popTarget = null; // { tableNo, slot, matchId | null, anchor }

  function openSlotPop(btn, { focus = false } = {}) {
    if (!state) return;
    const tableNo = Number(btn.dataset.table);
    const slot = btn.dataset.slot;
    if (popTarget && popTarget.tableNo === tableNo && popTarget.slot === slot) {
      closeSlotPop({ restoreFocus: focus });
      return;
    }
    closeRowMenu();
    const t = state.tables.find((x) => x.no === tableNo);
    const m = t && t.slots[slot];
    popTarget = { tableNo, slot, matchId: m ? m.matchId : null, anchor: btn };
    pop.__key = null;
    pop.hidden = false;
    renderSlotPop();
    updateOpenSlot();
    tick();
    if (focus) {
      const first = pop.querySelector('.pop-actions .btn, .pop-player .btn');
      (first || pop).focus({ preventScroll: true });
    } else {
      pop.focus({ preventScroll: true });
    }
  }

  function closeSlotPop({ restoreFocus = false } = {}) {
    if (!popTarget) return;
    const anchor = popTarget.anchor;
    popTarget = null;
    pop.hidden = true;
    pop.innerHTML = '';
    pop.__key = null;
    updateOpenSlot();
    if (restoreFocus && anchor && anchor.isConnected) anchor.focus({ preventScroll: true });
  }

  function updateOpenSlot() {
    for (const el of tableEls) {
      for (const s of SLOTS) {
        const open = !!popTarget && popTarget.tableNo === Number(el.slots[s].dataset.table) && popTarget.slot === s;
        el.slots[s].classList.toggle('is-open', open);
        el.slots[s].setAttribute('aria-expanded', String(open));
      }
    }
  }

  function popHead(table, slot, sub) {
    return `<div class="pop-head">
      <span class="pop-plate"><b>${table.no}</b><span>${slot}</span></span>
      <div class="pop-title" id="slot-pop-title">Table ${table.no} · emplacement ${slot}<small>${sub}</small></div>
      <button type="button" class="btn btn-ghost btn-icon" data-action="pop-close" aria-label="Fermer le panneau">${ICON('close')}</button>
    </div>`;
  }

  function renderSlotPop() {
    if (!popTarget || !state) return;
    const table = state.tables.find((x) => x.no === popTarget.tableNo);
    if (!table) {
      closeSlotPop();
      return;
    }
    const slot = popTarget.slot;
    const cur = table.slots[slot];
    const paused = isPaused();
    let key;
    let render;

    if (popTarget.matchId !== null && (!cur || cur.matchId !== popTarget.matchId)) {
      // La partie affichée s'est terminée entre-temps : aucune action ne doit viser la suivante par erreur.
      key = JSON.stringify(['gone', popTarget.matchId, cur && cur.matchId]);
      render = () => `${popHead(table, slot, 'Partie terminée')}
        <p class="pop-note"><b>Cette partie est terminée</b> (fin du temps, libération ou absence).
          ${cur ? `L'emplacement a été redonné à ${esc(joinNames(matchNames(cur)))}.` : "L'emplacement est maintenant libre."}</p>
        <div class="pop-actions"><button type="button" class="btn btn-outline span-2" data-action="pop-refresh" data-focus="pop-refresh">Afficher l'emplacement actuel</button></div>`;
    } else if (cur) {
      const m = cur;
      const id = m.matchId;
      const noShowUntil = m.startedAt + noShowWindow();
      const noShowOpen = now() < noShowUntil;
      const called = calls.has(id);
      key = JSON.stringify(['busy', id, m.endsAt, m.startedAt, m.vsAnimator, called, noShowOpen, table.enabled, paused,
        m.players.map((p) => [p.id, p.firstName, p.lastName, p.email, p.ticket, p.seat])]);
      render = () => {
        // Places à table (comme sur l'écran TV) ; contre un animateur, le joueur garde sa chaise.
        const host = hostChair(m);
        const seats = m.players.length >= 2
          ? ['Joueur 1 · chaise du haut', 'Joueur 2 · chaise du bas']
          : [`Joueur · chaise du ${host === 'top' ? 'bas' : 'haut'}`, `Adversaire · chaise du ${host === 'top' ? 'haut' : 'bas'}`];
        const players = m.players.map((p, i) => {
          const absent = noShowOpen
            ? `<button type="button" class="btn btn-danger-outline btn-absent" data-action="noshow" data-match="${id}" data-participant="${p.id}"
                data-noshow-until="${noShowUntil}" data-focus="pop-noshow-${p.id}"
                title="${esc(`Ne s'est pas présenté : retiré sans goodies, pourra se réinscrire (possible pendant ${Math.round(noShowWindow() / MIN)} min après le début)`)}"
                aria-label="${esc(`${fullName(p)} absent`)}">Absent <small data-noshow-left="${noShowUntil}"></small></button>`
            : '';
          return `<li class="pop-player"><div class="pop-player-main">
              <span class="pop-seat">${seats[i] || 'Joueur'}</span>
              <span class="pop-player-name">${esc(fullName(p))}</span>
              <span class="pop-player-meta">${contactHtml(p)}</span>
            </div>${absent}</li>`;
        });
        if (m.vsAnimator) {
          const animator = `<li class="pop-player is-animator"><div class="pop-player-main">
            <span class="pop-seat">${seats[1]}</span>
            <span class="pop-player-name">Animateur</span>
            <span class="pop-player-meta">Prévenir un animateur : il joue contre ${esc(joinNames(m.players.map(fullName)) || 'le joueur')}</span>
          </div></li>`;
          if (host === 'top') players.unshift(animator);
          else players.push(animator);
        }
        const seated = called
          ? `<button type="button" class="btn btn-dark span-2" data-action="seated" data-match="${id}" data-focus="pop-seated">${ICON('check')}Joueurs installés</button>`
          : '';
        const notes = [];
        if (noShowOpen) {
          notes.push(`<p class="pop-note" data-noshow-until="${noShowUntil}">Joueur pas venu&nbsp;? <b>«&nbsp;Absent&nbsp;»</b> à côté de son nom&nbsp;: il pourra se réinscrire
            (son partenaire jouera contre un animateur).</p>`);
        } else {
          notes.push(`<p class="pop-note">Joueur absent après ${Math.round(noShowWindow() / MIN)}&nbsp;min&nbsp;: si son partenaire est là, <b>laissez jouer</b> contre un animateur&nbsp;; «&nbsp;Libérer sans goodies&nbsp;» sort les deux joueurs.</p>`);
        }
        if (!table.enabled) notes.push("<p class=\"pop-note\">Table hors service : l'emplacement restera libre après cette partie.</p>");
        return `${popHead(table, slot, `Démarrée à\u00a0${clock(m.startedAt)} · fin\u00a0prévue\u00a0à\u00a0${clock(m.endsAt)}`)}
          <div class="pop-time">
            <span class="pop-ring rb-ring" data-start="${m.startedAt}" data-end="${m.endsAt}" aria-hidden="true">VS</span>
            <div class="pop-time-text"><span class="countdown" data-ends-at="${m.endsAt}">${remainingText(m.endsAt)}</span><small>restantes</small></div>
          </div>
          <ul class="pop-players">${players.join('')}</ul>
          <div class="pop-actions">
            ${seated}
            <button type="button" class="btn btn-outline" data-action="adjust" data-match="${id}" data-delta="${-ADJUST_MS}" data-focus="pop-minus"
              aria-label="Retirer 5 minutes">−5 min</button>
            <button type="button" class="btn btn-outline" data-action="adjust" data-match="${id}" data-delta="${ADJUST_MS}" data-focus="pop-plus"
              aria-label="Ajouter 5 minutes">+5 min</button>
          </div>
          ${notes.join('')}
          <div class="pop-end" role="group" aria-label="Fin de partie avant le temps">
            <button type="button" class="btn btn-goodies" data-action="release-goodies" data-match="${id}" data-focus="pop-release-goodies"
              title="Les joueurs ont bien joué : partie terminée, goodies dus (liste 03), emplacement réattribué">${ICON('gift')}<span class="btn-2l">Terminer la partie <small>(goodies)…</small></span></button>
            <button type="button" class="btn btn-danger-quiet" data-action="release" data-match="${id}" data-focus="pop-release"
              title="Départ anticipé : pas de goodies, pas de réinscription"><span class="btn-2l">Libérer sans goodies <small>(départ anticipé)…</small></span></button>
          </div>`;
      };
    } else {
      const ready = state.queue.filter((e) => e.ready).length;
      key = JSON.stringify(['free', table.enabled, paused, ready > 0]);
      render = () => {
        const info = !table.enabled
          ? 'Table hors service : plus personne n’y est placé.'
          : paused
            ? 'Emplacement libre. Stand fermé : personne n’y sera placé.'
            : ready
              ? 'Emplacement libre : les prochains joueurs prêts y seront placés automatiquement.'
              : 'Emplacement libre. Aucun joueur prêt dans la file pour l’instant.';
        const toggle = table.enabled
          ? `<button type="button" class="btn btn-outline span-2" data-action="table-toggle" data-table="${table.no}" data-enabled="0" data-focus="pop-toggle">Mettre la table ${table.no} hors service</button>`
          : `<button type="button" class="btn btn-cyan span-2" data-action="table-toggle" data-table="${table.no}" data-enabled="1" data-focus="pop-toggle">Remettre la table ${table.no} en service</button>`;
        return `${popHead(table, slot, !table.enabled ? 'Hors service' : 'Libre')}
          <p class="pop-note">${info}</p>
          <div class="pop-actions">${toggle}</div>`;
      };
    }
    if (patch(pop, key, render)) {
      syncRings(pop);
      tick();
    }
    positionSlotPop();
  }

  function positionSlotPop() {
    if (!popTarget || pop.hidden) return;
    const anchor = popTarget.anchor;
    if (!anchor.isConnected || anchor.offsetParent === null) {
      closeSlotPop();
      return;
    }
    const a = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const m = 10;
    const topMin = Math.min($('#top-sticky').getBoundingClientRect().bottom + 6, vh - h - m);
    let left;
    let top;
    if (a.right + m + w <= vw - m) left = a.right + m;
    else if (a.left - m - w >= m) left = a.left - m - w;
    if (left !== undefined) {
      top = Math.min(Math.max(a.top - 12, topMin), vh - h - m);
    } else {
      // Pas de place à côté : dessous (ou dessus) de l'emplacement.
      left = Math.min(Math.max(m, a.left + a.width / 2 - w / 2), vw - w - m);
      top = a.bottom + m + h <= vh - m ? a.bottom + m : Math.max(topMin, a.top - m - h);
    }
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(Math.max(m, top))}px`;
  }

  pop.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn || !state || !popTarget) return;
    const action = btn.dataset.action;
    if (action === 'pop-close') closeSlotPop({ restoreFocus: true });
    else if (action === 'pop-refresh') {
      const table = state.tables.find((x) => x.no === popTarget.tableNo);
      const cur = table && table.slots[popTarget.slot];
      popTarget.matchId = cur ? cur.matchId : null;
      renderSlotPop();
    } else if (action === 'seated') markSeated(Number(btn.dataset.match));
    else if (action === 'table-toggle') {
      const tableNo = Number(btn.dataset.table);
      const enabled = btn.dataset.enabled === '1';
      run('setTableEnabled', { tableNo, enabled }, {
        button: btn,
        success: enabled ? `Table ${tableNo} remise en service.` : `Table ${tableNo} hors service.`,
      }).catch(() => {});
    } else {
      await handleSlotAction(btn);
    }
  });

  window.addEventListener('resize', () => {
    positionSlotPop();
    positionRowMenu();
    if (!searchPop.hidden) positionSearch();
  });
  document.addEventListener('scroll', () => {
    positionSlotPop();
    closeRowMenu();
  }, true);

  // Clic en dehors : referme le panneau, les menus et la recherche.
  document.addEventListener('pointerdown', (e) => {
    const t = e.target;
    if (t.closest('dialog') || t.closest('.toast')) return;
    if (popTarget && !pop.contains(t) && !t.closest('.slot') && !t.closest('.call-place')) closeSlotPop();
    if (rowMenuFor && !rowMenu.contains(t) && !t.closest('[data-action="row-menu"], [data-action="call-menu"]')) closeRowMenu();
    if (!moreMenu.hidden && !moreMenu.contains(t) && !moreBtn.contains(t)) closeMoreMenu();
    if (!searchPop.hidden && !searchPop.contains(t) && !searchTrigger.contains(t)) closeSearch();
  });

  // ================================================================ file d'attente

  const queueList = $('#queue-list');

  function queueEntryHtml(e, isNext) {
    const isSolo = e.kind === 'solo';
    const names = e.players
      .map((p) => `<span class="q-name" title="${esc(contactText(p))}">${esc(fullName(p))}</span>`)
      .join('<span class="q-amp">&amp;</span>');
    const tags = [];
    if (isNext) tags.push('<span class="tag tag-next">Prochain</span>');
    if (!isSolo) tags.push('<span class="tag tag-pair">Paire</span>');
    else if (e.vsAnimator) tags.push('<span class="tag tag-animator">Seul · prêt vs animateur</span>');
    else tags.push('<span class="tag tag-solo">Seul · cherche un partenaire</span>');
    const eta = etaText(e.entryId);
    const status = e.ready ? (eta ? `<strong>${esc(eta)}</strong>` : '') : 'les paires suivantes passent devant';
    let main = '';
    if (isSolo) {
      main = e.vsAnimator
        ? `<div class="q-main-action"><button type="button" class="btn btn-sm btn-outline" data-action="cancel-anyway" data-entry="${e.entryId}" data-focus="cancel-${e.entryId}">Annuler animateur</button></div>`
        : `<div class="q-main-action"><button type="button" class="btn btn-sm btn-warn" data-action="place-anyway" data-entry="${e.entryId}" data-focus="anyway-${e.entryId}">Placer quand même (vs animateur)</button></div>`;
    }
    const classes = ['q-row'];
    if (isNext) classes.push('is-next');
    if (isSolo && !e.vsAnimator) classes.push('is-solo');
    return `<li class="${classes.join(' ')}" data-entry="${e.entryId}">
      <span class="q-rank" title="Rang dans la file">${e.rank}</span>
      <div class="q-main">
        <div class="q-names">${names}</div>
        <div class="q-meta">${tags.join('')}${status ? `<span>${status}</span>` : ''}<span>attend <span data-since="${e.createdAt}"></span></span></div>
        ${main}
      </div>
      <div class="q-actions">
        <button type="button" class="btn btn-ghost btn-icon btn-sm q-more" data-action="row-menu" data-entry="${e.entryId}" data-focus="more-${e.entryId}"
          aria-haspopup="menu" aria-expanded="false" aria-label="${esc(`Autres actions : ${joinNames(e.players.map(fullName))}`)}">${ICON('more')}</button>
      </div>
    </li>`;
  }

  function renderQueue() {
    const q = state.queue;
    const paused = isPaused();
    const playersWaiting = q.reduce((n, e) => n + e.players.length, 0);
    $('#queue-summary').textContent = q.length
      ? `${plural(q.length, 'entrée', 'entrées')} · ${plural(playersWaiting, 'joueur', 'joueurs')}`
      : '';
    $('#tab-queue-count').textContent = String(playersWaiting);
    $('#queue-paused').hidden = !paused;
    const nextId = paused ? undefined : (q.find((e) => e.ready) || {}).entryId;
    const key = JSON.stringify([q, paused, nextId, [...etas.entries()].map(([k, v]) => [k, Math.floor(v / MIN)])]);
    patch(queueList, key, () =>
      q.length ? q.map((e) => queueEntryHtml(e, e.entryId === nextId)).join('') : '<li class="empty">File d\'attente vide.</li>',
    );
    if (rowMenuFor && rowMenuFor.entryId !== undefined && !q.some((e) => e.entryId === rowMenuFor.entryId)) closeRowMenu();
  }

  queueList.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn || !state) return;
    if (btn.dataset.action === 'row-menu') openRowMenu(btn);
    else handleCommonAction(btn);
  });

  // ---------------------------------------------------------------- menu « ⋯ » d'une ligne / d'un appel

  const rowMenu = $('#row-menu');
  let rowMenuFor = null; // { entryId | matchId, anchor }

  // Bouton d'origine du menu (retrouvé si la ligne a été re-rendue entre-temps).
  function rowMenuAnchor() {
    if (!rowMenuFor) return null;
    if (rowMenuFor.anchor.isConnected) return rowMenuFor.anchor;
    const fresh = rowMenuFor.matchId !== undefined
      ? callsList.querySelector(`[data-action="call-menu"][data-match="${rowMenuFor.matchId}"]`)
      : queueList.querySelector(`[data-action="row-menu"][data-entry="${rowMenuFor.entryId}"]`);
    if (fresh) {
      rowMenuFor.anchor = fresh;
      fresh.setAttribute('aria-expanded', 'true');
    }
    return fresh;
  }

  function showRowMenu(btn, html, target) {
    rowMenu.innerHTML = html;
    rowMenu.hidden = false;
    rowMenuFor = { ...target, anchor: btn };
    btn.setAttribute('aria-expanded', 'true');
    positionRowMenu();
    const first = rowMenu.querySelector('.menu-item');
    if (first) first.focus({ preventScroll: true });
  }

  function openRowMenu(btn) {
    const entryId = Number(btn.dataset.entry);
    const e = state.queue.find((x) => x.entryId === entryId);
    if (!e) return;
    if (rowMenuFor && rowMenuFor.entryId === entryId) {
      closeRowMenu(true);
      return;
    }
    closeRowMenu();
    const items = [];
    e.players.forEach((p, i) => {
      if (i > 0) items.push('<div class="menu-sep" role="separator"></div>');
      items.push(`<div class="menu-label">${esc(fullName(p))}</div>`);
      items.push(`<button type="button" class="menu-item" role="menuitem" data-action="edit" data-participant="${p.id}">Modifier<small>faute de saisie</small></button>`);
      items.push(`<button type="button" class="menu-item is-danger" role="menuitem" data-action="remove" data-participant="${p.id}">Retirer de la file<small>absent à l'appel</small></button>`);
    });
    if (e.kind === 'solo') {
      items.push('<div class="menu-sep" role="separator"></div>');
      items.push(e.vsAnimator
        ? `<button type="button" class="menu-item" role="menuitem" data-action="cancel-anyway" data-entry="${e.entryId}">Annuler animateur<small>attendre un partenaire</small></button>`
        : `<button type="button" class="menu-item" role="menuitem" data-action="place-anyway" data-entry="${e.entryId}">Placer quand même<small>vs animateur</small></button>`);
    }
    showRowMenu(btn, items.join(''), { entryId });
  }

  // Sous l'ancre (ou au-dessus s'il n'y a pas la place), jamais sur la barre du haut.
  function positionRowMenu() {
    if (!rowMenuFor) return;
    const anchor = rowMenuAnchor();
    if (!anchor) {
      closeRowMenu();
      return;
    }
    const a = anchor.getBoundingClientRect();
    const w = rowMenu.offsetWidth;
    const h = rowMenu.offsetHeight;
    const topMin = $('#top-sticky').getBoundingClientRect().bottom + 6;
    const left = Math.min(Math.max(8, a.right - w), window.innerWidth - w - 8);
    const top = a.bottom + 6 + h <= window.innerHeight - 8 ? a.bottom + 6 : Math.max(topMin, a.top - 6 - h);
    rowMenu.style.left = `${Math.round(left)}px`;
    rowMenu.style.top = `${Math.round(top)}px`;
  }

  function closeRowMenu(restoreFocus = false) {
    if (!rowMenuFor) return;
    const current = rowMenuAnchor();
    rowMenuFor = null;
    rowMenu.hidden = true;
    rowMenu.innerHTML = '';
    if (current) {
      current.setAttribute('aria-expanded', 'false');
      if (restoreFocus) current.focus({ preventScroll: true });
    }
  }

  rowMenu.addEventListener('click', (e) => {
    const item = e.target.closest('button[data-action]');
    if (!item || !state) return;
    closeRowMenu(true);
    handleCommonAction(item);
  });
  rowMenu.addEventListener('keydown', (e) => menuKeys(rowMenu, e));

  // Actions partagées par la file, les résultats de recherche, le résultat d'inscription et les goodies.
  async function handleCommonAction(btn) {
    const action = btn.dataset.action;
    const participantId = Number(btn.dataset.participant);
    const entryId = Number(btn.dataset.entry);

    if (action === 'edit') {
      const p = findParticipant(participantId);
      if (p) openEdit(p);
    } else if (action === 'noshow') {
      const found = findMatch(Number(btn.dataset.match));
      if (!found) toast('Cette partie est déjà terminée.', 'error');
      else await declareNoShow(participantId, found, null);
    } else if (action === 'open-slot') {
      openCallSlot(Number(btn.dataset.table), btn.dataset.slot);
    } else if (action === 'remove') {
      await removePlayer(participantId, btn);
    } else if (action === 'place-anyway') {
      const entry = state.queue.find((x) => x.entryId === entryId);
      const name = entry ? shortName(entry.players[0]) : 'Le joueur';
      run('placeAnyway', { entryId }, { button: btn })
        .then((r) => {
          if (r.placed) {
            ownMatches.add(r.matchId);
            addCall(r.matchId); // à annoncer (et prévenir un animateur), comme un placement automatique
            renderCalls();
            renderTables();
            toast(`${name} → Table ${r.tableNo}, emplacement ${r.slot} (contre un animateur) : voir « À appeler ».`);
          } else if (isPaused()) toast(`${name} jouera contre un animateur, mais pas avant la réouverture du stand.`);
          else toast(`${name} jouera contre un animateur dès qu'un emplacement se libère.`);
        })
        .catch(() => {});
    } else if (action === 'cancel-anyway') {
      run('cancelPlaceAnyway', { entryId }, { button: btn, success: 'Le joueur seul attend de nouveau un partenaire.' }).catch(
        () => {},
      );
    } else if (action === 'goodies-give' || action === 'goodies-undo') {
      const given = action === 'goodies-give';
      const p = findParticipant(participantId);
      const name = p ? fullName(p) : 'Joueur';
      run('giveGoodies', { participantId, given }, {
        button: btn,
        quiet: true,
        success: given ? `Goodies remis à ${name}.` : `Remise des goodies annulée pour ${name}.`,
      }).catch((err) => {
        // Carte promo déjà remise (à la boutique ou sur un autre poste) : le serveur refuse une
        // seconde remise ; l'état diffusé fait passer la ligne dans « Déjà remis ».
        if (err.code === 'already_given') {
          const msg = String(err.message || 'Carte promo déjà remise.');
          toast(`${name} : ${msg.charAt(0).toLowerCase()}${msg.slice(1)} Ne pas en remettre une autre.`, 'info', 8000);
        } else {
          toast(err.message || 'Erreur inconnue.', 'error');
        }
      });
    }
  }

  async function removePlayer(participantId, btn) {
    const loc = where.get(participantId);
    if (!loc || loc.type !== 'queue') {
      toast("Seul un joueur en file d'attente peut être retiré.", 'error');
      return;
    }
    const p = loc.player;
    const partner = loc.entry.players.find((x) => x.id !== participantId);
    const ok = await confirmDialog({
      title: `Retirer ${fullName(p)} ?`,
      html: `<p class="confirm-text"><strong>${esc(fullName(p))}</strong> est retiré(e) de la file (absent(e) à l'appel).</p>
        <p>Il/elle pourra se réinscrire plus tard avec ${hasEmail(p) ? 'le même email et le même billet' : 'le même billet'}.</p>
        ${partner ? `<p class="confirm-note">${esc(fullName(partner))} redevient joueur seul, à la même place dans la file.</p>` : ''}`,
      ok: 'Retirer de la file',
      tone: 'danger',
    });
    if (!ok) return;
    run('removeParticipant', { participantId }, { button: btn, success: `${fullName(p)} retiré(e) de la file.` }).catch(
      () => {},
    );
  }

  // ================================================================ 03 · goodies

  const goodiesList = $('#goodies-list');
  let givenOpen = false;

  function goodieRow(g) {
    const given = !!g.goodiesGivenAt;
    const meta = `Table ${g.tableNo} · ${g.slot} · fini à ${clock(g.endedAt)}${given ? ` · remis à ${clock(g.goodiesGivenAt)}` : ''}`;
    const button = given
      ? `<button type="button" class="btn btn-sm btn-ghost" data-action="goodies-undo" data-participant="${g.id}" data-focus="gundo-${g.id}">Annuler</button>`
      : `<button type="button" class="btn btn-dark" data-action="goodies-give" data-participant="${g.id}" data-focus="ggive-${g.id}"
          aria-label="${esc(`Goodies remis à ${fullName(g)}`)}">${ICON('check')}Remis</button>`;
    return `<li class="goodie${given ? ' is-given' : ''}">
      <span class="goodie-icon">${ICON(given ? 'check' : 'gift')}</span>
      <div class="goodie-main">
        <span class="goodie-name">${esc(fullName(g))}</span>
        <span class="goodie-meta">${meta}</span>
      </div>
      ${button}
    </li>`;
  }

  function renderGoodies() {
    const list = state.goodies || [];
    const pendingList = list.filter((g) => !g.goodiesGivenAt);
    const givenList = list.filter((g) => g.goodiesGivenAt);
    const pending = pendingList.length;
    const badge = $('#goodies-count');
    badge.textContent = String(pending);
    badge.classList.toggle('is-pending', pending > 0);
    const tabCount = $('#tab-goodies-count');
    tabCount.textContent = String(pending);
    tabCount.classList.toggle('is-pending', pending > 0);
    const key = JSON.stringify(list.map((g) => [g.id, g.firstName, g.lastName, g.goodiesGivenAt, g.tableNo, g.slot, g.endedAt]));
    patch(goodiesList, key, () => {
      if (!list.length) return '<li class="empty">Aucune partie terminée aujourd\'hui.</li>';
      const rows = pending
        ? pendingList.map(goodieRow).join('')
        : '<li class="empty">Tous les goodies du jour ont été remis.</li>';
      const given = givenList.length
        ? `<li><details class="goodies-given"${givenOpen ? ' open' : ''}>
            <summary>Déjà remis (${givenList.length})</summary>
            <ul>${givenList.map(goodieRow).join('')}</ul>
          </details></li>`
        : '';
      return rows + given;
    });
  }

  goodiesList.addEventListener('toggle', (e) => {
    if (e.target.matches('details.goodies-given')) givenOpen = e.target.open;
  }, true);

  goodiesList.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (btn && state) handleCommonAction(btn);
  });

  // Statistiques de la barre : un clic mène au panneau correspondant (onglet sur tablette).
  const GOTO = {
    queue: { panel: '#panel-queue', focus: '.q-row button' },
    plan: { panel: '#panel-tables', focus: '.slot.is-busy' },
    goodies: { panel: '#panel-goodies', focus: '[data-action="goodies-give"]' },
  };
  for (const btn of $$('.stats [data-goto]')) {
    btn.addEventListener('click', () => {
      const target = GOTO[btn.dataset.goto];
      setTab(btn.dataset.goto);
      const panel = $(target.panel);
      panel.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
      panel.classList.remove('is-flash');
      void panel.offsetWidth;
      panel.classList.add('is-flash');
      setTimeout(() => panel.classList.remove('is-flash'), 1400);
      const first = $(target.focus, panel);
      if (first) first.focus({ preventScroll: true });
    });
  }

  // ================================================================ formulaire d'inscription

  const form = $('#register-form');
  const submitBtn = $('#register-submit');
  const formError = $('#form-error');
  const playerSets = [$('#player-0'), $('#player-1')];
  const inputOf = (i, f) => $(`#p${i}-${f}`);
  const msgOf = (i, f) => $(`#p${i}-${f}-msg`);

  const fieldErrors = {};
  const fieldWarnings = {};
  const pairWarnings = {};
  let submitting = false;

  const mode = () => Number(form.querySelector('input[name="mode"]:checked').value);

  function applyMode() {
    const two = mode() === 2;
    playerSets[1].hidden = !two;
    playerSets[1].disabled = !two;
    submitBtn.textContent = two ? 'Inscrire les 2 joueurs' : 'Inscrire le joueur';
    updatePairWarnings();
  }

  function setMode(n, focus = true) {
    const radio = form.querySelector(`input[name="mode"][value="${n}"]`);
    if (!radio) return;
    radio.checked = true;
    applyMode();
    if (focus) inputOf(0, 'firstName').focus();
  }

  function refreshField(i, f) {
    const k = `${i}-${f}`;
    const input = inputOf(i, f);
    const msg = msgOf(i, f);
    const error = fieldErrors[k];
    const warning = fieldWarnings[k] || pairWarnings[k];
    input.classList.toggle('is-invalid', !!error);
    input.classList.toggle('is-warning', !error && !!warning);
    input.setAttribute('aria-invalid', error ? 'true' : 'false');
    msg.textContent = error || warning || '';
    msg.className = `field-msg${error ? ' is-error' : warning ? ' is-warning' : ''}`;
    if (error || warning) input.setAttribute('aria-describedby', msg.id);
    else input.removeAttribute('aria-describedby');
  }

  function setFieldError(i, f, message) {
    fieldErrors[`${i}-${f}`] = message || null;
    refreshField(i, f);
  }

  function setFormError(message) {
    formError.textContent = message || '';
    formError.hidden = !message;
  }

  function conflictText(c) {
    return `Déjà utilisé par ${c.name} – jour ${c.dayNumber} – ${c.statusLabel}`;
  }

  // Vérification en direct des doublons (email / billet) côté serveur.
  const checkSeq = [0, 0];
  async function liveCheck(i) {
    const email = inputOf(i, 'email').value.trim();
    const ticket = inputOf(i, 'ticket').value.trim();
    const seq = ++checkSeq[i];
    let res = { email: null, ticket: null };
    if ((email || ticket) && client) {
      // Email facultatif : il n'est vérifié que s'il est saisi.
      const query = {};
      if (email) query.email = email;
      if (ticket) query.ticket = ticket;
      try {
        res = await client.action('check', query);
      } catch {
        return;
      }
    }
    if (seq !== checkSeq[i]) return;
    fieldWarnings[`${i}-email`] = res.email ? conflictText(res.email) : null;
    fieldWarnings[`${i}-ticket`] = res.ticket ? conflictText(res.ticket) : null;
    refreshField(i, 'email');
    refreshField(i, 'ticket');
  }
  const scheduleCheck = [debounce(() => liveCheck(0), 300), debounce(() => liveCheck(1), 300)];

  function updatePairWarnings() {
    const two = mode() === 2;
    const sameEmail = two && normEmail(inputOf(0, 'email').value) && normEmail(inputOf(0, 'email').value) === normEmail(inputOf(1, 'email').value);
    const sameTicket = two && normTicket(inputOf(0, 'ticket').value) && normTicket(inputOf(0, 'ticket').value) === normTicket(inputOf(1, 'ticket').value);
    pairWarnings['1-email'] = sameEmail ? 'Même email que le joueur 1' : null;
    pairWarnings['1-ticket'] = sameTicket ? 'Même numéro de billet que le joueur 1' : null;
    refreshField(1, 'email');
    refreshField(1, 'ticket');
  }

  form.addEventListener('input', (e) => {
    const input = e.target;
    if (input.name === 'mode') return;
    const i = Number(input.dataset.index);
    const f = input.dataset.field;
    if (!f) return;
    if (fieldErrors[`${i}-${f}`]) setFieldError(i, f, null);
    if (!Object.values(fieldErrors).some(Boolean)) setFormError('');
    if (f === 'email' || f === 'ticket') {
      fieldWarnings[`${i}-${f}`] = null;
      refreshField(i, f);
      scheduleCheck[i]();
      updatePairWarnings();
    }
  });

  form.addEventListener('change', (e) => {
    if (e.target.name === 'mode') applyMode();
  });

  function readPlayers() {
    return Array.from({ length: mode() }, (_, i) => ({
      firstName: inputOf(i, 'firstName').value,
      lastName: inputOf(i, 'lastName').value,
      email: inputOf(i, 'email').value,
      ticket: inputOf(i, 'ticket').value,
    }));
  }

  function validatePlayers(players) {
    const errors = [];
    players.forEach((p, i) => {
      if (!cleanName(p.firstName)) errors.push([i, 'firstName', 'Le prénom est obligatoire.']);
      if (!cleanName(p.lastName)) errors.push([i, 'lastName', 'Le nom est obligatoire.']);
      // Email facultatif (le visiteur peut refuser) ; s'il est saisi, il doit être valide.
      if (p.email.trim() && !EMAIL_RE.test(normEmail(p.email))) errors.push([i, 'email', 'Email non valide (ou laissez vide).']);
      if (!normTicket(p.ticket)) errors.push([i, 'ticket', 'Le numéro de billet est obligatoire.']);
    });
    if (players.length === 2 && !errors.length) {
      const email0 = normEmail(players[0].email);
      if (email0 && email0 === normEmail(players[1].email)) errors.push([1, 'email', 'Les deux joueurs ont le même email.']);
      if (normTicket(players[0].ticket) === normTicket(players[1].ticket)) {
        errors.push([1, 'ticket', 'Les deux joueurs ont le même numéro de billet.']);
      }
    }
    return errors;
  }

  function clearFormMessages() {
    for (const k of Object.keys(fieldErrors)) fieldErrors[k] = null;
    for (const k of Object.keys(fieldWarnings)) fieldWarnings[k] = null;
    for (const k of Object.keys(pairWarnings)) pairWarnings[k] = null;
    for (let i = 0; i < 2; i++) for (const f of FIELDS) refreshField(i, f);
    setFormError('');
  }

  function resetForm({ focus = true } = {}) {
    checkSeq[0]++;
    checkSeq[1]++;
    scheduleCheck.forEach((c) => c.cancel());
    for (let i = 0; i < 2; i++) for (const f of FIELDS) inputOf(i, f).value = '';
    clearFormMessages();
    if (focus) inputOf(0, 'firstName').focus();
  }

  $('#register-clear').addEventListener('click', () => resetForm());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    const players = readPlayers();
    for (const k of Object.keys(fieldErrors)) fieldErrors[k] = null;
    for (let i = 0; i < 2; i++) for (const f of FIELDS) refreshField(i, f);
    setFormError('');

    const errors = validatePlayers(players);
    if (errors.length) {
      for (const [i, f, m] of errors) setFieldError(i, f, m);
      if (errors.length > 1) setFormError('Complétez les champs en rouge.');
      inputOf(errors[0][0], errors[0][1]).focus();
      return;
    }

    submitting = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Inscription…';
    try {
      const result = await client.action('register', { players });
      for (const id of result.participantIds || []) ownPlayers.add(id);
      if (result.matchId) ownMatches.add(result.matchId);
      const reg = {
        ids: result.participantIds || [],
        players: players.map((p) => ({ firstName: cleanName(p.firstName), lastName: cleanName(p.lastName) })),
        result,
        seq: stateSeq,
        at: Date.now(),
      };
      lastRegistration = reg;
      renderLastRegistration();
      resetForm();
      revealRegResult();
    } catch (err) {
      const d = err.details || {};
      const message = err.message || "Erreur lors de l'inscription.";
      if (d.field && FIELDS.includes(d.field)) {
        const i = Math.min(Number(d.index) || 0, mode() - 1);
        setFieldError(i, d.field, message);
        inputOf(i, d.field).focus();
        inputOf(i, d.field).select?.();
        toast(`Inscription refusée : ${message}`, 'error');
      } else {
        setFormError(message);
        toast(message, 'error');
      }
    } finally {
      submitting = false;
      submitBtn.disabled = false;
      applyMode();
    }
  });

  // ---------------------------------------------------------------- attente estimée (nouvelle inscription)

  const waitPill = $('#wait-pill');
  let waitKey = '';

  // Même calcul que l'écran TV (LobbyClient.estimate) : l'hôtesse annonce la même attente que la TV.
  function renderWaitPill() {
    if (!state) return;
    let html = '';
    let free = false;
    if (!isPaused()) {
      const t = now();
      const est = LC.estimate(state, t);
      if (est.newcomerAt === null) html = 'Aucune table en service';
      else if (freeSlotCount() > 0 && est.newcomerAt - t < MIN) {
        html = `<b>${plural(freeSlotCount(), 'place libre', 'places libres')}</b><span class="wait-word"> maintenant</span>`;
        free = true;
      } else html = `${ICON('clock')}<span class="wait-word">Attente </span><b>~${esc(waitLabel(est.newcomerAt - t))}</b> · vers ${esc(clock(est.newcomerAt))}`;
    }
    const key = `${html}|${free}`;
    if (key === waitKey) return;
    waitKey = key;
    waitPill.hidden = !html;
    waitPill.innerHTML = html;
    waitPill.classList.toggle('is-free', free);
  }

  // ---------------------------------------------------------------- résultat de la dernière inscription

  const regResult = $('#reg-result');

  function describeRegistration(reg) {
    const who = joinNames(reg.players.map(shortName));
    const ids = new Set(reg.ids);
    const loc = state && stateSeq > reg.seq ? reg.ids.map((id) => where.get(id)).find(Boolean) : null;
    const tableInfo = (tableNo, slot, detail) => ({
      tone: 'table',
      who,
      where: `→ Table ${tableNo} · ${slot}`,
      detail,
    });

    if (loc && loc.type === 'table') {
      const others = loc.match.players.filter((p) => !ids.has(p.id)).map(shortName);
      return tableInfo(
        loc.table.no,
        loc.slot,
        others.length
          ? `Associé à ${joinNames(others)} (joueur seul déjà en attente : à appeler).`
          : loc.match.vsAnimator
            ? 'Contre un animateur : prévenez un animateur.'
            : `Emplacement ${loc.slot === 'A' ? 'A, moitié gauche' : 'B, moitié droite'} de la table · le compte à rebours a démarré.`,
      );
    }
    const paused = isPaused();
    const pausedText = 'Stand fermé : ne sera pas placé tant que le stand est fermé.';
    if (loc && loc.type === 'queue') {
      const e = loc.entry;
      const others = e.players.filter((p) => !ids.has(p.id)).map(shortName);
      const eta = etaText(e.entryId);
      if (e.kind === 'solo' && !e.vsAnimator) {
        return {
          tone: paused ? 'paused' : 'solo',
          who,
          where: "Joueur seul : en attente d'un partenaire",
          detail: paused
            ? `Rang ${e.rank} · ${pausedText}`
            : `Rang ${e.rank} · sera associé au prochain joueur seul. Sinon : « Placer quand même » (contre un animateur).`,
          entryId: e.entryId,
          canPlaceAnyway: true,
        };
      }
      return {
        tone: paused ? 'paused' : 'queue',
        who,
        where: `En file d'attente · rang ${e.rank}`,
        detail: [
          others.length ? `Associé à ${joinNames(others)}` : '',
          e.kind === 'solo' ? 'jouera contre un animateur' : '',
          paused ? pausedText : eta || '',
        ]
          .filter(Boolean)
          .join(' · ')
          .replace(/^./, (c) => c.toUpperCase()),
        entryId: e.entryId,
        canCancelAnyway: e.kind === 'solo',
      };
    }
    if (!loc && stateSeq <= reg.seq) {
      const r = reg.result || {};
      if (r.status === 'playing') return tableInfo(r.tableNo, r.slot, '');
      if (r.status === 'waiting') {
        return {
          tone: paused ? 'paused' : 'queue',
          who,
          where: `En file d'attente · rang ${r.rank}`,
          detail: paused ? pausedText : '',
        };
      }
    }
    return {
      tone: 'muted',
      who,
      where: "Plus en file d'attente ni à une table",
      detail: 'Voir la recherche pour son statut.',
    };
  }

  function renderLastRegistration() {
    if (!lastRegistration) {
      regResult.hidden = true;
      return;
    }
    const info = describeRegistration(lastRegistration);
    let actions = '';
    if (info.canPlaceAnyway) {
      actions = `<button type="button" class="btn btn-sm btn-warn" data-action="place-anyway" data-entry="${info.entryId}" data-focus="r-anyway">Placer quand même (vs animateur)</button>`;
    } else if (info.canCancelAnyway) {
      actions = `<button type="button" class="btn btn-sm btn-outline" data-action="cancel-anyway" data-entry="${info.entryId}" data-focus="r-cancel">Annuler animateur</button>`;
    }
    const fresh = Date.now() - lastRegistration.at < 90 * 1000;
    const inUse = formInUse();
    // Version compacte (> 90 s) seulement quand le formulaire est au repos : jamais pendant la saisie.
    // Une fois compacté, le cadre le reste (sinon il regrandirait au premier caractère tapé).
    if (!fresh && !inUse) lastRegistration.compact = true;
    const compact = !!lastRegistration.compact;
    const label = fresh ? 'Inscription réussie · à annoncer' : compact ? `Dernière inscription · ${info.who}` : 'Dernière inscription';
    const key = JSON.stringify([lastRegistration.at, label, info.tone, info.who, info.where, info.detail, actions]);
    regResult.hidden = false;
    regResult.dataset.tone = info.tone;
    regResult.classList.toggle('is-old', compact);
    const changed = patch(regResult, key, () => `
      <div class="reg-result-label">${esc(label)}</div>
      <div class="reg-result-who">${esc(info.who)}</div>
      <div class="reg-result-where">${info.where.startsWith('→ ') ? `${ICON('arrow', 'ic ic-arrow')}${esc(info.where.slice(2))}` : esc(info.where)}</div>
      ${info.detail ? `<div class="reg-result-detail">${esc(info.detail)}</div>` : ''}
      ${actions ? `<div class="reg-result-actions">${actions}</div>` : ''}`);
    if (changed) {
      regResult.style.animation = 'none';
      void regResult.offsetWidth;
      regResult.style.animation = '';
      if (Date.now() - lastRegistration.at < REVEAL_REG_MS && form.contains(document.activeElement)) revealRegResult();
    }
    lockRegResult(inUse);
  }

  // Le cadre de résultat est AU-DESSUS du formulaire : pendant la saisie, il ne doit jamais déplacer
  // les champs. Tant que le formulaire est utilisé, sa hauteur est verrouillée (il ne rétrécit pas,
  // la version compacte attend le repos) ; s'il grandit (paire placée entre-temps), la colonne
  // défile d'autant, avec au besoin une cale en bas pour pouvoir défiler. Au repos, tout est relâché.
  const REG_IDLE_MS = 20 * 1000;
  let regTouchedAt = 0;
  let regLock = null; // { at, h }
  const regSpacer = document.createElement('div');
  regSpacer.className = 'reg-spacer';
  regSpacer.setAttribute('aria-hidden', 'true');
  colLeft.append(regSpacer);
  for (const type of ['pointerdown', 'keydown', 'input', 'focusin']) {
    colLeft.addEventListener(type, () => { regTouchedAt = Date.now(); }, true);
  }

  // Formulaire en cours d'utilisation : un champ rempli, ou le focus dedans avec une action récente.
  function formInUse() {
    for (let i = 0; i < mode(); i++) for (const f of FIELDS) if (inputOf(i, f).value.trim()) return true;
    return colLeft.contains(document.activeElement) && Date.now() - regTouchedAt < REG_IDLE_MS;
  }

  function releaseRegLock() {
    if (!regLock) return;
    regLock = null;
    regResult.style.minHeight = '';
    regSpacer.style.height = '';
  }

  function lockRegResult(inUse) {
    if (!inUse || regResult.hidden || !lastRegistration) {
      releaseRegLock();
      return;
    }
    // Juste après l'inscription, le cadre suit son contenu (l'hôtesse le regarde, revealRegResult).
    const settling = Date.now() - lastRegistration.at < REVEAL_REG_MS;
    if (!regLock || regLock.at !== lastRegistration.at || settling) {
      regResult.style.minHeight = '';
      regSpacer.style.height = '';
      regLock = { at: lastRegistration.at, h: regResult.offsetHeight };
      if (!settling) regResult.style.minHeight = `${regLock.h}px`;
      return;
    }
    const h = regResult.offsetHeight; // ≥ regLock.h (min-height)
    if (h > regLock.h) {
      const target = colLeft.scrollTop + (h - regLock.h);
      regLock.h = h;
      // Cale juste suffisante pour pouvoir défiler jusqu'à `target` (le vide éventuel sous le
      // formulaire absorbe d'abord une partie de la cale : deuxième ajustement).
      const short = () => target - (colLeft.scrollHeight - colLeft.clientHeight);
      regSpacer.style.height = '0px';
      let spacer = Math.max(0, short());
      regSpacer.style.height = `${spacer}px`;
      if (short() > 0) spacer += short();
      regSpacer.style.height = `${Math.ceil(spacer)}px`;
      colLeft.scrollTo({ top: target, behavior: 'instant' });
    }
    regResult.style.minHeight = `${regLock.h}px`;
  }

  function revealRegResult() {
    revealInColumn(regResult, { keep: inputOf(0, 'firstName'), must: $('.reg-result-where', regResult) });
  }

  regResult.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (btn && state) handleCommonAction(btn);
  });

  // ================================================================ recherche (panneau Ctrl+K, ⌘K, « / », Alt+R)

  const searchTrigger = $('#search-trigger');
  const searchPop = $('#search-pop');
  const searchInput = $('#search-input');
  const searchBox = $('#search-results');
  let searchSeq = 0;
  let searchReturnFocus = null;

  function positionSearch() {
    const top = $('#top-sticky').getBoundingClientRect().bottom + 8;
    const t = searchTrigger.getBoundingClientRect();
    const w = searchPop.offsetWidth;
    const left = Math.min(Math.max(16, t.right - w), window.innerWidth - w - 16);
    searchPop.style.top = `${Math.round(top)}px`;
    searchPop.style.left = `${Math.round(left)}px`;
    searchPop.style.right = 'auto';
    searchPop.style.maxHeight = `${Math.round(window.innerHeight - top - 16)}px`;
  }

  function openSearch() {
    closeSlotPop();
    closeRowMenu();
    closeMoreMenu();
    if (searchPop.hidden) {
      const active = document.activeElement;
      searchReturnFocus = active && active !== document.body && !searchPop.contains(active) ? active : null;
    }
    searchPop.hidden = false;
    searchTrigger.setAttribute('aria-expanded', 'true');
    positionSearch();
    searchInput.focus({ preventScroll: true });
    searchInput.select();
  }

  function closeSearch({ restoreFocus = false } = {}) {
    if (searchPop.hidden) return;
    searchPop.hidden = true;
    searchTrigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) {
      const target = searchReturnFocus && searchReturnFocus.isConnected ? searchReturnFocus : searchTrigger;
      target.focus({ preventScroll: true });
    }
    searchReturnFocus = null;
  }

  searchTrigger.addEventListener('click', () => (searchPop.hidden ? openSearch() : closeSearch()));
  $('#search-close').addEventListener('click', () => closeSearch({ restoreFocus: true }));

  async function doSearch() {
    const q = searchInput.value.trim();
    searchQuery = q;
    lastSearchSeq = stateSeq;
    const seq = ++searchSeq;
    if (q.length < 2) {
      searchResults = null;
      renderSearchResults();
      return;
    }
    try {
      const results = await client.action('search', { query: q });
      if (seq !== searchSeq) return;
      searchResults = results;
    } catch (err) {
      if (seq !== searchSeq) return;
      searchResults = [];
      toast(err.message || 'Recherche impossible.', 'error');
    }
    renderSearchResults();
  }
  const scheduleSearch = debounce(doSearch, 250);
  const refreshSearch = debounce(() => {
    if (searchQuery.length >= 2) doSearch();
  }, 400);

  searchInput.addEventListener('input', () => scheduleSearch());
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (searchInput.value) {
        searchInput.value = '';
        doSearch();
      } else {
        closeSearch({ restoreFocus: true });
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      scheduleSearch.cancel();
      doSearch();
    }
  });

  function resultWhereHtml(p) {
    const loc = where.get(p.id);
    if (loc && loc.type === 'table') {
      return `En jeu : Table ${loc.table.no} · ${loc.slot} — reste <span data-ends-at="${loc.match.endsAt}" class="countdown-inline"></span>`;
    }
    if (loc && loc.type === 'queue') {
      const e = loc.entry;
      const kind = e.kind === 'pair' ? 'en paire' : e.vsAnimator ? 'seul, prêt contre un animateur' : 'seul, cherche un partenaire';
      return `File d'attente : rang ${e.rank} (${kind})`;
    }
    switch (p.status) {
      case 'completed':
        return p.goodiesGivenAt ? `Partie terminée · goodies remis à ${clock(p.goodiesGivenAt)}` : 'Partie terminée · <strong>goodies à remettre</strong>';
      case 'left_early':
        return 'Parti avant la fin (pas de goodies)';
      case 'removed':
        return 'Retiré (absent) · peut se réinscrire';
      case 'expired':
        return 'En attente lors de la remise à zéro · peut se réinscrire';
      case 'interrupted':
        return 'Partie interrompue par la nouvelle journée · peut se réinscrire';
      default:
        return '';
    }
  }

  function liveStatus(p) {
    const loc = where.get(p.id);
    if (loc && loc.type === 'table') return ['playing', 'en train de jouer'];
    if (loc && loc.type === 'queue') return ['waiting', "en file d'attente"];
    return [p.status, p.statusLabel || p.status];
  }

  function searchResultHtml(p) {
    const [status, label] = liveStatus(p);
    const today = state && p.dayNumber === state.day.number;
    const created = today ? `inscrit à ${clock(p.createdAt)}` : `inscrit le ${dateFmt.format(new Date(p.createdAt))}`;
    const actions = [
      `<button type="button" class="btn btn-sm btn-outline" data-action="edit" data-participant="${p.id}" data-focus="s-edit-${p.id}">Modifier</button>`,
    ];
    if (status === 'waiting') {
      actions.push(
        `<button type="button" class="btn btn-sm btn-danger-outline" data-action="remove" data-participant="${p.id}" data-focus="s-remove-${p.id}">Retirer</button>`,
      );
    }
    if (status === 'completed') {
      actions.push(
        p.goodiesGivenAt
          ? `<button type="button" class="btn btn-sm btn-ghost" data-action="goodies-undo" data-participant="${p.id}" data-focus="s-gundo-${p.id}">Annuler la remise</button>`
          : `<button type="button" class="btn btn-sm btn-dark" data-action="goodies-give" data-participant="${p.id}" data-focus="s-ggive-${p.id}">${ICON('check')}Goodies remis</button>`,
      );
    }
    return `<article class="result">
      <div class="result-head">
        <span class="result-name">${esc(fullName(p))}</span>
        <span class="pill pill-${esc(status)}">${esc(label)}</span>
      </div>
      <div class="result-meta">${contactHtml(p)} · jour ${p.dayNumber} · ${esc(created)}</div>
      <div class="result-where">${resultWhereHtml(p)}</div>
      <div class="result-actions">${actions.join('')}</div>
    </article>`;
  }

  function renderSearchResults() {
    let key;
    let render;
    if (searchResults === null) {
      key = 'none';
      render = () => '';
    } else if (!searchResults.length) {
      key = `empty:${searchQuery}`;
      render = () => `<p class="empty">Aucun participant trouvé pour « ${esc(searchQuery)} ».</p>`;
    } else {
      const locKey = searchResults.map((p) => {
        const loc = where.get(p.id);
        if (!loc) return null;
        return loc.type === 'table' ? [loc.table.no, loc.slot, loc.match.endsAt] : loc.type === 'queue' ? [loc.entry.rank, loc.entry.kind, loc.entry.vsAnimator] : loc.type;
      });
      key = JSON.stringify([searchResults, locKey, state && state.day.number]);
      render = () => searchResults.map(searchResultHtml).join('');
    }
    patch(searchBox, key, render);
    if (searchResults !== null) refreshSearchIfStale();
  }

  function refreshSearchIfStale() {
    if (lastSearchSeq !== stateSeq) {
      lastSearchSeq = stateSeq;
      refreshSearch();
    }
  }

  searchBox.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (btn && state) handleCommonAction(btn);
  });

  // ================================================================ modale « Modifier »

  const editDialog = $('#edit-dialog');
  const editForm = $('#edit-form');
  const editInput = (f) => $(`#edit-${f}`);
  const editMsg = (f) => $(`#edit-${f}-msg`);
  const editError = $('#edit-error');
  let editingId = null;
  const editErrors = {};
  const editWarnings = {};
  let editCheckSeq = 0;

  function refreshEditField(f) {
    const input = editInput(f);
    const msg = editMsg(f);
    const error = editErrors[f];
    const warning = editWarnings[f];
    input.classList.toggle('is-invalid', !!error);
    input.classList.toggle('is-warning', !error && !!warning);
    msg.textContent = error || warning || '';
    msg.className = `field-msg${error ? ' is-error' : warning ? ' is-warning' : ''}`;
  }

  function openEdit(p) {
    editingId = p.id;
    for (const f of FIELDS) {
      editInput(f).value = p[f] ?? '';
      editErrors[f] = null;
      editWarnings[f] = null;
      refreshEditField(f);
    }
    editError.hidden = true;
    const loc = where.get(p.id);
    const context = loc && loc.type === 'table'
      ? `En jeu à la table ${loc.table.no} · ${loc.slot}.`
      : loc && loc.type === 'queue'
        ? `En file d'attente, rang ${loc.entry.rank}.`
        : p.statusLabel ? `Statut : ${p.statusLabel}.` : '';
    $('#edit-context').textContent = `${fullName(p)}${p.dayNumber ? ` · jour ${p.dayNumber}` : ''}${context ? ` · ${context}` : ''}`;
    openDialog(editDialog, editInput('firstName'));
    editCheck();
  }

  async function editCheck() {
    if (editingId === null) return;
    const seq = ++editCheckSeq;
    let res = { email: null, ticket: null };
    const email = editInput('email').value.trim();
    const ticket = editInput('ticket').value.trim();
    if (email || ticket) {
      // Email facultatif : il n'est vérifié que s'il est saisi.
      const query = { excludeParticipantId: editingId };
      if (email) query.email = email;
      if (ticket) query.ticket = ticket;
      try {
        res = await client.action('check', query);
      } catch {
        return;
      }
    }
    if (seq !== editCheckSeq) return;
    editWarnings.email = res.email ? conflictText(res.email) : null;
    editWarnings.ticket = res.ticket ? conflictText(res.ticket) : null;
    refreshEditField('email');
    refreshEditField('ticket');
  }
  const scheduleEditCheck = debounce(editCheck, 300);

  editForm.addEventListener('input', (e) => {
    const f = e.target.dataset.field;
    if (!f) return;
    editErrors[f] = null;
    if (f === 'email' || f === 'ticket') {
      editWarnings[f] = null;
      scheduleEditCheck();
    }
    refreshEditField(f);
    editError.hidden = true;
  });

  editDialog.addEventListener('close', () => {
    editingId = null;
    editCheckSeq++;
  });

  editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (editingId === null) return;
    const fields = {};
    for (const f of FIELDS) fields[f] = editInput(f).value;
    const errors = validatePlayers([fields]);
    for (const f of FIELDS) {
      editErrors[f] = null;
      refreshEditField(f);
    }
    if (errors.length) {
      for (const [, f, m] of errors) {
        editErrors[f] = m;
        refreshEditField(f);
      }
      editInput(errors[0][1]).focus();
      return;
    }
    const btn = $('#edit-submit');
    btn.disabled = true;
    try {
      await client.action('editParticipant', { participantId: editingId, fields });
      toast(`${cleanName(fields.firstName)} ${cleanName(fields.lastName)} : informations mises à jour.`);
      closeDialog(editDialog);
      refreshSearch();
    } catch (err) {
      const d = err.details || {};
      if (d.field && FIELDS.includes(d.field)) {
        editErrors[d.field] = err.message;
        refreshEditField(d.field);
        editInput(d.field).focus();
      } else {
        editError.textContent = err.message || 'Modification impossible.';
        editError.hidden = false;
      }
    } finally {
      btn.disabled = false;
    }
  });

  // ================================================================ modale « Réglages »

  const settingsDialog = $('#settings-dialog');
  const durationInput = $('#duration-input');
  const durationMsg = $('#duration-msg');
  const togglesBox = $('#tables-toggles');
  const pendingToggles = new Set();

  function buildToggles() {
    for (let no = 1; no <= 9; no++) {
      const label = document.createElement('label');
      label.className = 'toggle';
      label.innerHTML = `<input type="checkbox" role="switch" data-table="${no}" aria-label="Table ${no} en service">
        <span class="toggle-text"><span class="toggle-name">Table ${no}</span><span class="toggle-state"></span></span>
        <span class="switch" aria-hidden="true"></span>`;
      togglesBox.append(label);
    }
  }

  function updateSettingsDialog() {
    if (!settingsDialog.open || !state) return;
    for (const t of state.tables) {
      const input = togglesBox.querySelector(`input[data-table="${t.no}"]`);
      if (!input) continue;
      if (!pendingToggles.has(t.no)) input.checked = t.enabled;
      const label = input.closest('.toggle');
      label.classList.toggle('is-on', input.checked);
      const games = SLOTS.filter((s) => t.slots[s]).length;
      const stateText = t.enabled ? 'En service' : 'Hors service';
      $('.toggle-state', label).textContent = games ? `${stateText} · ${plural(games, 'partie', 'parties')} en cours` : stateText;
    }
  }

  $('#btn-settings').addEventListener('click', () => {
    if (!state) return;
    closeMoreMenu();
    durationInput.value = String(Math.round(state.settings.matchDurationMs / MIN));
    durationMsg.textContent = `Durée actuelle : ${Math.round(state.settings.matchDurationMs / MIN)} min.`;
    durationMsg.className = 'field-msg';
    durationInput.classList.remove('is-invalid');
    openDialog(settingsDialog, durationInput);
    updateSettingsDialog();
  });

  $('#duration-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const minutes = Number(durationInput.value);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 180 || Math.round(minutes) !== minutes) {
      durationInput.classList.add('is-invalid');
      durationMsg.textContent = 'Indiquez un nombre entier de minutes entre 1 et 180.';
      durationMsg.className = 'field-msg is-error';
      durationInput.focus();
      return;
    }
    durationInput.classList.remove('is-invalid');
    try {
      await run('setDuration', { durationMs: minutes * MIN }, {
        button: e.submitter || null,
        success: `Durée des prochaines parties : ${minutes} min.`,
      });
      durationMsg.textContent = `Enregistré : les prochaines parties dureront ${minutes} min.`;
      durationMsg.className = 'field-msg';
    } catch (err) {
      durationMsg.textContent = err.message;
      durationMsg.className = 'field-msg is-error';
    }
  });

  togglesBox.addEventListener('change', async (e) => {
    const input = e.target.closest('input[data-table]');
    if (!input) return;
    const tableNo = Number(input.dataset.table);
    const enabled = input.checked;
    input.closest('.toggle').classList.toggle('is-on', enabled);
    pendingToggles.add(tableNo);
    try {
      await run('setTableEnabled', { tableNo, enabled }, {
        success: enabled ? `Table ${tableNo} remise en service.` : `Table ${tableNo} hors service.`,
      });
    } catch {
      input.checked = !enabled;
    } finally {
      pendingToggles.delete(tableNo);
      updateSettingsDialog();
    }
  });

  // ================================================================ modale « Nouvelle journée »

  const newDayDialog = $('#newday-dialog');
  const newDayConfirm = $('#newday-confirm');

  function updateNewDayDialog() {
    if (!newDayDialog.open || !state) return;
    const waitingPlayers = state.queue.reduce((n, e) => n + e.players.length, 0);
    let matches = 0;
    let playing = 0;
    for (const t of state.tables) {
      for (const s of SLOTS) {
        if (t.slots[s]) {
          matches++;
          playing += t.slots[s].players.length;
        }
      }
    }
    const goodiesPending = (state.goodies || []).filter((g) => !g.goodiesGivenAt).length;
    $$('[data-nd="current"]', newDayDialog).forEach((el) => (el.textContent = String(state.day.number)));
    $$('[data-nd="next"]', newDayDialog).forEach((el) => (el.textContent = String(state.day.number + 1)));
    newDayConfirm.textContent = `Démarrer le jour ${state.day.number + 1}`;
    const items = [
      [
        waitingPlayers,
        waitingPlayers >= 2
          ? 'joueurs en attente seront retirés de la file (ils pourront se réinscrire).'
          : 'joueur en attente sera retiré de la file (il pourra se réinscrire).',
      ],
      [
        matches,
        `${matches >= 2 ? 'parties en cours seront interrompues' : 'partie en cours sera interrompue'}` +
          `${playing ? ` (${plural(playing, 'joueur', 'joueurs')}, sans goodies)` : ''}.`,
      ],
    ];
    if (goodiesPending) {
      items.push([
        goodiesPending,
        goodiesPending >= 2
          ? "joueurs n'ont pas encore reçu leurs goodies : ils ne seront plus listés ici (toujours trouvables par la recherche)."
          : "joueur n'a pas encore reçu ses goodies : il ne sera plus listé ici (toujours trouvable par la recherche).",
      ]);
    }
    $('#newday-impact').innerHTML = items
      .map(([n, text]) => `<li class="${n ? '' : 'is-zero'}"><strong>${n}</strong> ${esc(text)}</li>`)
      .join('');
    const reopen = $('#newday-reopen');
    const paused = isPaused();
    reopen.classList.toggle('is-reopen', paused);
    reopen.innerHTML = paused
      ? '<strong>Le stand sera rouvert</strong> (il est fermé actuellement) : les placements automatiques reprennent dès le démarrage de la journée.'
      : 'Le stand est ouvert et le restera : les placements automatiques continuent.';
  }

  function openNewDay() {
    if (!state) return;
    openDialog(newDayDialog, $('#newday-cancel'));
    updateNewDayDialog();
  }

  newDayBtn.addEventListener('click', openNewDay);

  $('#confirm-body').addEventListener('click', (e) => {
    if (!e.target.closest('[data-open-newday]')) return;
    closeDialog($('#confirm-dialog'));
    openNewDay();
  });

  newDayConfirm.addEventListener('click', async () => {
    const wasPaused = isPaused();
    try {
      const r = await run('newDay', {}, { button: newDayConfirm });
      closeDialog(newDayDialog);
      lastRegistration = null;
      renderLastRegistration();
      toast(
        `Jour ${r.dayNumber} démarré : ${plural(r.expiredParticipants, 'joueur retiré', 'joueurs retirés')} de la file, ${plural(r.interruptedMatches, 'partie interrompue', 'parties interrompues')}.${wasPaused ? ' Stand rouvert.' : ''}`,
        'success',
        7000,
      );
    } catch {
      /* toast déjà affiché */
    }
  });

  // ================================================================ onglets (tablette)

  const layout = $('#layout');

  function setTab(name) {
    if (layout.dataset.tab === name) return;
    layout.dataset.tab = name;
    for (const t of $$('.tab')) t.setAttribute('aria-pressed', String(t.dataset.tab === name));
    closeSlotPop();
    closeRowMenu();
  }

  $('.tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) setTab(tab.dataset.tab);
  });

  // ================================================================ comptes à rebours

  function tick() {
    const t = now();
    // « Absent » disparaît de lui-même à la fin du délai, sans attendre un nouvel état ; le panneau
    // ouvert est alors redessiné pour afficher la consigne d'après délai (« laissez jouer… »).
    let noShowClosed = false;
    for (const el of $$('[data-noshow-until]')) {
      const open = t < Number(el.dataset.noshowUntil);
      if (el.hidden !== !open) {
        // Le focus revient sur le panneau (jamais sur une action : Entrée ne doit rien déclencher).
        if (!open && el.contains(document.activeElement)) pop.focus({ preventScroll: true });
        el.hidden = !open;
        if (!open && pop.contains(el)) noShowClosed = true;
      }
    }
    if (noShowClosed) renderSlotPop();
    renderStandState();
    renderWaitPill();
    if (lastRegistration && state) renderLastRegistration(); // version compacte au bout de 90 s
    let popWarn = false;
    let popOver = false;
    for (const el of $$('[data-ends-at]')) {
      const left = Number(el.dataset.endsAt) - t;
      const text = left > 0 ? LC.formatRemaining(left) : 'Terminé';
      if (el.textContent !== text) el.textContent = text;
      el.classList.toggle('is-long', text.length > 5); // « 1:04:52 » (après « +5 min ») : chiffres plus petits
      const warn = left > 0 && left <= WARN_MS;
      el.classList.toggle('is-warn', warn);
      el.classList.toggle('is-over', left <= 0);
      const slot = el.closest('.slot');
      if (slot) {
        slot.classList.toggle('is-warn', warn);
        slot.classList.toggle('is-over', left <= 0);
      }
      if (pop.contains(el)) {
        popWarn = popWarn || warn;
        popOver = popOver || left <= 0;
      }
    }
    // Panneau d'emplacement : liseré et anneau roses dans les 5 dernières minutes, verts à la fin.
    pop.classList.toggle('is-warn', popWarn);
    pop.classList.toggle('is-over', popOver);
    // Anneaux de temps (part restante, voir ringLeft) ; ne repeint que si la valeur change.
    syncRings(document, t);
    for (const el of $$('[data-since]')) {
      const text = formatWait(t - Number(el.dataset.since));
      if (el.textContent !== text) el.textContent = text;
    }
    for (const el of $$('[data-ago]')) {
      const ms = t - Number(el.dataset.ago);
      const text = ms < MIN ? 'à l’instant' : `il y a ${formatWait(ms)}`;
      if (el.textContent !== text) el.textContent = text;
    }
    for (const el of $$('[data-new-until]')) {
      el.hidden = t >= Number(el.dataset.newUntil);
    }
    for (const el of $$('[data-noshow-left]')) {
      const left = Number(el.dataset.noshowLeft) - t;
      const text = left > 0 ? `· ${Math.max(1, Math.ceil(left / MIN))} min` : '';
      if (el.textContent !== text) el.textContent = text;
    }
  }

  function loop() {
    tick();
    setTimeout(loop, 1000 - (now() % 1000) + 15);
  }

  // ================================================================ raccourcis clavier

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !anyDialogOpen()) {
      if (rowMenuFor) {
        e.preventDefault();
        closeRowMenu(true);
        return;
      }
      if (!moreMenu.hidden) {
        e.preventDefault();
        closeMoreMenu(true);
        return;
      }
      if (popTarget) {
        e.preventDefault();
        closeSlotPop({ restoreFocus: true });
        return;
      }
      if (!searchPop.hidden) {
        e.preventDefault();
        closeSearch({ restoreFocus: true });
        return;
      }
    }
    if (!e.altKey || e.ctrlKey || e.metaKey || anyDialogOpen()) return;
    if (e.code === 'Digit1' || e.code === 'Numpad1') {
      e.preventDefault();
      closeSearch();
      setMode(1);
    } else if (e.code === 'Digit2' || e.code === 'Numpad2') {
      e.preventDefault();
      closeSearch();
      setMode(2);
    } else if (e.code === 'KeyN') {
      e.preventDefault();
      closeSearch();
      inputOf(0, 'firstName').focus();
    }
  });

  // Recherche : Ctrl+K (⌘K sur Mac), « / » hors d'un champ de saisie, et Alt+R (que certains
  // navigateurs ou systèmes interceptent : il reste en secours). Écouté en phase de capture sur la
  // fenêtre, avant tout autre gestionnaire, pour que rien ne l'avale ; Ctrl+K marche aussi dans un champ.
  const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'number', 'tel', 'url', 'password', 'date', 'time', 'datetime-local', 'month', 'week']);
  function isTextEntry(el) {
    if (!el || el === document.body) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
    return el.tagName === 'INPUT' && TEXT_INPUT_TYPES.has(String(el.type || 'text').toLowerCase());
  }

  function isSearchShortcut(e) {
    if (e.isComposing || e.keyCode === 229) return false;
    const key = String(e.key || '').toLowerCase();
    // Ctrl+K / ⌘K (code physique ou caractère : claviers AZERTY, QWERTY, Dvorak…).
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.code === 'KeyK' || key === 'k')) return true;
    // Alt+R (y compris AltGr+R, vu comme Ctrl+Alt sous Windows).
    if (e.altKey && !e.metaKey && !e.shiftKey && e.code === 'KeyR') return true;
    // « / » (Maj+: en AZERTY, pavé numérique) : seulement hors d'un champ de saisie.
    if (key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) return !isTextEntry(e.target);
    return false;
  }

  window.addEventListener('keydown', (e) => {
    if (!isSearchShortcut(e)) return;
    if (anyDialogOpen()) return; // une modale est ouverte : la recherche resterait inaccessible dessous
    e.preventDefault();
    openSearch();
  }, true);

  for (const el of $$('[data-kbd="search"]')) el.textContent = SEARCH_KBD;
  searchTrigger.title = `Rechercher un participant (${SEARCH_SHORTCUT}, ou « / » hors d'un champ)`;

  // ================================================================ démarrage

  const topSticky = $('#top-sticky');
  const setTopbarHeight = () => {
    document.documentElement.style.setProperty('--acc-topbar-h', `${topSticky.offsetHeight}px`);
    positionSlotPop();
    if (!searchPop.hidden) positionSearch();
  };
  if (window.ResizeObserver) new ResizeObserver(setTopbarHeight).observe(topSticky);
  setTopbarHeight();

  loadCalls();
  buildTables();
  buildToggles();
  applyMode();
  queueList.innerHTML = '<li class="empty">Chargement…</li>';
  goodiesList.innerHTML = '<li class="empty">Chargement…</li>';

  client = LC.connect({
    onState,
    onStatus: setConnection,
    onSession: (session) => {
      if (!session || !session.admin) window.location.href = LOGIN_URL;
    },
  });

  loop();
  inputOf(0, 'firstName').focus();
})();
