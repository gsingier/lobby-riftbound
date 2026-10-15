// Interface d'accueil (hôtesse).
// Principes :
//  - le formulaire d'inscription et les modales ne sont JAMAIS re-rendus par un nouvel état ;
//  - les zones dynamiques (tables, file, goodies, recherche) ne sont réécrites que si leurs
//    données ont changé, en conservant le focus clavier ;
//  - les comptes à rebours sont mis à jour chaque seconde sans re-rendu.
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

  let client = null;
  let state = null;
  let stateSeq = 0;
  let where = new Map(); // participantId → emplacement actuel (table, file, goodies)
  let etas = new Map(); // entryId → heure de passage estimée
  let lastRegistration = null;
  let searchResults = null;
  let searchQuery = '';
  let lastSearchSeq = 0; // numéro de l'état pour lequel la recherche a été faite
  const ownMatches = new Set(); // parties créées par une action de l'hôtesse (déjà annoncées)

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
    // Même règle que le serveur : première lettre du nom, à défaut premier caractère.
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

  // Date du calendrier à Paris (« 2026-10-15 »), pour savoir si un horodatage date d'un jour précédent.
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

  function now() {
    return client ? client.now() : Date.now();
  }

  // Stand fermé (le soir) : plus aucun placement automatique.
  const isPaused = () => !!(state && state.settings && state.settings.placementsPaused);

  // Délai après le début d'une partie pendant lequel un joueur peut être déclaré « Absent ».
  function noShowWindow() {
    const ms = state && state.settings ? Number(state.settings.noShowWindowMs) : NaN;
    return Number.isFinite(ms) && ms >= 0 ? ms : DEFAULT_NO_SHOW_MS;
  }

  // Le matin, journée de la veille encore en cours (« Nouvelle journée » pas encore faite) :
  // la journée a commencé un jour précédent (heure de Paris) ou il y a plus de STALE_MS.
  const STALE_MS = 14 * 60 * MIN;
  const isOld = (ms, t) => Number.isFinite(ms) && (parisDate(ms) !== parisDate(t) || t - ms > STALE_MS);

  function staleDay() {
    return !!(state && state.day) && isOld(Number(state.day.startedAt), now());
  }

  // Joueurs de la file inscrits la veille (ou depuis plus de STALE_MS).
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

  // La colonne de gauche (inscription + recherche) défile seule : fait défiler la colonne, et non la
  // page, juste assez pour montrer `el`, sans faire sortir le haut de `keep` par le haut, sauf s'il
  // le faut pour montrer au moins `must` (fenêtre très basse).
  const colLeft = $('.col-left');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function revealInColumn(el, { keep = null, must = null } = {}) {
    if (!el || el.hidden || !colLeft.contains(el)) return;
    const behavior = reducedMotion.matches ? 'auto' : 'smooth';
    if (colLeft.scrollHeight <= colLeft.clientHeight + 1) {
      // Colonne sans défilement propre (écran étroit : c'est la page qui défile).
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
    // Cible absolue : un second appel pendant l'animation ne cumule pas les décalages.
    if (Math.abs(delta) >= 1) colLeft.scrollTo({ top: colLeft.scrollTop + delta, behavior });
  }

  // ================================================================ toasts

  const toastBox = $('#toasts');
  const MAX_TOASTS = 3;
  const MAX_TOASTS_WITH_CALLS = 5;

  // `keep` : notification « À appeler », que la limite d'affichage ne retire qu'en dernier recours.
  function toast(message, type = 'success', timeout, { keep = false } = {}) {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    if (keep) el.dataset.keep = '';
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
    trimToasts();
    requestAnimationFrame(updateToastPeek);
    const dismiss = () => {
      if (!el.isConnected) return;
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 260);
    };
    close.addEventListener('click', dismiss);
    setTimeout(dismiss, timeout || (type === 'error' ? 7000 : type === 'info' ? 6000 : 3500));
  }

  // Au-delà de 3 toasts, on retire d'abord ceux qui disparaissent déjà, puis les plus anciens
  // hors « À appeler » (jamais celui qui vient d'arriver). Un appel n'est retiré qu'au-delà de 5 toasts.
  function trimToasts() {
    let items = Array.from(toastBox.children);
    while (items.length > MAX_TOASTS) {
      const older = items.slice(0, -1);
      const victim =
        older.find((t) => t.classList.contains('is-leaving')) ||
        older.find((t) => !('keep' in t.dataset)) ||
        (items.length > MAX_TOASTS_WITH_CALLS ? items[0] : null);
      if (!victim) break;
      victim.remove();
      items = items.filter((t) => t !== victim);
    }
  }

  // Les toasts laissent passer les clics (seule la croix est cliquable, cf. CSS) ; sous la souris,
  // ils s'estompent pour laisser voir les boutons du plan qu'ils recouvrent.
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

  // Confirmation générique. `body` : texte, ou { html } déjà échappé.
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
      ok.className = `btn ${tone === 'danger' ? 'btn-danger' : tone === 'warn' ? 'btn-warn-ghost' : 'btn-primary'}`;
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

  // Heure de passage estimée de chaque entrée prête : on simule les libérations
  // d'emplacements (fin prévue des parties en cours, puis parties de la durée réglée).
  function computeEtas(s) {
    const t0 = now();
    const free = [];
    if (s.settings.placementsPaused) return new Map(); // stand fermé : personne ne sera placé
    for (const t of s.tables) {
      if (!t.enabled) continue;
      for (const slot of SLOTS) {
        const m = t.slots[slot];
        free.push(m ? Math.max(m.endsAt, t0) : t0);
      }
    }
    const map = new Map();
    if (!free.length) return map;
    for (const e of s.queue) {
      if (!e.ready) continue;
      free.sort((a, b) => a - b);
      const at = free.shift();
      map.set(e.entryId, at);
      free.push(at + s.settings.matchDurationMs);
    }
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
    if (online) everConnected = true;
  }

  function onState(next) {
    const prev = state;
    state = next;
    stateSeq++;
    where = buildWhere(next);
    etas = computeEtas(next);
    if (prev) notifyChanges(prev, next);
    renderAll();
    for (const resolve of stateWaiters.splice(0)) resolve();
  }

  // Résout à la réception du prochain état (au plus tard après `ms`) : le serveur envoie l'accusé
  // d'une action juste avant l'état qui en découle, et ils peuvent arriver dans un ordre ou l'autre.
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

  // Signale les placements automatiques et les fins de partie (goodies) survenus sans action de l'hôtesse.
  // Un même état peut en apporter plusieurs (parties lancées dans la même seconde) : ils sont regroupés
  // en un toast par catégorie pour qu'aucun appel ne soit chassé par la limite d'affichage.
  function notifyChanges(prev, next) {
    if (prev.day.id !== next.day.id) return;
    const prevMatches = new Set();
    for (const t of prev.tables) for (const s of SLOTS) if (t.slots[s]) prevMatches.add(t.slots[s].matchId);
    const calls = [];
    for (const t of next.tables) {
      for (const s of SLOTS) {
        const m = t.slots[s];
        if (!m || prevMatches.has(m.matchId) || ownMatches.has(m.matchId)) continue;
        const names = m.players.map(shortName);
        if (m.vsAnimator) names.push('Animateur');
        calls.push(`${joinNames(names)} → Table ${t.no}, emplacement ${s}`);
      }
    }
    if (calls.length) {
      toast(calls.length === 1 ? `À appeler : ${calls[0]}` : `À appeler :\n${calls.join('\n')}`, 'info', undefined, { keep: true });
    }
    const prevGoodies = new Set((prev.goodies || []).map((g) => g.id));
    const fresh = (next.goodies || []).filter((g) => !prevGoodies.has(g.id) && !g.goodiesGivenAt);
    const byMatch = new Map();
    for (const g of fresh) {
      const k = `${g.tableNo}${g.slot}`;
      if (!byMatch.has(k)) byMatch.set(k, { tableNo: g.tableNo, slot: g.slot, names: [] });
      byMatch.get(k).names.push(shortName(g));
    }
    const ended = [...byMatch.values()];
    if (ended.length === 1) {
      const m = ended[0];
      toast(`Fin de partie Table ${m.tableNo} · ${m.slot} : goodies à remettre à ${joinNames(m.names)}`, 'info');
    } else if (ended.length) {
      const lines = ended.map((m) => `Table ${m.tableNo} · ${m.slot} : ${joinNames(m.names)}`);
      toast(`Fins de partie – goodies à remettre :\n${lines.join('\n')}`, 'info');
    }
  }

  function renderAll() {
    if (!state) return;
    renderTopbar();
    renderTables();
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
  const newDayBtn = $('#btn-newday');
  const closedBanner = $('#closed-banner');
  const closedDetail = $('#closed-detail');
  const closedNewDay = $('#closed-newday');
  const formPaused = $('#form-paused');
  let standKey = '';

  // Bouton, bandeau et avertissement du formulaire : simples bascules (aucun re-rendu du formulaire).
  // Appelée aussi par tick() : au petit matin, le bandeau passe de lui-même en mode « Nouvelle journée ».
  function renderStandState() {
    if (!state) return;
    const paused = isPaused();
    // Stand fermé depuis la veille : c'est « Nouvelle journée » qu'il faut le matin, pas « Rouvrir le stand »
    // (qui placerait les joueurs restés en file hier soir).
    const morning = paused && staleDay();
    const stalePlayers = morning ? staleQueuePlayers() : 0;
    const key = JSON.stringify([paused, morning, stalePlayers, state.day.number, state.day.startedAt]);
    if (key === standKey) return;
    standKey = key;
    const label = paused ? 'Rouvrir le stand' : 'Fermer le stand';
    if (standBtn.textContent !== label) standBtn.textContent = label;
    standBtn.classList.toggle('btn-success', paused && !morning);
    standBtn.classList.toggle('btn-ghost', morning);
    standBtn.classList.toggle('btn-warn-ghost', !paused);
    standBtn.title = morning
      ? 'Le matin, utilisez plutôt « Nouvelle journée » (elle rouvre aussi le stand)'
      : paused
        ? 'Reprendre les placements automatiques (dans la journée)'
        : 'Le soir, à la fermeture : plus aucun placement automatique';
    // Le matin, « Nouvelle journée » est l'action attendue : bouton mis en avant.
    newDayBtn.classList.toggle('btn-primary', morning);
    newDayBtn.classList.toggle('btn-ghost', !morning);
    newDayBtn.classList.toggle('btn-danger-ghost', !morning);
    closedBanner.hidden = !paused;
    closedBanner.classList.toggle('is-morning', morning);
    closedNewDay.hidden = !morning;
    closedDetail.textContent = morning
      ? `Jour ${state.day.number} commencé le ${dateFmt.format(new Date(state.day.startedAt))}` +
        (stalePlayers
          ? ` · ${plural(stalePlayers, 'joueur attend', 'joueurs attendent')} depuis la veille`
          : '') +
        ' · le matin : « Nouvelle journée », et non « Rouvrir le stand »'
      : "Les parties en cours vont jusqu'au bout · « Rouvrir le stand » (dans la journée) · le matin : « Nouvelle journée »";
    formPaused.hidden = !paused;
  }

  closedNewDay.addEventListener('click', () => openNewDay());

  // Nombre de parties (et de joueurs) lancées dès la réouverture : entrées prêtes × emplacements libres.
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
            Le matin, « Nouvelle journée » rouvre le stand ; les joueurs encore en file pourront se réinscrire.</p>`,
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
        // Les joueurs placés sont annoncés par le toast « À appeler » qui arrive avec le nouvel état.
        success: (r) =>
          r.placed
            ? `Stand rouvert : ${plural(r.placed, 'partie lancée', 'parties lancées')} (voir « À appeler »).`
            : 'Stand rouvert : les placements automatiques reprennent.',
      }).catch(() => {});
    }
  });

  // ================================================================ plan des tables

  const tablesGrid = $('#tables-grid');
  const tableEls = [];

  function buildTables() {
    for (let no = 1; no <= 9; no++) {
      const card = document.createElement('article');
      card.className = 'table-card';
      card.dataset.table = String(no);
      card.innerHTML = `
        <div class="table-head"><span class="table-no">Table ${no}</span><span class="table-flag"></span></div>
        <div class="table-slots">
          <div class="slot" data-slot="A"></div>
          <div class="slot" data-slot="B"></div>
        </div>`;
      tablesGrid.append(card);
      tableEls.push({
        card,
        flag: $('.table-flag', card),
        slots: { A: $('[data-slot="A"]', card), B: $('[data-slot="B"]', card) },
      });
    }
  }

  function slotHtml(table, slot, m, paused) {
    if (!m) {
      // Même vocabulaire que l'écran TV : « Hors service » pour une table désactivée.
      const label = !table.enabled ? 'Hors service' : paused ? 'Libre<span class="slot-free-sub">stand fermé</span>' : 'Libre';
      return `<div class="slot-head"><span class="slot-letter">${slot}</span></div>
        <div class="slot-free">${label}</div>`;
    }
    const id = m.matchId;
    // « Absent » pendant les premières minutes de la partie ; tick() le masque à l'échéance.
    const noShowUntil = m.startedAt + noShowWindow();
    const noShowOpen = now() < noShowUntil;
    const noShowMin = Math.round(noShowWindow() / MIN);
    const players = m.players.map((p, i) => {
      const prefix = i > 0 ? '<span class="vs">vs</span>' : '';
      const absent = noShowOpen
        ? `<button type="button" class="btn btn-absent" data-action="noshow" data-match="${id}" data-participant="${p.id}"
            data-noshow-until="${noShowUntil}" data-focus="noshow-${p.id}"
            title="${esc(`Ne s'est pas présenté : retiré sans goodies (possible pendant ${noShowMin} min après le début)`)}"
            aria-label="${esc(`${fullName(p)} absent (table ${table.no} ${slot})`)}">Absent</button>`
        : '';
      return `<li title="${esc(`${fullName(p)} – ${p.email || ''}`)}"><span class="p-name">${prefix}${esc(fullName(p))}</span>${absent}</li>`;
    });
    if (m.vsAnimator) players.push('<li class="animator"><span class="p-name"><span class="vs">vs</span>Animateur</span></li>');
    return `
      <div class="slot-head">
        <span class="slot-letter">${slot}</span>
        <span class="badge-new" data-new-until="${m.startedAt + NEW_BADGE_MS}">Nouveau</span>
        <span class="countdown" data-ends-at="${m.endsAt}" title="Fin prévue à ${clock(m.endsAt)}"></span>
      </div>
      <ul class="slot-players">${players.join('')}</ul>
      <div class="slot-actions">
        <button type="button" class="btn btn-xs" data-action="adjust" data-match="${id}" data-delta="${-ADJUST_MS}"
          data-focus="minus-${id}" title="Retirer 5 minutes" aria-label="Retirer 5 minutes (table ${table.no} ${slot})"><span class="lbl-long">−5 min</span><span class="lbl-short">−5</span></button>
        <button type="button" class="btn btn-xs" data-action="adjust" data-match="${id}" data-delta="${ADJUST_MS}"
          data-focus="plus-${id}" title="Ajouter 5 minutes" aria-label="Ajouter 5 minutes (table ${table.no} ${slot})"><span class="lbl-long">+5 min</span><span class="lbl-short">+5</span></button>
        <button type="button" class="btn btn-xs btn-danger-ghost slot-release" data-action="release" data-match="${id}"
          data-focus="release-${id}" title="Départ anticipé : pas de goodies" aria-label="Libérer la table ${table.no} ${slot}">Libérer</button>
      </div>`;
  }

  function renderTables() {
    let busy = 0;
    let busyOff = 0;
    let capacity = 0;
    const paused = isPaused();
    const noShowMs = noShowWindow();
    state.tables.forEach((t, i) => {
      const el = tableEls[i];
      if (!el) return;
      el.card.classList.toggle('is-disabled', !t.enabled);
      const count = SLOTS.filter((s) => t.slots[s]).length;
      if (t.enabled) {
        busy += count;
        capacity += SLOTS.length;
      } else busyOff += count;
      el.flag.textContent = t.enabled ? `${count}/2` : count ? 'Hors service · fin des parties' : 'Hors service';
      for (const slot of SLOTS) {
        const m = t.slots[slot];
        const node = el.slots[slot];
        node.classList.toggle('is-free', !m);
        node.classList.toggle('is-busy', !!m);
        if (!m) node.classList.remove('is-new', 'is-warn'); // tick() les recalcule pour les emplacements occupés
        const key = JSON.stringify([
          t.enabled,
          !m && paused,
          m && [m.matchId, m.endsAt, m.startedAt, m.vsAnimator, noShowMs, m.players.map((p) => [p.id, p.firstName, p.lastName, p.email])],
        ]);
        patch(node, key, () => slotHtml(t, slot, m, paused));
      }
    });
    const minutes = Math.round(state.settings.matchDurationMs / MIN);
    const off = state.tables.filter((t) => !t.enabled).length;
    $('#tables-summary').textContent =
      `${busy}/${capacity} emplacements occupés · parties de ${minutes} min` +
      (off ? ` · ${plural(off, 'table hors service', 'tables hors service')}` : '') +
      (busyOff ? ` (${plural(busyOff, 'partie', 'parties')} en cours dessus)` : '') +
      (paused ? ' · stand fermé : aucun placement' : '');
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

  tablesGrid.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn || !state) return;
    const matchId = Number(btn.dataset.match);
    const found = findMatch(matchId);
    if (!found) return;
    const { table, slot, match } = found;
    const place = `Table ${table.no} · ${slot}`;

    if (btn.dataset.action === 'adjust') {
      const delta = Number(btn.dataset.delta);
      const left = match.endsAt - now();
      if (delta < 0 && left <= -delta) {
        // Seuls les joueurs reçoivent des goodies (jamais l'animateur).
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
          // Partie terminée : le toast « Fin de partie … goodies » arrive avec le nouvel état.
          if (r.endsAt > now() + 1000) toast(`${place} : ${delta > 0 ? '+5 min' : '−5 min'} · fin prévue à ${clock(r.endsAt)}`);
        })
        .catch(() => {});
    } else if (btn.dataset.action === 'release') {
      const many = match.players.length >= 2;
      const fate = {
        paused: "Stand fermé : l'emplacement restera libre.",
        disabled: "Table hors service : l'emplacement restera libre.",
        reassigned: "L'emplacement sera réattribué aux joueurs suivants de la file.",
        nobody: "L'emplacement sera libéré (aucun joueur prêt dans la file pour l'instant).",
      }[slotFate(table)];
      // Début de partie : des joueurs qui ne sont pas venus se déclarent « Absent » (réinscription possible).
      const noShowLeft = match.startedAt + noShowWindow() - now();
      const noShowHint =
        noShowLeft > 0 && match.players.length
          ? `<p class="confirm-alert">${many ? 'Joueurs pas venus' : 'Joueur pas venu'} ? Utilisez plutôt <strong>« Absent »</strong> à côté
              ${many ? 'de chaque nom' : 'du nom'} (encore ${plural(Math.max(1, Math.ceil(noShowLeft / MIN)), 'min', 'min')}) :
              ${many ? 'ils pourront se réinscrire' : 'il/elle pourra se réinscrire'}. Avec « Libérer », ${many ? 'ils ne le pourront plus' : 'il/elle ne le pourra plus'}.</p>`
          : '';
      const ok = await confirmDialog({
        title: `Libérer ${place} ?`,
        html: `<p class="confirm-text"><strong>${esc(joinNames(matchNames(match)))}</strong> quittent la table avant la fin.</p>
          <p class="confirm-note">Départ anticipé : pas de goodies, et ${many ? 'ces joueurs ne pourront plus se réinscrire' : 'ce joueur ne pourra plus se réinscrire'}
            au salon (email et billet déjà utilisés). ${fate}</p>
          ${noShowHint}`,
        ok: 'Libérer (pas de goodies)',
        tone: 'danger',
        focus: noShowHint ? 'cancel' : 'ok',
      });
      if (!ok) return;
      run('releaseMatch', { matchId }, { success: `${place} libérée.` }).catch(() => {});
    } else if (btn.dataset.action === 'noshow') {
      await declareNoShow(Number(btn.dataset.participant), found, btn);
    }
  });

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
      toast(`La partie a commencé il y a plus de ${minutes} min : utilisez « Libérer ».`, 'error');
      return;
    }
    const placeNb = place.replace(/ /g, '\u00a0'); // « Table 4 · B » sur une seule ligne
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
      html: `<p class="confirm-text"><strong>${esc(name)}</strong> ne s'est pas présenté(e) à ${placeNb} : il/elle est retiré(e), <strong>sans goodies</strong>, et pourra se réinscrire avec le même email et le même billet.</p>
        <p class="confirm-note">${consequence}</p>`,
      ok: "Confirmer l'absence",
      tone: 'danger',
    });
    if (!ok) return;
    run('noShow', { participantId }, { button: btn })
      .then(async (r) => {
        if (r.cancelled) {
          // Le serveur a pu redonner aussitôt l'emplacement à la paire suivante : on regarde l'état qui suit
          // l'action (l'accusé peut arriver avant lui).
          const slotNow = () => {
            const t = state.tables.find((x) => x.no === table.no);
            return { table: t || table, match: t ? t.slots[slot] : null };
          };
          if (slotNow().match && slotNow().match.matchId === r.matchId) await nextState();
          const cur = slotNow();
          const head = `${name} absent(e), retiré(e) sans goodies. Partie annulée`;
          if (cur.match && cur.match.matchId !== r.matchId) {
            toast(`${head} ; emplacement ${place} aussitôt redonné à ${joinNames(matchNames(cur.match, false))} (voir « À appeler »).`);
          } else if (cur.match) {
            toast(`${head} (${place}).`); // état pas encore reçu
          } else {
            const why = isPaused() ? ' (stand fermé)' : !cur.table.enabled ? ' (table hors service)' : '';
            toast(`${head} : ${place} est libre${why}.`);
          }
        } else if (r.vsAnimator && partners.length) {
          toast(`${name} absent(e), retiré(e) sans goodies. ${joinNames(partners)} joue contre un animateur (${place}).`);
        } else {
          toast(`${name} absent(e), retiré(e) sans goodies.`);
        }
      })
      .catch(() => {});
  }

  // ================================================================ file d'attente

  const queueList = $('#queue-list');

  function queueEntryHtml(e, isNext) {
    const isSolo = e.kind === 'solo';
    const classes = ['q-entry'];
    const tags = [];
    if (isNext) {
      classes.push('is-next');
      tags.push('<span class="tag tag-next">Prochain</span>');
    }
    if (e.kind === 'pair') tags.unshift('<span>Paire</span>');
    else if (e.vsAnimator) {
      classes.push('is-animator');
      tags.unshift('<span>Joueur seul</span>', '<span class="tag tag-animator">Prêt contre un animateur</span>');
    } else {
      classes.push('is-solo');
      tags.unshift('<span>Joueur seul</span>', '<span class="tag tag-solo">Cherche un partenaire</span>');
    }

    const players = e.players
      .map(
        (p) => `<li class="q-player">
          <span class="q-name" title="${esc(`${p.email || ''} · billet ${p.ticket || ''}`)}">${esc(fullName(p))}</span>
          <span class="q-player-actions">
            <button type="button" class="btn btn-ghost" data-action="edit" data-participant="${p.id}" data-focus="edit-${p.id}">Modifier</button>
            <button type="button" class="btn btn-danger-ghost" data-action="remove" data-participant="${p.id}" data-focus="remove-${p.id}">Retirer</button>
          </span>
        </li>`,
      )
      .join('');

    const eta = etaText(e.entryId);
    const status = e.ready
      ? eta
        ? `<strong>${esc(eta)}</strong>`
        : ''
      : '<strong>Attend un partenaire</strong> – les paires suivantes passent devant';

    let actions = '';
    if (isSolo) {
      actions = e.vsAnimator
        ? `<button type="button" class="btn btn-sm btn-ghost" data-action="cancel-anyway" data-entry="${e.entryId}" data-focus="cancel-${e.entryId}">Annuler animateur</button>`
        : `<button type="button" class="btn btn-sm btn-warn-ghost" data-action="place-anyway" data-entry="${e.entryId}" data-focus="anyway-${e.entryId}">Placer quand même (vs animateur)</button>`;
    }

    return `<li class="${classes.join(' ')}" data-entry="${e.entryId}">
      <span class="q-rank" title="Rang dans la file">${e.rank}</span>
      <div class="q-kind">${tags.join('')}</div>
      <ul class="q-players">${players}</ul>
      <div class="q-meta">Inscrit à ${clock(e.createdAt)} · attend depuis <span data-since="${e.createdAt}"></span>${status ? ` · ${status}` : ''}</div>
      ${actions ? `<div class="q-entry-actions">${actions}</div>` : ''}
    </li>`;
  }

  function renderQueue() {
    const q = state.queue;
    const paused = isPaused();
    const playersWaiting = q.reduce((n, e) => n + e.players.length, 0);
    $('#queue-summary').textContent = q.length
      ? `${plural(q.length, 'entrée', 'entrées')} · ${plural(playersWaiting, 'joueur', 'joueurs')}`
      : '';
    $('#queue-paused').hidden = !paused;
    // Stand fermé : personne n'est « prochain » (aucun placement avant la réouverture).
    const nextId = paused ? undefined : (q.find((e) => e.ready) || {}).entryId;
    const key = JSON.stringify([q, paused, nextId, [...etas.entries()].map(([k, v]) => [k, Math.floor(v / MIN)])]);
    patch(queueList, key, () =>
      q.length ? q.map((e) => queueEntryHtml(e, e.entryId === nextId)).join('') : '<li class="empty">File d\'attente vide.</li>',
    );
  }

  queueList.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn || !state) return;
    handleCommonAction(btn);
  });

  // Actions partagées par la file, les résultats de recherche, le résultat d'inscription et les goodies.
  async function handleCommonAction(btn) {
    const action = btn.dataset.action;
    const participantId = Number(btn.dataset.participant);
    const entryId = Number(btn.dataset.entry);

    if (action === 'edit') {
      const p = findParticipant(participantId);
      if (p) openEdit(p);
    } else if (action === 'remove') {
      await removePlayer(participantId, btn);
    } else if (action === 'place-anyway') {
      const entry = state.queue.find((x) => x.entryId === entryId);
      const name = entry ? shortName(entry.players[0]) : 'Le joueur';
      run('placeAnyway', { entryId }, { button: btn })
        .then((r) => {
          if (r.placed) ownMatches.add(r.matchId);
          if (r.placed) toast(`${name} → Table ${r.tableNo}, emplacement ${r.slot} (contre un animateur)`);
          else if (isPaused()) toast(`${name} jouera contre un animateur, mais pas avant la réouverture du stand.`);
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
        success: given ? `Goodies remis à ${name}.` : `Remise des goodies annulée pour ${name}.`,
      }).catch(() => {});
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
        <p>Il/elle pourra se réinscrire plus tard avec le même email et le même billet.</p>
        ${partner ? `<p class="confirm-note">${esc(fullName(partner))} redevient joueur seul, à la même place dans la file.</p>` : ''}`,
      ok: 'Retirer de la file',
      tone: 'danger',
    });
    if (!ok) return;
    run('removeParticipant', { participantId }, { button: btn, success: `${fullName(p)} retiré(e) de la file.` }).catch(
      () => {},
    );
  }

  // ================================================================ goodies

  const goodiesList = $('#goodies-list');

  function renderGoodies() {
    const list = state.goodies || [];
    const pending = list.filter((g) => !g.goodiesGivenAt).length;
    const badge = $('#goodies-count');
    badge.textContent = String(pending);
    badge.classList.toggle('is-pending', pending > 0);
    const key = JSON.stringify(list.map((g) => [g.id, g.firstName, g.lastName, g.goodiesGivenAt, g.tableNo, g.slot, g.endedAt]));
    patch(goodiesList, key, () => {
      if (!list.length) return '<li class="empty">Aucune partie terminée aujourd\'hui.</li>';
      let sepDone = false;
      return list
        .map((g) => {
          const given = !!g.goodiesGivenAt;
          let sep = '';
          if (given && !sepDone) {
            sepDone = true;
            sep = `<li class="goodies-sep">Déjà remis</li>`;
          }
          const meta = `Table ${g.tableNo} · ${g.slot} · terminé à ${clock(g.endedAt)}`;
          return `${sep}<li class="goodie${given ? ' is-given' : ''}">
            <div class="goodie-main">
              <span class="goodie-name">${esc(fullName(g))}</span>
              <span class="goodie-meta">${meta}${given ? ` · remis à ${clock(g.goodiesGivenAt)}` : ''}</span>
            </div>
            ${
              given
                ? `<button type="button" class="btn btn-sm btn-ghost" data-action="goodies-undo" data-participant="${g.id}" data-focus="gundo-${g.id}">Annuler</button>`
                : `<button type="button" class="btn btn-success" data-action="goodies-give" data-participant="${g.id}" data-focus="ggive-${g.id}">Remis</button>`
            }
          </li>`;
        })
        .join('');
    });
  }

  goodiesList.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (btn && state) handleCommonAction(btn);
  });

  // ================================================================ formulaire d'inscription

  const form = $('#register-form');
  const submitBtn = $('#register-submit');
  const formError = $('#form-error');
  const playerSets = [$('#player-0'), $('#player-1')];
  const inputOf = (i, f) => $(`#p${i}-${f}`);
  const msgOf = (i, f) => $(`#p${i}-${f}-msg`);

  // Messages par champ : erreur (validation / serveur) > avertissement serveur (doublon) > doublon dans la paire.
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
      try {
        res = await client.action('check', { email, ticket });
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

  // Les deux joueurs d'une paire ne peuvent pas partager email ou billet.
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
      // Le doublon affiché ne correspond plus à la saisie : on l'efface tout de suite.
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
      if (!p.email.trim()) errors.push([i, 'email', "L'email est obligatoire."]);
      else if (!EMAIL_RE.test(normEmail(p.email))) errors.push([i, 'email', "L'email n'est pas valide."]);
      if (!normTicket(p.ticket)) errors.push([i, 'ticket', 'Le numéro de billet est obligatoire.']);
    });
    if (players.length === 2 && !errors.length) {
      if (normEmail(players[0].email) === normEmail(players[1].email)) errors.push([1, 'email', 'Les deux joueurs ont le même email.']);
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
      if (result.matchId) ownMatches.add(result.matchId);
      const reg = {
        ids: result.participantIds || [],
        players: players.map((p) => ({ firstName: cleanName(p.firstName), lastName: cleanName(p.lastName) })),
        result,
        seq: stateSeq,
        at: Date.now(),
        toastPending: true,
      };
      lastRegistration = reg;
      renderLastRegistration();
      // Le toast part avec l'état à jour (ex. joueur seul associé) ; sinon au bout d'1,5 s.
      setTimeout(() => flushRegistrationToast(reg), 1500);
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

  // ---------------------------------------------------------------- résultat de la dernière inscription

  const regResult = $('#reg-result');

  // Décrit où se trouvent les joueurs de la dernière inscription, d'après l'état le plus récent.
  // Renvoie { tone, who, where, detail, toast, entryId?, canPlaceAnyway?, canCancelAnyway? } (texte brut).
  function describeRegistration(reg) {
    const who = joinNames(reg.players.map(shortName));
    const ids = new Set(reg.ids);
    const loc = state && stateSeq > reg.seq ? reg.ids.map((id) => where.get(id)).find(Boolean) : null;
    const tableInfo = (tableNo, slot, detail) => ({
      tone: 'table',
      who,
      where: `→ Table ${tableNo}, emplacement ${slot}`,
      detail,
      toast: `${who} → Table ${tableNo}, emplacement ${slot}`,
    });

    if (loc && loc.type === 'table') {
      const others = loc.match.players.filter((p) => !ids.has(p.id)).map(shortName);
      return tableInfo(
        loc.table.no,
        loc.slot,
        others.length
          ? `Associé à ${joinNames(others)} (joueur seul déjà en attente).`
          : loc.match.vsAnimator
            ? 'Contre un animateur.'
            : 'Partie lancée : le compte à rebours a démarré.',
      );
    }
    // Stand fermé : les inscrits restent en file, sans placement ni heure de passage.
    const paused = isPaused();
    const pausedText = 'Stand fermé : ne sera pas placé tant que le stand est fermé.';
    const pausedToast = ' (stand fermé : pas de placement)';
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
          toast: `${who} – joueur seul : en attente d'un partenaire${paused ? pausedToast : ''}`,
        };
      }
      return {
        tone: paused ? 'paused' : 'queue',
        who,
        where: `En file d'attente – rang ${e.rank}`,
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
        toast: `${who} – en file d'attente, rang ${e.rank}${others.length ? ` (avec ${joinNames(others)})` : ''}${paused ? pausedToast : ''}`,
      };
    }
    if (!loc && stateSeq <= reg.seq) {
      // L'état à jour n'est pas encore arrivé : on se fie à la réponse du serveur.
      const r = reg.result || {};
      if (r.status === 'playing') return tableInfo(r.tableNo, r.slot, '');
      if (r.status === 'waiting') {
        return {
          tone: paused ? 'paused' : 'queue',
          who,
          where: `En file d'attente – rang ${r.rank}`,
          detail: paused ? pausedText : '',
          toast: `${who} – en file d'attente, rang ${r.rank}${paused ? pausedToast : ''}`,
        };
      }
    }
    return {
      tone: 'muted',
      who,
      where: "Plus en file d'attente ni à une table",
      detail: 'Voir la recherche pour son statut.',
      toast: `${who} inscrit.`,
    };
  }

  function flushRegistrationToast(reg) {
    if (!reg.toastPending) return;
    reg.toastPending = false;
    toast(describeRegistration(reg).toast, 'success');
  }

  function renderLastRegistration() {
    if (!lastRegistration) {
      regResult.hidden = true;
      return;
    }
    if (stateSeq > lastRegistration.seq) flushRegistrationToast(lastRegistration);
    const info = describeRegistration(lastRegistration);
    let actions = '';
    if (info.canPlaceAnyway) {
      actions = `<button type="button" class="btn btn-sm btn-warn-ghost" data-action="place-anyway" data-entry="${info.entryId}" data-focus="r-anyway">Placer quand même (vs animateur)</button>`;
    } else if (info.canCancelAnyway) {
      actions = `<button type="button" class="btn btn-sm btn-ghost" data-action="cancel-anyway" data-entry="${info.entryId}" data-focus="r-cancel">Annuler animateur</button>`;
    }
    const label = Date.now() - lastRegistration.at < 90 * 1000 ? 'Inscription réussie' : 'Dernière inscription';
    const key = JSON.stringify([lastRegistration.at, label, info.tone, info.who, info.where, info.detail, actions]);
    regResult.hidden = false;
    regResult.dataset.tone = info.tone;
    const changed = patch(regResult, key, () => `
      <div class="reg-result-label">${esc(label)}</div>
      <div class="reg-result-who">${esc(info.who)}</div>
      <div class="reg-result-where">${esc(info.where)}</div>
      ${info.detail ? `<div class="reg-result-detail">${esc(info.detail)}</div>` : ''}
      ${actions ? `<div class="reg-result-actions">${actions}</div>` : ''}`);
    if (changed) {
      // relance l'animation d'apparition
      regResult.style.animation = 'none';
      void regResult.offsetWidth;
      regResult.style.animation = '';
      // L'état à jour peut agrandir le cadre juste après l'inscription : on le garde visible.
      if (Date.now() - lastRegistration.at < REVEAL_REG_MS && form.contains(document.activeElement)) revealRegResult();
    }
  }

  // Le cadre est sous le formulaire, souvent sous le bas visible de la colonne (mode 2 joueurs,
  // portable) : on le fait apparaître en gardant visible le prénom du joueur 1, où l'hôtesse retape,
  // mais toujours au moins jusqu'à la ligne à annoncer (table ou rang).
  function revealRegResult() {
    revealInColumn(regResult, { keep: inputOf(0, 'firstName'), must: $('.reg-result-where', regResult) });
  }

  regResult.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (btn && state) handleCommonAction(btn);
  });

  // ================================================================ recherche

  const searchInput = $('#search-input');
  const searchBox = $('#search-results');
  const searchPanel = $('.panel-search');
  let searchSeq = 0;
  let revealedQuery = null; // dernière recherche dont les résultats ont été montrés à l'écran

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
    if (e.key === 'Escape' && searchInput.value) {
      e.preventDefault();
      searchInput.value = '';
      doSearch();
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
        return 'Partie interrompue par la nouvelle journée';
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
      `<button type="button" class="btn btn-sm btn-ghost" data-action="edit" data-participant="${p.id}" data-focus="s-edit-${p.id}">Modifier</button>`,
    ];
    if (status === 'waiting') {
      actions.push(
        `<button type="button" class="btn btn-sm btn-danger-ghost" data-action="remove" data-participant="${p.id}" data-focus="s-remove-${p.id}">Retirer</button>`,
      );
    }
    if (status === 'completed') {
      actions.push(
        p.goodiesGivenAt
          ? `<button type="button" class="btn btn-sm btn-ghost" data-action="goodies-undo" data-participant="${p.id}" data-focus="s-gundo-${p.id}">Annuler la remise</button>`
          : `<button type="button" class="btn btn-sm btn-success" data-action="goodies-give" data-participant="${p.id}" data-focus="s-ggive-${p.id}">Goodies remis</button>`,
      );
    }
    return `<article class="result">
      <div class="result-head">
        <span class="result-name">${esc(fullName(p))}</span>
        <span class="pill pill-${esc(status)}">${esc(label)}</span>
      </div>
      <div class="result-meta">${esc(p.email)} · billet ${esc(p.ticket)}</div>
      <div class="result-meta">Jour ${p.dayNumber} · ${esc(created)}</div>
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
    if (searchResults === null) revealedQuery = null;
    else {
      // Les résultats s'affichent sous le champ, en bas de la colonne : on les fait apparaître
      // à chaque nouvelle recherche (pas lors des simples rafraîchissements de statut).
      if (searchQuery !== revealedQuery && searchPanel.contains(document.activeElement)) {
        revealedQuery = searchQuery;
        revealSearchResults();
      }
      refreshSearchIfStale();
    }
  }

  function revealSearchResults() {
    revealInColumn(searchResults !== null ? searchBox : searchInput, { keep: searchPanel });
  }

  // Après un nouvel état, relance la recherche (les statuts ont pu changer).
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
    try {
      res = await client.action('check', {
        email: editInput('email').value.trim(),
        ticket: editInput('ticket').value.trim(),
        excludeParticipantId: editingId,
      });
    } catch {
      return;
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
      label.innerHTML = `<input type="checkbox" data-table="${no}" aria-label="Table ${no} en service">
        <span class="toggle-name">Table ${no}</span><span class="toggle-state"></span>`;
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
          ? "joueurs en attente seront retirés de la file (ils pourront se réinscrire)."
          : "joueur en attente sera retiré de la file (il pourra se réinscrire).",
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
    // La nouvelle journée rouvre toujours le stand.
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

  $('#btn-newday').addEventListener('click', openNewDay);

  // Bouton « Nouvelle journée… » proposé dans la confirmation « Rouvrir le stand ? » le matin.
  $('#confirm-body').addEventListener('click', (e) => {
    if (!e.target.closest('[data-open-newday]')) return;
    closeDialog($('#confirm-dialog')); // la confirmation est annulée (événement « close »)
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

  // ================================================================ comptes à rebours

  function tick() {
    const t = now();
    renderStandState(); // passage au mode « matin » sans attendre un nouvel état
    for (const el of $$('[data-ends-at]')) {
      const left = Number(el.dataset.endsAt) - t;
      const text = left > 0 ? LC.formatRemaining(left) : 'Terminé';
      if (el.textContent !== text) el.textContent = text;
      const warn = left > 0 && left <= WARN_MS;
      el.classList.toggle('is-warn', warn);
      el.classList.toggle('is-over', left <= 0);
      const slot = el.closest('.slot');
      if (slot) slot.classList.toggle('is-warn', warn);
    }
    for (const el of $$('[data-since]')) {
      const text = formatWait(t - Number(el.dataset.since));
      if (el.textContent !== text) el.textContent = text;
    }
    for (const el of $$('[data-new-until]')) {
      const fresh = t < Number(el.dataset.newUntil);
      el.hidden = !fresh;
      const slot = el.closest('.slot');
      if (slot) slot.classList.toggle('is-new', fresh);
    }
    // « Absent » disparaît de lui-même à la fin du délai, sans attendre un nouvel état.
    for (const el of $$('[data-noshow-until]')) {
      const open = t < Number(el.dataset.noshowUntil);
      if (el.hidden !== !open) {
        if (!open && document.activeElement === el) {
          const release = el.closest('.slot')?.querySelector('.slot-release');
          if (release) release.focus({ preventScroll: true });
        }
        el.hidden = !open;
      }
    }
  }

  function loop() {
    tick();
    setTimeout(loop, 1000 - (now() % 1000) + 15);
  }

  // ================================================================ raccourcis clavier

  document.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || anyDialogOpen()) return;
    if (e.code === 'Digit1' || e.code === 'Numpad1') {
      e.preventDefault();
      setMode(1);
    } else if (e.code === 'Digit2' || e.code === 'Numpad2') {
      e.preventDefault();
      setMode(2);
    } else if (e.code === 'KeyR') {
      e.preventDefault();
      searchInput.focus({ preventScroll: true });
      searchInput.select();
      revealSearchResults();
    } else if (e.code === 'KeyN') {
      e.preventDefault();
      inputOf(0, 'firstName').focus();
    }
  });

  // ================================================================ démarrage

  // Hauteur de la barre du haut et des bandeaux (pour les zones collantes sur petits écrans).
  const topSticky = $('#top-sticky');
  const setTopbarHeight = () =>
    document.documentElement.style.setProperty('--acc-topbar-h', `${topSticky.offsetHeight}px`);
  if (window.ResizeObserver) new ResizeObserver(setTopbarHeight).observe(topSticky);
  setTopbarHeight();

  buildTables();
  buildToggles();
  applyMode();
  queueList.innerHTML = '<li class="empty">Chargement…</li>';
  goodiesList.innerHTML = '<li class="empty">Chargement…</li>';

  client = LC.connect({
    onState,
    onStatus: setConnection,
    onSession: (session) => {
      if (!session || !session.admin) window.location.href = '/login';
    },
  });

  loop();
  inputOf(0, 'firstName').focus();
})();
