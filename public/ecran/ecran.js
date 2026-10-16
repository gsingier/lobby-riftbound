// Écran TV public (/ecran) : plan des 9 tables (2 matchs 1v1 par table), attente estimée pour une
// nouvelle inscription, joueurs qui viennent d'être placés (« À vos tables ! »), file d'attente
// (par pages qui défilent quand elle est longue : chaque nom passe à l'écran).
// Re-rendu différentiel à chaque événement 'state' ; comptes à rebours mis à jour chaque seconde.
// N'affiche que « Prénom N. » (projection publique du serveur) ; tout texte est échappé.
(function () {
  'use strict';

  const LC = window.LobbyClient;
  const esc = LC.escapeHtml;
  const SLOT_NAMES = ['A', 'B'];
  const MIN = 60 * 1000;
  const WARN_MS = 5 * MIN;
  // Étiquette « Nouveau » sur le plan et liste « À vos tables ! » : même durée, pour que la ligne
  // « + N autres : étiquette « Nouveau » sur le plan » renvoie toujours à des étiquettes visibles.
  const PLACED_MS = 3 * MIN;
  const NEW_MS = PLACED_MS;
  const PLACED_MAX = 2;
  const BATCH_GAP_MS = 10 * 1000; // placements à moins de 10 s d'intervalle = un même lot
  const NEXT_HIGHLIGHT = 2;
  const SEATED_ANIM_MS = 2800;
  const IMMINENT_MS = 2 * MIN;
  const PAGE_MS = 10 * 1000; // file longue : une page toutes les 10 s
  // Place minimale de la file (en lignes d'une carte + espacement) avant de réduire « À vos tables ! ».
  // QUEUE_ROW_U : pas d'une ligne d'après le CSS (carte de 5u + 0,25u), quand il n'y a rien à mesurer.
  const QUEUE_MIN_ROWS = { paysage: 8, portrait: 6 };
  const QUEUE_ROW_U = 5.25;

  const root = document.documentElement;
  const $ = (id) => document.getElementById(id);
  const els = {
    clock: $('clock'),
    conn: $('conn'),
    tables: $('tables'),
    freeCount: $('freeCount'),
    masthead: document.querySelector('.masthead'),
    meta: document.querySelector('.masthead .meta'),
    side: $('side'),
    wait: $('wait'),
    waitEyebrow: $('waitEyebrow'),
    waitValue: $('waitValue'),
    waitSub: $('waitSub'),
    placed: $('placed'),
    placedList: $('placedList'),
    queueCount: $('queueCount'),
    queueCountLabel: $('queueCountLabel'),
    queueList: $('queueList'),
    queueEmpty: $('queueEmpty'),
    queueEmptySub: $('queueEmptySub'),
    queueClosed: $('queueClosed'),
    queueClosedNote: $('queueClosedNote'),
    howto: $('howto'),
  };

  // ---------------------------------------------------------------- orientation

  // ?orientation=portrait|paysage force la mise en page ; sinon media query (orientation).
  // ?rotation=90|-90|180 fait pivoter l'affichage (TV tournée sans rotation côté source).
  const params = new URLSearchParams(window.location.search);
  const pick = (map, key) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null);
  const forcedLayout = pick(
    { portrait: 'portrait', paysage: 'paysage', landscape: 'paysage' },
    String(params.get('orientation') || '').toLowerCase(),
  );
  const rotation = pick({ 90: '90', '-90': '-90', 270: '-90', 180: '180' }, String(params.get('rotation') || ''));
  if (rotation) root.dataset.rotation = rotation;
  const portraitQuery = window.matchMedia('(orientation: portrait)');

  const isPortrait = () => root.dataset.layout === 'portrait';

  // Paysage : la carte d'attente rejoint l'en-tête, entre « Paris Games Week » et l'horloge (place
  // libre), pour laisser toute la colonne de droite à « À vos tables ! » et à la file. Portrait :
  // l'en-tête est trop étroit, elle reste au-dessus de la file.
  function placeWait() {
    if (isPortrait()) {
      if (els.wait.parentElement !== els.side) els.side.insertBefore(els.wait, els.side.firstChild);
    } else if (els.wait.parentElement !== els.masthead) {
      els.masthead.insertBefore(els.wait, els.meta);
    }
  }

  function applyLayout() {
    let portrait = portraitQuery.matches;
    if (rotation === '90' || rotation === '-90') portrait = !portrait;
    const layout = forcedLayout || (portrait ? 'portrait' : 'paysage');
    if (root.dataset.layout !== layout) root.dataset.layout = layout;
    placeWait();
  }
  applyLayout();
  portraitQuery.addEventListener('change', () => {
    applyLayout();
    scheduleFit();
  });

  // ---------------------------------------------------------------- utilitaires

  // « Prénom N. » : le prénom (.fn) peut être raccourci par « … », l'initiale (.ini) reste visible.
  function nameHtml(name) {
    const m = /^(.*\S\s+)(\S{1,3}\.)$/u.exec(String(name ?? ''));
    const initial = m ? `<span class="ini">${esc(m[2])}</span>` : '';
    return `<span class="nm"><span class="fn">${esc(m ? m[1] : name)}</span>${initial}</span>`;
  }

  // Débordement d'un nom, en px (avec 1 px de marge : les largeurs mesurées sont arrondies, et un
  // dépassement d'une fraction de pixel suffit à faire apparaître « … »).
  function nameOverflow(nm) {
    const fn = nm.firstElementChild;
    const ini = fn.nextElementSibling;
    const need = fn.scrollWidth + (ini ? ini.offsetWidth : 0) + 1;
    return Math.max(need - nm.clientWidth, fn.scrollWidth - fn.clientWidth);
  }

  // L'emplacement tient-il dans sa zone de contenu ? Le padding réserve le cadre d'état
  // (« 5 dernières minutes », « Nouveau ») : un nom qui y déborde toucherait le cadre. (scrollHeight
  // ne le voit pas : un débordement dans le padding ne compte pas.)
  function slotFits(slot) {
    const last = slot.querySelector('.pl2');
    if (!last) return true;
    const cs = getComputedStyle(slot);
    const limit = slot.getBoundingClientRect().bottom - parseFloat(cs.paddingBottom) - parseFloat(cs.borderBottomWidth);
    return last.getBoundingClientRect().bottom <= limit + 0.5;
  }

  // Noms du plan, jamais coupés tant qu'il reste une solution : police réduite (jusqu'à 0,78),
  // puis deux lignes (« Marie- / Charlotte D. ») si l'emplacement a la hauteur, puis police plus
  // petite (jusqu'à `min`), puis deux lignes dans un emplacement resserré (anneau du chrono
  // masqué, chiffres ≥ 34 px), et seulement en dernier recours « … » sur le prénom.
  function fitNames(scope, min) {
    const names = [...scope.querySelectorAll('.nm')];
    for (const nm of names) {
      nm.style.fontSize = '';
      nm.classList.remove('cut', 'wrap');
    }
    for (const slot of scope.querySelectorAll('.slot.compact')) slot.classList.remove('compact');
    const ratioOf = (nm) => {
      const excess = nameOverflow(nm);
      return nm.clientWidth > 0 && excess > 0 ? nm.clientWidth / (nm.clientWidth + excess) : 1;
    };
    const ratios = names.map(ratioOf);
    names.forEach((nm, i) => {
      if (ratios[i] < 1) nm.style.fontSize = `${Math.max(0.78, ratios[i] * 0.97).toFixed(3)}em`;
    });
    // Les noms les plus longs d'abord : dans un emplacement, c'est lui qui passe sur deux lignes.
    const order = names.map((nm, i) => [nm, ratios[i]]).sort((a, b) => a[1] - b[1]).map(([nm]) => nm);
    for (const nm of order) {
      if (nameOverflow(nm) <= 0) continue;
      const slot = nm.closest('.slot');
      // Deux lignes seulement si le prénom se coupe (tiret, espace) : jamais l'initiale seule.
      const breakable = !!slot && /[\s\-‐]\S/u.test(nm.firstElementChild.textContent.trim());
      const single = (size) => {
        nm.classList.remove('wrap');
        nm.style.fontSize = '';
        nm.style.fontSize = `${Math.max(size, ratioOf(nm) * 0.97).toFixed(3)}em`;
        return nameOverflow(nm) <= 0;
      };
      const wrap = (sizes) => {
        for (const k of sizes) {
          nm.classList.add('wrap');
          nm.style.fontSize = `${k}em`;
          const lines = Math.round(nm.scrollHeight / (parseFloat(getComputedStyle(nm).lineHeight) || 1));
          if (nm.scrollWidth <= nm.clientWidth + 1 && lines <= 2 && slotFits(slot)) return true;
        }
        return false;
      };
      if (breakable && wrap([0.9, 0.8])) continue;
      if (single(min)) continue;
      if (breakable && !slot.classList.contains('compact')) {
        slot.classList.add('compact');
        if (wrap([0.9, 0.8, 0.74])) continue;
        slot.classList.remove('compact');
      }
      single(min);
      if (nameOverflow(nm) > 0) nm.classList.add('cut');
    }
  }

  function plural(n, one, many) {
    return n > 1 ? many : one;
  }

  function isClosed(state) {
    return !!(state && state.settings && state.settings.placementsPaused);
  }

  function activeMatchCount(state) {
    return state.tables.reduce((n, t) => n + SLOT_NAMES.filter((s) => t.slots[s]).length, 0);
  }

  function freeSlotCount(state) {
    return state.tables.reduce((n, t) => n + (t.enabled ? SLOT_NAMES.filter((s) => !t.slots[s]).length : 0), 0);
  }

  // Attente annoncée au public (même règle que l'accueil) : à la minute supérieure sous 10 min,
  // puis aux 5 minutes SUPÉRIEURES (12 min → « ~15 min ») pour ne jamais sous-estimer.
  function waitLabel(ms) {
    let minutes = Math.max(1, Math.ceil(ms / MIN));
    if (minutes >= 10) minutes = Math.ceil(minutes / 5) * 5;
    if (minutes < 60) return { num: String(minutes), unit: 'min' };
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return { num: m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`, unit: '' };
  }

  // ---------------------------------------------------------------- plan des tables

  const tableViews = new Map();
  const timers = new Map();
  const seatedAt = new Map();
  let firstRender = true;

  // Places à la table : joueur 1 = chaise du haut, joueur 2 = chaise du bas. L'état public ne
  // contient que les joueurs encore en jeu : après « Absent », il faut savoir lequel reste. On
  // utilise `seat` (1 | 2) si le serveur le fournit, sinon l'ordre de la paire mémorisé tant
  // qu'elle était complète (conservé au rechargement de la page, sans donnée personnelle : des
  // numéros internes). Inconnue (joueur seul dès l'inscription) : joueur en haut, animateur en bas.
  const SEATS_KEY = 'rb-ecran-seats';
  const seatMemory = new Map();
  try {
    const saved = JSON.parse(window.localStorage.getItem(SEATS_KEY) || '[]');
    if (Array.isArray(saved)) {
      for (const row of saved) {
        if (Array.isArray(row) && row.length === 2 && Array.isArray(row[1])) seatMemory.set(row[0], row[1]);
      }
    }
  } catch {
    // Stockage indisponible (navigation privée, kiosque) : mémoire de la session seulement.
  }

  function saveSeats() {
    try {
      window.localStorage.setItem(SEATS_KEY, JSON.stringify([...seatMemory]));
    } catch {
      // Sans stockage, la mémoire vit le temps de la page.
    }
  }

  // { top, bottom, host } : joueurs (ou null) sur les chaises du haut et du bas ; host = chaise de
  // l'animateur ('top' | 'bottom' | null).
  function seatsOf(match) {
    const players = match.players || [];
    if (players.length >= 2) {
      const ids = [players[0].id, players[1].id];
      const known = seatMemory.get(match.matchId);
      if (ids.every((id) => id !== undefined && id !== null) && (!known || known[0] !== ids[0] || known[1] !== ids[1])) {
        seatMemory.set(match.matchId, ids);
        saveSeats();
      }
      const [a, b] = players[0].seat === 2 || players[1].seat === 1 ? [players[1], players[0]] : players;
      return { top: a, bottom: b, host: null };
    }
    const p = players[0] || null;
    let seat = p && (p.seat === 1 || p.seat === 2) ? p.seat : null;
    if (!seat && p) {
      const known = seatMemory.get(match.matchId);
      const i = known ? known.indexOf(p.id) : -1;
      if (i >= 0) seat = i + 1;
    }
    return seat === 2 ? { top: null, bottom: p, host: 'top' } : { top: p, bottom: null, host: 'bottom' };
  }

  function forgetSeats(activeIds) {
    let changed = false;
    for (const id of seatMemory.keys()) {
      if (!activeIds.has(id)) {
        seatMemory.delete(id);
        changed = true;
      }
    }
    if (changed) saveSeats();
  }

  // Lettres A / B dans la rangée des chaises du haut, aux coins extérieurs de la table (« A ▬ ④ ▬ B ») :
  // grandes et fixes, elles laissent toute la place de l'emplacement aux noms et à l'anneau du chrono.
  // Étiquette « Nouveau » : une par table, ENTRE les deux chaises du bas (elle ne cache aucune chaise,
  // ni celle de l'animateur) ; le cadre cyan désigne le ou les emplacements concernés.
  function buildTables(tables) {
    els.tables.textContent = '';
    tableViews.clear();
    timers.clear();
    for (const t of tables) {
      const el = document.createElement('div');
      el.className = 'table';
      el.innerHTML =
        '<div class="chairs top"><span class="tag tag-a">A</span><span class="chair"></span><span class="chair"></span><span class="tag tag-b">B</span></div>' +
        `<span class="num">${esc(t.no)}</span>` +
        '<div class="board"><div class="slot" data-slot="A"></div><div class="slot" data-slot="B"></div></div>' +
        '<div class="chairs bottom"><span class="chair"></span><span class="chair"></span><span class="new-tag">Nouveau</span></div>';
      const top = el.querySelectorAll('.chairs.top .chair');
      const bottom = el.querySelectorAll('.chairs.bottom .chair');
      tableViews.set(t.no, {
        el,
        board: el.querySelector('.board'),
        chairs: { A: [top[0], bottom[0]], B: [top[1], bottom[1]] },
        slotKeys: { A: null, B: null },
        key: null,
        fresh: false,
      });
      els.tables.appendChild(el);
    }
  }

  function slotKey(table, name, closed) {
    const s = table.slots[name];
    if (!s) return `free:${table.enabled}:${closed}`;
    const seats = seatsOf(s);
    const who = (p) => (p ? [p.id, p.displayName] : null);
    return JSON.stringify([s.matchId, s.startedAt, s.endsAt, s.vsAnimator, who(seats.top), who(seats.bottom), seats.host]);
  }

  function renderBoard(view, table, closed) {
    const bothFree = !table.slots.A && !table.slots.B;
    const whole = bothFree && !table.enabled ? 'off-all' : bothFree && closed ? 'shut-all' : null;
    view.el.classList.toggle('off', !table.enabled);
    view.el.classList.toggle('off-all', whole === 'off-all');
    view.el.classList.toggle('shut-all', whole === 'shut-all');

    if (whole) {
      if (view.key === whole) return;
      view.key = whole;
      view.slotKeys = { A: null, B: null };
      for (const name of SLOT_NAMES) timers.delete(`${table.no}${name}`);
      view.board.innerHTML = whole === 'off-all'
        ? '<div class="whole-label">Hors service</div>'
        : '<div class="whole-label shut"><span class="moon" aria-hidden="true"></span>Fermé</div>';
      for (const name of SLOT_NAMES) setChairs(view, name, null, false);
      return;
    }
    if (view.key !== 'slots' || !view.board.querySelector('.slot')) {
      view.board.innerHTML = '<div class="slot" data-slot="A"></div><div class="slot" data-slot="B"></div>';
      view.slotKeys = { A: null, B: null };
    }
    view.key = 'slots';
    const slotEls = view.board.querySelectorAll('.slot');
    SLOT_NAMES.forEach((name, i) => {
      const key = slotKey(table, name, closed);
      if (view.slotKeys[name] === key) return;
      view.slotKeys[name] = key;
      renderSlot(slotEls[i], table, name, closed);
      setChairs(view, name, table.slots[name], table.enabled && !closed);
    });
  }

  // Chaises d'un emplacement : occupées (irisé), animateur (mauve), libres et ouvertes (pointillés
  // orange), sinon inutilisées (stand fermé, hors service).
  function setChairs(view, name, match, open) {
    const [top, bottom] = view.chairs[name];
    const host = match ? seatsOf(match).host : null;
    for (const chair of [top, bottom]) {
      chair.classList.toggle('taken', !!match);
      chair.classList.toggle('free', !match && open);
    }
    top.classList.toggle('host', host === 'top');
    bottom.classList.toggle('host', host === 'bottom');
  }

  function renderSlot(el, table, name, closed) {
    const id = `${table.no}${name}`;
    const match = table.slots[name];
    timers.delete(id);
    el.dataset.slot = name;
    el.style.removeProperty('--seated-delay');

    if (!match) {
      if (!table.enabled) {
        el.className = 'slot off';
        el.innerHTML = '<span class="state-label">Hors<br>service</span>';
      } else if (closed) {
        // Stand fermé : surtout pas « Libre », qui inviterait à venir s'asseoir.
        el.className = 'slot shut';
        el.innerHTML = '<span class="state-label"><span class="moon" aria-hidden="true"></span>Fermé</span>';
      } else {
        el.className = 'slot free';
        el.innerHTML = '<span class="free-label">Libre</span>';
      }
      return;
    }

    // Un seul joueur (contre un animateur dès l'inscription, ou partenaire déclaré absent) :
    // l'animateur prend la chaise libre (celle de l'absent).
    const seats = seatsOf(match);
    const line = (p, cls) => (p
      ? `<div class="pl ${cls}">${nameHtml(p.displayName)}</div>`
      : `<div class="pl ${cls} animator"><span class="anim-pill">Animateur</span></div>`);
    // Chrono : anneau de progression irisé autour du « VS » (part restante, --p mis à jour chaque
    // seconde par tick() sans re-rendu), temps restant à côté (dessous en portrait).
    el.className = 'slot busy';
    el.innerHTML =
      '<span class="fx" aria-hidden="true"></span>' +
      line(seats.top, 'pl1') +
      '<div class="mid"><span class="ring rb-ring"><span class="vs-word">VS</span></span><span class="time"></span></div>' +
      line(seats.bottom, 'pl2');

    // Nouveaux joueurs installés pendant que la page est ouverte : reflet irisé (une fois).
    if (!firstRender && !seatedAt.has(match.matchId)) seatedAt.set(match.matchId, Date.now());
    if (firstRender) seatedAt.set(match.matchId, 0);
    const since = Date.now() - (seatedAt.get(match.matchId) || 0);
    if (since < SEATED_ANIM_MS) {
      el.classList.add('seated');
      el.style.setProperty('--seated-delay', `${-since}ms`);
      setTimeout(() => el.classList.remove('seated'), SEATED_ANIM_MS - since);
    }

    timers.set(id, {
      slot: el,
      table: table.no,
      timeEl: el.querySelector('.time'),
      ringEl: el.querySelector('.ring'),
      startedAt: match.startedAt,
      endsAt: match.endsAt,
      phase: null,
      fresh: null,
      text: null,
      part: null,
      long: null,
    });
  }

  function renderTables(state) {
    if (tableViews.size !== state.tables.length) buildTables(state.tables);
    const closed = isClosed(state);
    let free = 0;
    let total = 0;
    for (const table of state.tables) {
      renderBoard(tableViews.get(table.no), table, closed);
      if (table.enabled) {
        total += SLOT_NAMES.length;
        free += SLOT_NAMES.filter((n) => !table.slots[n]).length;
      }
    }
    const active = new Set(state.tables.flatMap((t) => SLOT_NAMES.map((n) => t.slots[n] && t.slots[n].matchId)));
    for (const id of seatedAt.keys()) if (!active.has(id)) seatedAt.delete(id);
    forgetSeats(active);

    if (closed) {
      const playing = activeMatchCount(state);
      els.freeCount.classList.remove('has-free');
      els.freeCount.innerHTML = playing
        ? `${plural(playing, 'Partie en cours', 'Parties en cours')} <b>${playing}</b>`
        : 'Aucune partie en cours';
    } else {
      els.freeCount.classList.toggle('has-free', free > 0);
      els.freeCount.innerHTML = total
        ? `Places libres <b>${free}</b><span class="of">/ ${total}</span>`
        : 'Aucune table ouverte';
    }
    firstRender = false;
  }

  // ---------------------------------------------------------------- attente estimée

  let waitKey = '';

  // « Attente estimée pour une nouvelle inscription : ~X min » (même calcul que l'accueil : estimate()).
  // Renvoie true si la carte a changé (la file en dessous change alors de hauteur).
  function renderWait(state, now) {
    if (!state || isClosed(state)) {
      const changed = !els.wait.hidden;
      els.wait.hidden = true;
      waitKey = '';
      return changed;
    }
    const est = LC.estimate(state, now);
    const free = freeSlotCount(state);
    let mode;
    let value;
    let sub;
    // Sur-titre en segments insécables : une coupure ne peut tomber qu'après « · ».
    const seg = (a, b) => `<span class="nb">${a}&nbsp;·</span> <span class="nb">${b}</span>`;
    let eyebrow = seg('Attente estimée', 'nouvelle inscription');
    if (est.newcomerAt === null) {
      mode = 'none';
      value = '<span class="wv-text">Tables momentanément indisponibles</span>';
      sub = 'Renseignez-vous à l’accueil';
    } else if (free > 0 && est.newcomerAt - now < MIN) {
      mode = 'free';
      eyebrow = seg('Nouvelle inscription', 'pas d’attente');
      value =
        `<span class="wv-num">${free}</span>` +
        `<span class="wv-text">${plural(free, 'place libre', 'places libres')} maintenant&nbsp;!</span>`;
      sub = '';
    } else {
      mode = 'wait';
      const w = waitLabel(est.newcomerAt - now);
      // « ~1 h 30 » : heures et minutes en grand, « h » en plus petit.
      const hm = /^(\d+) h(?: (\d+))?$/.exec(w.num);
      value = '<span class="wv-tilde">~</span>' + (hm
        ? `<span class="wv-num">${esc(hm[1])}</span><span class="wv-unit">h</span>${hm[2] ? `<span class="wv-num">${esc(hm[2])}</span>` : ''}`
        : `<span class="wv-num">${esc(w.num)}</span>${w.unit ? `<span class="wv-unit">${w.unit}</span>` : ''}`);
      sub = `début de partie vers <b>${esc(LC.formatClock(est.newcomerAt))}</b>`;
    }
    const key = `${mode}|${eyebrow}|${value}|${sub}`;
    const wasHidden = els.wait.hidden;
    els.wait.hidden = false;
    if (key === waitKey) return wasHidden;
    waitKey = key;
    els.wait.dataset.mode = mode;
    els.waitEyebrow.innerHTML = eyebrow;
    els.waitValue.innerHTML = value;
    els.waitSub.innerHTML = sub;
    els.waitSub.hidden = !sub;
    return true;
  }

  // ---------------------------------------------------------------- « À vos tables ! »

  let placedKey = '';
  let placedMax = PLACED_MAX;

  // Parties commencées depuis moins de 3 minutes (heure du serveur : juste après un rechargement aussi).
  // Les placements faits ensemble (ouverture, réouverture, tables remises en service : quelques
  // millisecondes d'écart) forment un lot : lot le plus récent d'abord, puis ordre du plan (1 A, 1 B, 2 A…).
  function recentMatches(state, now) {
    const list = [];
    for (const t of state.tables) {
      for (const s of SLOT_NAMES) {
        const m = t.slots[s];
        if (m && now - m.startedAt < PLACED_MS && m.endsAt > now) list.push({ no: t.no, slot: s, m });
      }
    }
    list.sort((a, b) => b.m.startedAt - a.m.startedAt);
    let batch = 0;
    list.forEach((x, i) => {
      if (i > 0 && list[i - 1].m.startedAt - x.m.startedAt > BATCH_GAP_MS) batch += 1;
      x.batch = batch;
    });
    return list.sort((a, b) => a.batch - b.batch || a.no - b.no || a.slot.localeCompare(b.slot));
  }

  function renderPlaced(state, now) {
    const recent = state ? recentMatches(state, now) : [];
    const shown = recent.slice(0, placedMax);
    const key = JSON.stringify(shown.map((x) => [x.m.matchId, x.no, x.slot, x.m.vsAnimator, x.m.players.map((p) => p.displayName)]).concat(recent.length));
    if (key === placedKey) return false;
    placedKey = key;
    els.placed.hidden = !shown.length;
    els.side.classList.toggle('has-placed', shown.length > 0);
    if (!shown.length) {
      els.placedList.textContent = '';
      return true;
    }
    const rows = shown.map(({ no, slot, m }) => {
      const [a, b] = m.players;
      const who = b
        ? `<span class="pn">${nameHtml(a.displayName)}</span><span class="pn"><span class="amp">&amp;</span>${nameHtml(b.displayName)}</span>`
        : `<span class="pn">${nameHtml(a ? a.displayName : 'Joueur')}</span><span class="vs-host">contre un animateur</span>`;
      return `<li><span class="where"><small>Table</small>${esc(no)}<i>${slot}</i></span><span class="placed-names">${who}</span></li>`;
    });
    const rest = recent.length - shown.length;
    if (rest > 0) {
      rows.push(`<li class="more">+ ${rest} ${plural(rest, 'autre', 'autres')}&nbsp;: étiquette «&nbsp;Nouveau&nbsp;» sur le plan</li>`);
    }
    els.placedList.innerHTML = rows.join('');
    fitPlacedNames();
    return true;
  }

  // Noms de « À vos tables ! » jamais coupés au bord du panneau : police réduite (jusqu'à 0,8),
  // puis deux lignes si le prénom se coupe (tiret, espace), et en dernier recours « … » sur le
  // prénom seulement : l'initiale du nom reste visible.
  // Débordement d'un nom par rapport à la largeur de la ligne (moins « & » pour le second joueur) :
  // le nom prend la largeur de son texte, on le compare donc à la place offerte, pas à sa boîte.
  function placedOverflow(nm) {
    const fn = nm.firstElementChild;
    const ini = fn.nextElementSibling;
    const pn = nm.parentElement;
    const gap = parseFloat(getComputedStyle(pn).columnGap) || 0;
    let avail = pn.parentElement.clientWidth;
    for (const kid of pn.children) if (kid !== nm) avail -= kid.offsetWidth + gap;
    return { over: fn.scrollWidth + (ini ? ini.offsetWidth : 0) + 1 - avail, avail };
  }

  function fitPlacedNames() {
    for (const nm of els.placedList.querySelectorAll('.nm')) {
      nm.style.fontSize = '';
      nm.classList.remove('cut', 'wrap');
      const first = placedOverflow(nm);
      if (first.over <= 0) continue;
      const ratio = first.avail > 0 ? first.avail / (first.avail + first.over) : 1;
      nm.style.fontSize = `${Math.max(0.8, ratio * 0.97).toFixed(3)}em`;
      if (placedOverflow(nm).over <= 0) continue;
      if (/[\s\-‐]\S/u.test(nm.firstElementChild.textContent.trim())) {
        nm.style.fontSize = '0.9em';
        nm.classList.add('wrap');
        const lines = Math.round(nm.scrollHeight / (parseFloat(getComputedStyle(nm).lineHeight) || 1));
        if (nm.scrollWidth <= nm.clientWidth + 1 && lines <= 2) continue;
        nm.classList.remove('wrap');
        nm.style.fontSize = '0.8em';
      }
      if (placedOverflow(nm).over > 0) nm.classList.add('cut');
    }
  }

  // ---------------------------------------------------------------- file d'attente

  let lastState = null;
  let queueHtml = '';

  function etaHtml(at, now) {
    if (at === undefined) return '';
    if (at - now < IMMINENT_MS) return '<span class="eta soon">Imminent</span>';
    return `<span class="eta">vers ${esc(LC.formatClock(at))}</span>`;
  }

  function renderQueue(state, now, force) {
    const queue = state.queue || [];
    const players = queue.reduce((n, e) => n + e.players.length, 0);
    els.queueCount.textContent = String(players);
    els.queueCountLabel.textContent = plural(players, 'joueur en attente', 'joueurs en attente');

    // Stand fermé : message de fin de journée à la place de la file (personne ne sera placé).
    const closed = isClosed(state);
    els.queueClosed.hidden = !closed;
    if (closed) {
      els.queueEmpty.hidden = true;
      els.queueList.hidden = true;
      els.queueList.textContent = '';
      queueHtml = '';
      els.queueClosedNote.hidden = players === 0;
      els.queueClosedNote.innerHTML = players
        ? 'Encore en file d’attente&nbsp;? <b>Renseignez-vous à l’accueil.</b>'
        : '';
      return true;
    }

    const empty = queue.length === 0;
    els.queueEmpty.hidden = !empty;
    els.queueList.hidden = empty;
    if (empty) {
      els.queueList.textContent = '';
      queueHtml = '';
      const free = freeSlotCount(state);
      els.queueEmptySub.textContent = free > 0
        ? `${free} ${plural(free, 'place libre', 'places libres')} en ce moment`
        : 'Vous serez placé dès qu’une table se libère';
      return true;
    }

    const { etas } = LC.estimate(state, now);
    let highlight = NEXT_HIGHLIGHT;
    const html = queue
      .map((entry) => {
        const isNext = entry.ready && highlight-- > 0;
        const rank = `<span class="rank">${esc(entry.rank)}</span>`;
        const tail = isNext ? '<span class="soon-tag">À suivre</span>' : entry.ready ? etaHtml(etas.get(entry.entryId), now) : '';
        if (entry.kind === 'pair') {
          const [a, b] = entry.players;
          return (
            `<li class="q pair${isNext ? ' next' : ''}" data-rank="${esc(entry.rank)}">${rank}` +
            `<span class="names">${nameHtml(a.displayName)}<span class="amp">&amp;</span>${nameHtml(b.displayName)}</span>` +
            `${tail}</li>`
          );
        }
        const solo = entry.players[0] || { displayName: '' };
        if (entry.ready) {
          return (
            `<li class="q solo vs-host${isNext ? ' next' : ''}" data-rank="${esc(entry.rank)}">${rank}` +
            `<span class="names">${nameHtml(solo.displayName)}` +
            '<span class="note">contre un animateur</span></span>' +
            `${tail}</li>`
          );
        }
        return (
          `<li class="q solo seeking" data-rank="${esc(entry.rank)}">${rank}<span class="body">` +
          `<span class="names">${nameHtml(solo.displayName)}` +
          '<span class="note">cherche un partenaire</span></span>' +
          '<span class="invite">Venu seul&nbsp;? <b>Inscrivez-vous</b> pour jouer ensemble&nbsp;!</span>' +
          '</span></li>'
        );
      })
      .join('');
    if (!force && html === queueHtml) return false;
    queueHtml = html;
    els.queueList.innerHTML = html;
    return true;
  }

  // ---------------------------------------------------------------- ajustement de la file

  // Une entrée a-t-elle un texte coupé ? On mesure les noms à leur largeur naturelle (classe
  // « measuring » : rien ne rétrécit) et on compare à la place disponible, avec 1 px de marge.
  function entryCut(li) {
    const names = li.querySelector('.names');
    if (!names) return false;
    li.classList.add('measuring');
    let right = 0;
    for (const kid of names.children) {
      if (kid.offsetParent) right = Math.max(right, kid.offsetLeft + kid.offsetWidth);
    }
    const cut = right - names.offsetLeft + 1 > names.clientWidth;
    li.classList.remove('measuring');
    return cut;
  }

  // Noms jamais coupés tant qu'il reste une solution : police un peu réduite, puis paire sur deux
  // lignes (un joueur par ligne), puis pastille « À suivre » compacte ou heure estimée masquée, puis
  // police réduite, puis « À suivre » sous les noms, puis « … ». La pastille « À suivre » n'est
  // jamais masquée : c'est le seul repère écrit « vous jouez bientôt ».
  function fitEntry(li) {
    if (li.classList.contains('more')) return;
    const names = li.querySelector('.names');
    if (!names) return;
    li.classList.remove('two-line', 'no-eta', 'no-note', 'tag-compact', 'tag-below');
    names.style.fontSize = '';
    for (const nm of li.querySelectorAll('.nm')) nm.classList.remove('cut');
    const pair = li.classList.contains('pair');
    const next = !!li.querySelector('.soon-tag');
    const size = (k) => {
      names.style.fontSize = k === 1 ? '' : `${k}em`;
    };
    const steps = [
      () => size(0.92),
      () => size(0.86),
      pair && (() => { size(1); li.classList.add('two-line'); }),
      pair && (() => size(0.92)),
      next ? () => li.classList.add('tag-compact') : () => li.classList.add('no-eta'),
      () => size(0.84),
      () => size(0.78),
      next && (() => { li.classList.remove('tag-compact'); li.classList.add('tag-below'); }),
      !pair && (() => li.classList.add('no-note')),
    ].filter(Boolean);
    for (const step of steps) {
      if (!entryCut(li)) return;
      step();
    }
    for (const nm of li.querySelectorAll('.nm')) if (nameOverflow(nm) > 0) nm.classList.add('cut');
  }

  // File longue : pages qui défilent (une toutes les 10 s), pour que chaque visiteur voie son nom
  // passer à l'écran (« Suivez votre nom à l'écran »). Chaque page montre autant d'entrées que la
  // place le permet, plus une ligne « Rangs 1 à 9 sur 39 » avec l'avancement des pages.
  let pages = []; // [[début, fin[)] en indices des entrées
  let pageIndex = 0;
  let pageShownAt = 0;

  function pagerHtml(items, page) {
    const [start, end] = pages[page];
    const first = esc(items[start].dataset.rank);
    const last = esc(items[end - 1].dataset.rank);
    const total = esc(items[items.length - 1].dataset.rank);
    const range = first === last ? `Rang ${first}` : `Rangs ${first} à ${last}`;
    const bars = pages
      .map((_, i) => `<i class="${i < page ? 'seen' : i === page ? 'on' : ''}"></i>`)
      .join('');
    return `<span class="pg-bars" aria-hidden="true">${bars}</span><span class="pg-text">${range} <small>sur ${total}</small></span>`;
  }

  // Affiche la page `page` (sans recalcul de mise en page : chaque page a été mesurée).
  function showPage(page, restart) {
    const list = els.queueList;
    const items = [...list.children].filter((li) => !li.classList.contains('more'));
    const pager = list.querySelector('.pager');
    if (!pages.length || !pager || !items.length) return;
    pageIndex = Math.min(Math.max(0, page), pages.length - 1);
    if (restart) pageShownAt = Date.now();
    const [start, end] = pages[pageIndex];
    items.forEach((li, i) => {
      li.hidden = i < start || i >= end;
    });
    pager.innerHTML = pagerHtml(items, pageIndex);
    // Barre d'avancement de la page en cours (animation CSS, reprise au bon endroit après un recalcul).
    pager.style.setProperty('--page-ms', `${PAGE_MS}ms`);
    pager.style.setProperty('--page-delay', `${-Math.min(PAGE_MS, Date.now() - pageShownAt)}ms`);
    if (restart) {
      list.classList.remove('page-in');
      void list.offsetWidth; // relance l'apparition en fondu
      list.classList.add('page-in');
    }
  }

  function nextPage() {
    if (pages.length < 2) return;
    showPage((pageIndex + 1) % pages.length, true);
  }

  // Découpe la file en pages qui tiennent dans la place disponible. Renvoie true s'il en faut
  // plusieurs (la file ne tient pas en entier).
  function fitQueue() {
    const list = els.queueList;
    pages = [];
    const old = list.querySelector('.more');
    if (old) old.remove();
    if (list.hidden) return false;
    const items = [...list.children];
    for (const li of items) li.hidden = false;
    if (!items.length) return false;

    const maxH = list.clientHeight;
    const maxW = list.clientWidth;
    if (!maxH) return true;
    const fits = (el) => el.offsetTop + el.offsetHeight <= maxH + 1 && el.offsetLeft + el.offsetWidth <= maxW + 1;
    if (items.every(fits)) return false;

    const pager = document.createElement('li');
    pager.className = 'q more pager';
    pager.innerHTML = '<span class="pg-bars"><i></i></span><span class="pg-text">Rangs 00 à 00 <small>sur 00</small></span>';
    list.appendChild(pager);
    // Pages remplies au maximum (`cap` = nombre d'entrées au plus par page).
    const split = (cap) => {
      const out = [];
      let start = 0;
      while (start < items.length) {
        items.forEach((li, i) => {
          li.hidden = i < start;
        });
        let end = items.findIndex((li, i) => i >= start && !fits(li));
        if (end === -1) end = items.length;
        end = Math.min(Math.max(end, start + 1), start + cap);
        items.forEach((li, i) => {
          li.hidden = i < start || i >= end;
        });
        while (end > start + 1 && !fits(pager)) {
          end -= 1;
          items[end].hidden = true;
        }
        out.push([start, end]);
        start = end;
      }
      return out;
    };
    pages = split(items.length);
    // Pages équilibrées (39 entrées : 10 + 10 + 10 + 9 plutôt que 12 + 13 + 13 + 1), si elles
    // tiennent dans le même nombre de pages.
    if (pages.length > 1) {
      const even = split(Math.ceil(items.length / pages.length));
      if (even.length === pages.length) pages = even;
    }
    // Première mise en pages : la page 1 commence maintenant.
    showPage(pageIndex, !pageShownAt);
    return true;
  }

  function setHowto(mode) {
    els.howto.hidden = !mode;
    els.howto.classList.toggle('is-large', mode === 'large');
  }

  // Mode d'emploi grand si la file est courte, compact sinon, masqué si la file a besoin de la place.
  // Portrait : file sur deux colonnes lues ligne par ligne.
  function fitQueueLayout() {
    const list = els.queueList;
    const closed = isClosed(lastState);
    const entries = lastState && !closed ? (lastState.queue || []).length : 0;
    list.classList.toggle('cols-2', isPortrait() && entries >= 2);
    pages = [];
    for (const li of list.querySelectorAll('.q.more')) li.remove();
    for (const li of list.children) li.hidden = false;
    for (const li of list.children) fitEntry(li);
    const modes = closed ? [null] : ['large', 'compact', null];
    for (const mode of modes) {
      setHowto(mode);
      const over = fitQueue();
      if (!over) {
        if (mode && !entries && els.queueEmpty.scrollHeight > els.queueEmpty.clientHeight + 1) continue;
        return;
      }
    }
  }

  // La colonne garde la priorité à la file et au message de fin de journée : si la file doit
  // passer par pages, chaque page garde au moins 8 lignes en paysage (6 par colonne en portrait),
  // et « À vos tables ! » montre moins d'entrées s'il le faut.
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:var(--u);height:0';
  document.body.appendChild(probe);

  const overflows = (el) => !el.hidden && el.scrollHeight > el.clientHeight + 1;

  // Pas réel d'une ligne de file (carte d'une ligne + espacement), mesuré entre deux entrées
  // affichées l'une sous l'autre ; à défaut, QUEUE_ROW_U.
  function queueRowStep(u) {
    const shown = [...els.queueList.children].filter((li) => !li.hidden && !li.classList.contains('more'));
    let step = Infinity;
    for (let i = 0; i < shown.length; i += 1) {
      const a = shown[i];
      if (a.classList.contains('seeking') || a.classList.contains('two-line') || a.classList.contains('tag-below')) continue;
      const b = shown.slice(i + 1).find((li) => li.offsetLeft === a.offsetLeft);
      if (b && b.offsetTop > a.offsetTop) step = Math.min(step, b.offsetTop - a.offsetTop);
    }
    return Number.isFinite(step) ? step : u * QUEUE_ROW_U;
  }

  function sideFits() {
    if (!lastState) return true;
    if (isClosed(lastState)) return !overflows(els.queueClosed);
    if (!(lastState.queue || []).length) return !overflows(els.queueEmpty);
    if (!pages.length) return true;
    const u = probe.getBoundingClientRect().width || 10; // sans arrondi (7,68 px en 1366 × 768)
    const rows = QUEUE_MIN_ROWS[isPortrait() ? 'portrait' : 'paysage'];
    // Hauteur offerte à la file (la liste elle-même prend la hauteur de la page affichée).
    return els.queueList.parentElement.clientHeight >= rows * queueRowStep(u) + u * 4;
  }

  function layoutSide() {
    els.queueClosed.classList.remove('tight');
    fitQueueLayout();
    if (overflows(els.queueClosed)) els.queueClosed.classList.add('tight');
  }

  function setPlacedMax(n) {
    placedMax = n;
    placedKey = '';
    renderPlaced(lastState, client ? client.now() : Date.now());
  }

  function fitAll() {
    fitNames(els.tables, 0.64);
    setPlacedMax(PLACED_MAX);
    for (;;) {
      layoutSide();
      if (sideFits() || els.placed.hidden || placedMax <= 1) break;
      setPlacedMax(placedMax - 1);
    }
    // File encore par pages alors que « À vos tables ! » montre plusieurs entrées : une entrée de
    // moins (les autres restent signalées par « + N autres » et l'étiquette « Nouveau » du plan)
    // SEULEMENT si toute la file tient alors sur une page.
    if (pages.length && !els.placed.hidden && placedMax > 1) {
      const kept = placedMax;
      setPlacedMax(1);
      layoutSide();
      if (pages.length) {
        setPlacedMax(kept);
        layoutSide();
      }
    }
    // File redevenue courte : la prochaine mise en pages repartira de la page 1.
    if (!pages.length) {
      pageIndex = 0;
      pageShownAt = 0;
    }
  }

  let fitPending = false;
  function scheduleFit() {
    if (fitPending) return;
    fitPending = true;
    requestAnimationFrame(() => {
      fitPending = false;
      fitAll();
    });
  }
  window.addEventListener('resize', scheduleFit);
  if (document.fonts) {
    document.fonts.ready.then(scheduleFit);
    document.fonts.addEventListener('loadingdone', scheduleFit);
  }

  // ---------------------------------------------------------------- horloge et timers

  let client = null;
  let lastQueueRefresh = 0;

  // Temps restant affiché. formatRemaining arrondit à la seconde supérieure : une partie d'une heure
  // afficherait « 1:00:00 » pendant sa première seconde, puis « 59:59 », et l'emplacement changerait
  // de mise en page (pas d'anneau au-delà d'une heure). On affiche « 60:00 » à la place : seules les
  // parties qui durent vraiment plus d'une heure (réglage, prolongation) passent en « 1:02:30 ».
  function remainingText(ms) {
    return Math.ceil(ms / 1000) === 3600 ? '60:00' : LC.formatRemaining(ms);
  }

  function tick() {
    const now = client ? client.now() : Date.now();
    els.clock.textContent = LC.formatClock(now);

    // Seuls le texte du chrono et la variable --p de l'anneau changent (et seulement s'ils changent) :
    // pas de re-rendu, un petit repeint par emplacement et par seconde.
    const freshByTable = new Set();
    for (const t of timers.values()) {
      const remaining = t.endsAt - now;
      const total = Math.max(1, t.endsAt - t.startedAt);
      // Part restante (anneau plein au début, vide à la fin), arrondie au millième.
      const part = (Math.round(Math.min(1, Math.max(0, remaining / total)) * 1000) / 1000).toFixed(3);
      const phase = remaining <= 0 ? 'done' : remaining <= WARN_MS ? 'warn' : 'run';
      const text = phase === 'done' ? 'Terminé !' : remainingText(remaining);
      if (text !== t.text) {
        t.timeEl.textContent = text;
        t.text = text;
        // « 1:02:30 » (partie prolongée au-delà d’une heure) : l’anneau s’efface pour laisser la place.
        const long = phase !== 'done' && text.length > 5;
        if (long !== t.long) {
          t.slot.classList.toggle('long', long);
          t.long = long;
        }
      }
      if (part !== t.part) {
        t.ringEl.style.setProperty('--p', part);
        t.part = part;
      }
      if (phase !== t.phase) {
        t.slot.classList.toggle('warn', phase === 'warn');
        t.slot.classList.toggle('done', phase === 'done');
        t.phase = phase;
      }
      const fresh = phase === 'run' && now - t.startedAt < NEW_MS;
      if (fresh !== t.fresh) {
        t.slot.classList.toggle('is-new', fresh);
        t.fresh = fresh;
      }
      if (fresh) freshByTable.add(t.table);
    }
    // Étiquette « Nouveau » de la table (entre les chaises du bas) : visible si l'un des deux
    // emplacements vient d'être attribué.
    for (const [no, view] of tableViews) {
      const fresh = freshByTable.has(no);
      if (fresh === view.fresh) continue;
      view.fresh = fresh;
      view.el.classList.toggle('has-new', fresh);
    }

    if (pages.length > 1 && Date.now() - pageShownAt >= PAGE_MS) nextPage();

    let refit = renderWait(lastState, now);
    if (renderPlaced(lastState, now)) refit = true;
    // Heures estimées de la file (« vers 16:20 », « Imminent ») : rafraîchies toutes les 30 s.
    if (lastState && now - lastQueueRefresh > 30000) {
      lastQueueRefresh = now;
      if (renderQueue(lastState, now, false)) refit = true;
    }
    if (refit) scheduleFit();
  }

  let tickTimer = null;
  function loop() {
    tick();
    const now = client ? client.now() : Date.now();
    clearTimeout(tickTimer);
    tickTimer = setTimeout(loop, 1000 - (now % 1000) + 15);
  }

  // ---------------------------------------------------------------- connexion

  function onState(state) {
    lastState = state;
    const now = client ? client.now() : Date.now();
    const stand = isClosed(state) ? 'ferme' : 'ouvert';
    if (root.dataset.stand !== stand) root.dataset.stand = stand;
    renderTables(state);
    renderWait(state, now);
    els.side.classList.toggle('no-wait', els.wait.hidden);
    renderPlaced(state, now);
    lastQueueRefresh = now;
    renderQueue(state, now, true);
    tick();
    fitAll();
  }

  function onStatus(connected) {
    els.conn.dataset.state = connected ? 'on' : 'off';
    els.conn.querySelector('span').textContent = connected ? 'En direct' : 'Reconnexion…';
  }

  client = LC.connect({ onState, onStatus });
  loop();
})();
