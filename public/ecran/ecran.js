// Écran TV public : plan des 9 tables (2 matchs 1v1 par table) + file d'attente.
// Re-rendu à chaque événement 'state' ; comptes à rebours mis à jour chaque seconde.
(function () {
  'use strict';

  const LC = window.LobbyClient;
  const esc = LC.escapeHtml;
  const SLOT_NAMES = ['A', 'B'];
  const WARN_MS = 5 * 60 * 1000;
  const NEXT_HIGHLIGHT = 2;
  const SEATED_ANIM_MS = 2300;

  const root = document.documentElement;
  const $ = (id) => document.getElementById(id);
  const els = {
    clock: $('clock'),
    conn: $('conn'),
    tables: $('tables'),
    freeCount: $('freeCount'),
    queueCount: $('queueCount'),
    queueCountLabel: $('queueCountLabel'),
    queueNext: $('queueNext'),
    queueList: $('queueList'),
    queueEmpty: $('queueEmpty'),
    queueEmptySub: $('queueEmptySub'),
    queueClosed: $('queueClosed'),
    queueClosedNote: $('queueClosedNote'),
    cta: $('cta'),
    ctaGoodies: $('ctaGoodies'),
    goodiesText: $('goodiesText'),
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

  function applyLayout() {
    let portrait = portraitQuery.matches;
    if (rotation === '90' || rotation === '-90') portrait = !portrait;
    const layout = forcedLayout || (portrait ? 'portrait' : 'paysage');
    if (root.dataset.layout !== layout) root.dataset.layout = layout;
  }
  applyLayout();
  portraitQuery.addEventListener('change', () => {
    applyLayout();
    scheduleFit();
  });

  // ---------------------------------------------------------------- utilitaires

  // « Prénom N. » : le prénom (.fn) peut être raccourci par « … », l'initiale (.ini) reste visible.
  function nameHtml(name) {
    // L'espace reste dans .fn : quand le prénom est coupé, « … » le remplace (pas de blanc en trop).
    const m = /^(.*\S\s+)(\S{1,3}\.)$/u.exec(String(name ?? ''));
    const initial = m ? `<span class="ini">${esc(m[2])}</span>` : '';
    return `<span class="nm"><span class="fn">${esc(m ? m[1] : name)}</span>${initial}</span>`;
  }

  // Largeur manquante d'un nom : partie coupée du prénom + éventuel débordement du bloc entier.
  function nameOverflow(nm) {
    const fn = nm.firstElementChild;
    return fn.scrollWidth - fn.clientWidth + Math.max(0, nm.scrollWidth - nm.clientWidth);
  }

  // Réduit la police des noms trop longs pour qu'ils tiennent (jusqu'à `min`), puis « … ».
  // Lectures groupées puis écritures groupées : trois calculs de mise en page seulement.
  function fitNames(scope, min) {
    const names = [...scope.querySelectorAll('.nm')];
    for (const nm of names) {
      nm.style.fontSize = '';
      nm.classList.remove('cut');
    }
    const ratios = names.map((nm) => {
      const excess = nameOverflow(nm);
      return nm.clientWidth > 0 && excess > 0 ? nm.clientWidth / (nm.clientWidth + excess) : 1;
    });
    names.forEach((nm, i) => {
      if (ratios[i] < 1) nm.style.fontSize = `${Math.max(min, ratios[i] * 0.97).toFixed(3)}em`;
    });
    // Encore coupés à la taille minimale : petit écart garanti entre « … » et l'initiale.
    const cut = names.filter((nm, i) => ratios[i] < 1 && nameOverflow(nm) > 0);
    for (const nm of cut) nm.classList.add('cut');
  }

  function fitAll() {
    fitNames(els.tables, 0.68);
    fitQueueLayout();
  }

  // Portrait : une colonne pleine largeur tant que la file y tient, deux colonnes sinon.
  function fitQueueLayout() {
    const list = els.queueList;
    list.classList.remove('cols-2');
    if (fitQueuePass(list) && root.dataset.layout === 'portrait') {
      list.classList.add('cols-2');
      fitQueuePass(list);
    }
  }

  // Réaffiche toutes les entrées, ajuste noms et notes, puis « + N autres ». Renvoie true si ça déborde.
  function fitQueuePass(list) {
    const old = list.querySelector('.more');
    if (old) old.remove();
    for (const li of list.children) {
      li.hidden = false;
      li.classList.remove('no-note');
    }
    fitNames(list, 0.85);
    // Note (« contre un animateur »…) devenue illisible : masquée, le nom récupère la place.
    const cut = [...list.querySelectorAll('.note')].filter((note) => note.clientWidth < note.scrollWidth * 0.6);
    if (cut.length) {
      for (const note of cut) note.closest('.q').classList.add('no-note');
      fitNames(list, 0.85);
    }
    return fitQueue();
  }

  function plural(n, one, many) {
    return n > 1 ? many : one;
  }

  // Stand fermé (« Fermer le stand », le soir) : plus aucun placement automatique.
  // Les parties en cours continuent avec leur timer ; la file ne bouge plus.
  function isClosed(state) {
    return !!(state && state.settings && state.settings.placementsPaused);
  }

  function activeMatchCount(state) {
    return state.tables.reduce((n, t) => n + SLOT_NAMES.filter((s) => t.slots[s]).length, 0);
  }

  // « 1 heure de jeu », « 45 minutes de jeu », « 1 h 30 de jeu ».
  function durationLabel(ms) {
    const minutes = Math.round(ms / 60000);
    if (minutes % 60 === 0) {
      const h = minutes / 60;
      return `${h} ${plural(h, 'heure', 'heures')}`;
    }
    if (minutes < 60) return `${minutes} ${plural(minutes, 'minute', 'minutes')}`;
    return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
  }

  // ---------------------------------------------------------------- plan des tables

  const tableViews = new Map(); // no → { el, board, chairs: {A: [haut, bas], B: […]}, slotKeys, key }
  const timers = new Map(); // "4A" → { slot, timeEl, fillEl, startedAt, endsAt, phase }
  const seatedAt = new Map(); // matchId → horodatage local du placement (animation)
  let firstRender = true;

  function buildTables(tables) {
    els.tables.textContent = '';
    tableViews.clear();
    timers.clear();
    for (const t of tables) {
      const el = document.createElement('div');
      el.className = 'table';
      el.innerHTML =
        '<div class="chairs top"><span class="chair"></span><span class="chair"></span></div>' +
        `<span class="num"><span>${esc(t.no)}</span></span>` +
        '<div class="board"><div class="slot" data-slot="A"></div><div class="slot" data-slot="B"></div></div>' +
        '<div class="chairs bottom"><span class="chair"></span><span class="chair"></span></div>';
      const top = el.querySelectorAll('.chairs.top .chair');
      const bottom = el.querySelectorAll('.chairs.bottom .chair');
      tableViews.set(t.no, {
        el,
        board: el.querySelector('.board'),
        chairs: { A: [top[0], bottom[0]], B: [top[1], bottom[1]] },
        slotKeys: { A: null, B: null },
        key: null,
      });
      els.tables.appendChild(el);
    }
  }

  function slotKey(table, name, closed) {
    const s = table.slots[name];
    if (!s) return `free:${table.enabled}:${closed}`;
    return JSON.stringify([s.matchId, s.startedAt, s.endsAt, s.vsAnimator, s.players.map((p) => p.displayName)]);
  }

  function renderBoard(view, table, closed) {
    const bothFree = !table.slots.A && !table.slots.B;
    // Table vide hors service, ou table vide quand le stand est fermé : une seule mention sur toute la table.
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
        ? '<div class="off-label">Hors service</div>'
        : '<div class="shut-label whole"><i class="moon"></i>Fermé</div>';
      for (const name of SLOT_NAMES) setChairs(view, name, null);
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
      setChairs(view, name, table.slots[name]);
    });
  }

  function setChairs(view, name, match) {
    const [top, bottom] = view.chairs[name];
    top.classList.toggle('taken', !!match);
    bottom.classList.toggle('taken', !!match);
    bottom.classList.toggle('host', !!match && match.players.length < 2);
  }

  function renderSlot(el, table, name, closed) {
    const id = `${table.no}${name}`;
    const match = table.slots[name];
    timers.delete(id);
    el.dataset.slot = name;

    if (!match) {
      if (!table.enabled) {
        el.className = 'slot closed';
        el.innerHTML = `<span class="slot-tag">${name}</span><span class="closed-label">Hors<br>service</span>`;
      } else if (closed) {
        // Stand fermé : surtout pas « Libre », qui inviterait à venir s'asseoir.
        el.className = 'slot shut';
        el.innerHTML = `<span class="slot-tag">${name}</span><span class="shut-label"><i class="moon"></i>Fermé</span>`;
      } else {
        el.className = 'slot free';
        el.innerHTML = `<span class="slot-tag">${name}</span><span class="free-label"><i></i>Libre</span>`;
      }
      return;
    }

    // Un seul joueur (contre un animateur dès l'inscription, ou partenaire déclaré absent) :
    // la seconde ligne affiche « Animateur ».
    const [p1, p2] = match.players;
    const second = p2
      ? `<div class="pl pl2">${nameHtml(p2.displayName)}</div>`
      : `<div class="pl pl2 animator">${nameHtml('Animateur')}</div>`;
    el.className = 'slot busy';
    el.innerHTML =
      `<div class="pl pl1">${nameHtml(p1 ? p1.displayName : 'Joueur')}</div>` +
      `<span class="slot-tag">${name}</span>` +
      '<div class="vs">VS</div>' +
      '<div class="time"></div>' +
      '<div class="gauge"><i></i></div>' +
      second;

    // Nouveaux joueurs installés : halo radiant (pas au premier affichage de la page).
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
      timeEl: el.querySelector('.time'),
      fillEl: el.querySelector('.gauge i'),
      startedAt: match.startedAt,
      endsAt: match.endsAt,
      phase: null,
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
    // Oubli des anciennes parties (animation déjà jouée).
    const active = new Set(state.tables.flatMap((t) => SLOT_NAMES.map((n) => t.slots[n] && t.slots[n].matchId)));
    for (const id of seatedAt.keys()) if (!active.has(id)) seatedAt.delete(id);

    if (closed) {
      const playing = activeMatchCount(state);
      els.freeCount.classList.remove('has-free');
      els.freeCount.innerHTML = playing
        ? `${plural(playing, 'Partie en cours', 'Parties en cours')} : <b>${playing}</b>`
        : 'Aucune partie en cours';
    } else {
      els.freeCount.classList.toggle('has-free', free > 0);
      els.freeCount.innerHTML = total ? `Places libres : <b>${free}</b> / ${total}` : 'Aucune table ouverte';
    }
    firstRender = false;
  }

  // ---------------------------------------------------------------- file d'attente

  let lastState = null;

  function renderQueue(state) {
    const queue = state.queue || [];
    const players = queue.reduce((n, e) => n + e.players.length, 0);
    els.queueCount.textContent = String(players);
    els.queueCountLabel.textContent = plural(players, 'joueur en attente', 'joueurs en attente');

    // Stand fermé : message de fin de journée à la place de la file (personne ne sera placé ;
    // les joueurs restés en file pourront se réinscrire après la « Nouvelle journée »).
    // Aucune mention de « demain » : le dernier soir du salon, il n'y a pas de lendemain.
    const closed = isClosed(state);
    els.queueClosed.hidden = !closed;
    if (closed) {
      els.queueEmpty.hidden = true;
      els.queueList.hidden = true;
      els.queueList.textContent = '';
      els.queueClosedNote.hidden = players === 0;
      els.queueClosedNote.innerHTML = players
        ? '<span>Encore en file d’attente&nbsp;?</span><span><b>Renseignez-vous</b> à l’accueil.</span>'
        : '';
      return;
    }

    const empty = queue.length === 0;
    els.queueEmpty.hidden = !empty;
    els.queueList.hidden = empty;
    if (empty) {
      els.queueList.textContent = '';
      const free = state.tables.reduce(
        (n, t) => n + (t.enabled ? SLOT_NAMES.filter((s) => !t.slots[s]).length : 0),
        0,
      );
      els.queueEmptySub.textContent = free > 0
        ? `${free} ${plural(free, 'place libre', 'places libres')} en ce moment`
        : 'Vous serez placé dès qu’une table se libère';
      return;
    }

    let highlight = NEXT_HIGHLIGHT;
    els.queueList.innerHTML = queue
      .map((entry) => {
        const isNext = entry.ready && highlight-- > 0;
        const rank = `<span class="rank">${esc(entry.rank)}</span>`;
        const soon = isNext ? '<span class="soon">À suivre</span>' : '';
        if (entry.kind === 'pair') {
          const [a, b] = entry.players;
          return (
            `<li class="q pair${isNext ? ' next' : ''}">${rank}` +
            `<span class="names">${nameHtml(a.displayName)}<span class="amp">&amp;</span>${nameHtml(b.displayName)}</span>` +
            `${soon}</li>`
          );
        }
        const solo = entry.players[0] || { displayName: '' };
        if (entry.ready) {
          return (
            `<li class="q solo vs-host${isNext ? ' next' : ''}">${rank}` +
            `<span class="names">${nameHtml(solo.displayName)}<span class="dash">—</span>` +
            '<span class="note">contre un animateur</span></span>' +
            `${soon}</li>`
          );
        }
        return (
          `<li class="q solo seeking">${rank}<span class="body">` +
          `<span class="names">${nameHtml(solo.displayName)}<span class="dash">—</span>` +
          '<span class="note">cherche un partenaire</span></span>' +
          '<span class="invite">Venu seul&nbsp;? <b>Inscrivez-vous</b> pour jouer ensemble&nbsp;!</span>' +
          '</span></li>'
        );
      })
      .join('');
  }

  // N'affiche que les entrées qui tiennent, puis « + N autres ». Renvoie true si la file déborde.
  function fitQueue() {
    const list = els.queueList;
    if (list.hidden) return false;
    const items = [...list.children];
    if (!items.length) return false;

    // Géométrie de mise en page (offset*), indépendante d'une éventuelle rotation CSS.
    const maxH = list.clientHeight;
    const maxW = list.clientWidth;
    if (!maxH) return false;
    const fits = (el) => el.offsetTop + el.offsetHeight <= maxH + 1 && el.offsetLeft + el.offsetWidth <= maxW + 1;
    let visible = items.findIndex((li) => !fits(li));
    if (visible === -1) return false;

    const more = document.createElement('li');
    more.className = 'q more';
    list.appendChild(more);
    for (;;) {
      items.forEach((li, i) => {
        li.hidden = i >= visible;
      });
      const hidden = items.slice(visible);
      const hiddenPlayers = hidden.reduce((n, li) => n + li.querySelectorAll('.nm').length, 0);
      more.innerHTML =
        `+ ${hidden.length} ${plural(hidden.length, 'autre', 'autres')}` +
        `<small>(${hiddenPlayers} ${plural(hiddenPlayers, 'joueur', 'joueurs')})</small>`;
      if (fits(more) || visible === 0) break;
      visible -= 1;
    }
    return true;
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

  // ---------------------------------------------------------------- bandeau

  function renderFooter(state) {
    if (isClosed(state)) {
      // Les parties en cours vont jusqu'au bout : leurs joueurs gardent droit aux goodies.
      const playing = activeMatchCount(state) > 0;
      els.cta.classList.toggle('single', !playing);
      els.ctaGoodies.hidden = !playing;
      els.goodiesText.innerHTML = '<b>Parties en cours</b> : goodies offerts en fin de partie';
      return;
    }
    els.cta.classList.remove('single');
    els.ctaGoodies.hidden = false;
    const ms = (state.settings && state.settings.matchDurationMs) || 60 * 60 * 1000;
    els.goodiesText.innerHTML = `<b>${esc(durationLabel(ms))} de jeu</b> = goodies offerts`;
  }

  // ---------------------------------------------------------------- horloge et timers

  // Délai avant la prochaine place libre, si des joueurs prêts attendent et que tout est occupé.
  function nextFreeIn(state, now) {
    if (!state || isClosed(state) || !state.queue.some((e) => e.ready)) return null;
    let soonest = Infinity;
    for (const t of state.tables) {
      if (!t.enabled) continue;
      for (const n of SLOT_NAMES) {
        const s = t.slots[n];
        if (!s) return null;
        soonest = Math.min(soonest, s.endsAt);
      }
    }
    return Number.isFinite(soonest) ? Math.max(0, soonest - now) : null;
  }

  let client = null;

  function tick() {
    const now = client ? client.now() : Date.now();
    els.clock.textContent = LC.formatClock(now);

    for (const t of timers.values()) {
      const remaining = t.endsAt - now;
      const total = Math.max(1, t.endsAt - t.startedAt);
      const progress = Math.min(1, Math.max(0, 1 - remaining / total));
      const phase = remaining <= 0 ? 'done' : remaining <= WARN_MS ? 'warn' : 'run';
      t.timeEl.textContent = phase === 'done' ? 'Terminé !' : LC.formatRemaining(remaining);
      t.fillEl.style.transform = `scaleX(${progress.toFixed(4)})`;
      if (phase !== t.phase) {
        t.slot.classList.toggle('warn', phase === 'warn');
        t.slot.classList.toggle('done', phase === 'done');
        t.phase = phase;
      }
    }

    const wait = nextFreeIn(lastState, now);
    if (wait === null) {
      els.queueNext.hidden = true;
    } else {
      els.queueNext.hidden = false;
      els.queueNext.innerHTML = wait < 1000
        ? 'Une place se libère <b>maintenant</b>'
        : `Prochaine place libre d’ici <b>${esc(LC.formatRemaining(wait))}</b>`;
    }
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
    const stand = isClosed(state) ? 'ferme' : 'ouvert';
    if (root.dataset.stand !== stand) root.dataset.stand = stand;
    renderTables(state);
    renderFooter(state);
    tick(); // avant la file : la ligne « prochaine place » change la hauteur disponible
    renderQueue(state);
    fitAll();
  }

  function onStatus(connected) {
    els.conn.dataset.state = connected ? 'on' : 'off';
    els.conn.querySelector('span').textContent = connected ? 'En direct' : 'Reconnexion…';
  }

  client = LC.connect({ onState, onStatus });
  loop();
})();
