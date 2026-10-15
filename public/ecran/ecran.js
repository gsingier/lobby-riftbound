// Écran TV public (/ecran) : plan des 9 tables (2 matchs 1v1 par table), attente estimée pour une
// nouvelle inscription, joueurs qui viennent d'être placés (« À vos tables ! »), file d'attente.
// Re-rendu différentiel à chaque événement 'state' ; comptes à rebours mis à jour chaque seconde.
// N'affiche que « Prénom N. » (projection publique du serveur) ; tout texte est échappé.
(function () {
  'use strict';

  const LC = window.LobbyClient;
  const esc = LC.escapeHtml;
  const SLOT_NAMES = ['A', 'B'];
  const MIN = 60 * 1000;
  const WARN_MS = 5 * MIN;
  const NEW_MS = 2 * MIN; // étiquette « Nouveau » sur l'emplacement
  const PLACED_MS = 3 * MIN; // liste « À vos tables ! »
  const PLACED_MAX = 3;
  const NEXT_HIGHLIGHT = 2;
  const SEATED_ANIM_MS = 2800;
  const IMMINENT_MS = 2 * MIN;

  const root = document.documentElement;
  const $ = (id) => document.getElementById(id);
  const els = {
    clock: $('clock'),
    conn: $('conn'),
    tables: $('tables'),
    freeCount: $('freeCount'),
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

  const isPortrait = () => root.dataset.layout === 'portrait';

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

  // Noms du plan, jamais coupés tant qu'il reste une solution : police réduite (jusqu'à 0,78),
  // puis deux lignes (« Marie- / Charlotte D. ») si l'emplacement a la hauteur, puis police plus
  // petite (jusqu'à `min`), puis deux lignes dans un emplacement resserré (chrono un peu plus
  // petit, « VS » masqué), et seulement en dernier recours « … » sur le prénom.
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
          if (nm.scrollWidth <= nm.clientWidth + 1 && lines <= 2 && slot.scrollHeight <= slot.clientHeight + 1) return true;
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

  function buildTables(tables) {
    els.tables.textContent = '';
    tableViews.clear();
    timers.clear();
    for (const t of tables) {
      const el = document.createElement('div');
      el.className = 'table';
      el.innerHTML =
        '<div class="chairs top"><span class="chair"></span><span class="chair"></span></div>' +
        `<span class="num">${esc(t.no)}</span>` +
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
        : '<div class="whole-label shut">Fermé</div>';
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
    el.style.removeProperty('--seated-delay');
    const tag = `<span class="slot-tag">${name}</span>`;

    if (!match) {
      if (!table.enabled) {
        el.className = 'slot off';
        el.innerHTML = `${tag}<span class="state-label">Hors<br>service</span>`;
      } else if (closed) {
        // Stand fermé : surtout pas « Libre », qui inviterait à venir s'asseoir.
        el.className = 'slot shut';
        el.innerHTML = `${tag}<span class="state-label">Fermé</span>`;
      } else {
        el.className = 'slot free';
        el.innerHTML = `${tag}<span class="free-label">Libre</span>`;
      }
      return;
    }

    // Un seul joueur (contre un animateur dès l'inscription, ou partenaire déclaré absent).
    const [p1, p2] = match.players;
    const second = p2
      ? `<div class="pl pl2">${nameHtml(p2.displayName)}</div>`
      : '<div class="pl pl2 animator"><span class="anim-pill">Animateur</span></div>';
    el.className = 'slot busy';
    el.innerHTML =
      '<span class="fx" aria-hidden="true"></span>' +
      '<span class="new-tag">Nouveau</span>' +
      `<div class="pl pl1">${nameHtml(p1 ? p1.displayName : 'Joueur')}</div>` +
      `<div class="vs">${tag}<span class="vs-word">VS</span></div>` +
      '<div class="time"></div>' +
      '<div class="gauge"><i></i></div>' +
      second;

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
      timeEl: el.querySelector('.time'),
      fillEl: el.querySelector('.gauge i'),
      startedAt: match.startedAt,
      endsAt: match.endsAt,
      phase: null,
      fresh: null,
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
    let eyebrow = 'Attente estimée · nouvelle inscription';
    if (est.newcomerAt === null) {
      mode = 'none';
      value = '<span class="wv-text">Tables momentanément indisponibles</span>';
      sub = 'Renseignez-vous à l’accueil';
    } else if (free > 0 && est.newcomerAt - now < MIN) {
      mode = 'free';
      eyebrow = 'Nouvelle inscription · pas d’attente';
      value =
        `<span class="wv-num">${free}</span>` +
        `<span class="wv-lines"><span>${plural(free, 'place libre', 'places libres')}</span><span>maintenant&nbsp;!</span></span>`;
      sub = 'Présentez-vous à l’accueil';
    } else {
      mode = 'wait';
      const w = waitLabel(est.newcomerAt - now);
      value = `<span class="wv-tilde">~</span><span class="wv-num">${esc(w.num)}</span>${w.unit ? `<span class="wv-unit">${w.unit}</span>` : ''}`;
      sub = `Début de partie vers <b>${esc(LC.formatClock(est.newcomerAt))}</b>`;
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
    return true;
  }

  // ---------------------------------------------------------------- « À vos tables ! »

  let placedKey = '';
  let placedMax = PLACED_MAX;

  // Parties commencées depuis moins de 3 minutes (heure du serveur : juste après un rechargement aussi).
  function recentMatches(state, now) {
    const list = [];
    for (const t of state.tables) {
      for (const s of SLOT_NAMES) {
        const m = t.slots[s];
        if (m && now - m.startedAt < PLACED_MS && m.endsAt > now) list.push({ no: t.no, slot: s, m });
      }
    }
    return list.sort((a, b) => b.m.startedAt - a.m.startedAt || a.no - b.no);
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
      const names = m.players.map((p) => esc(p.displayName));
      const who = names.length >= 2
        ? `<span class="pn">${names[0]}</span> <span class="pn"><span class="amp">&amp;</span> ${names[1]}</span>`
        : `<span class="pn">${names[0] || 'Joueur'}</span><span class="vs-host">contre un animateur</span>`;
      return `<li><span class="where"><small>Table</small>${esc(no)}<i>${slot}</i></span><span class="placed-names">${who}</span></li>`;
    });
    const rest = recent.length - shown.length;
    if (rest > 0) {
      rows.push(`<li class="more">+ ${rest} ${plural(rest, 'autre', 'autres')} : étiquette « Nouveau » sur le plan</li>`);
    }
    els.placedList.innerHTML = rows.join('');
    return true;
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
            `<li class="q pair${isNext ? ' next' : ''}">${rank}` +
            `<span class="names">${nameHtml(a.displayName)}<span class="amp">&amp;</span>${nameHtml(b.displayName)}</span>` +
            `${tail}</li>`
          );
        }
        const solo = entry.players[0] || { displayName: '' };
        if (entry.ready) {
          return (
            `<li class="q solo vs-host${isNext ? ' next' : ''}">${rank}` +
            `<span class="names">${nameHtml(solo.displayName)}` +
            '<span class="note">contre un animateur</span></span>' +
            `${tail}</li>`
          );
        }
        return (
          `<li class="q solo seeking">${rank}<span class="body">` +
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
  // lignes (un joueur par ligne), puis heure estimée masquée, puis police réduite, puis « … ».
  function fitEntry(li) {
    if (li.classList.contains('more')) return;
    const names = li.querySelector('.names');
    if (!names) return;
    li.classList.remove('two-line', 'no-eta', 'no-note');
    names.style.fontSize = '';
    for (const nm of li.querySelectorAll('.nm')) nm.classList.remove('cut');
    const pair = li.classList.contains('pair');
    const size = (k) => {
      names.style.fontSize = k === 1 ? '' : `${k}em`;
    };
    const steps = [
      () => size(0.92),
      () => size(0.86),
      pair && (() => { size(1); li.classList.add('two-line'); }),
      pair && (() => size(0.92)),
      () => li.classList.add('no-eta'),
      () => size(0.84),
      () => size(0.78),
      !pair && (() => li.classList.add('no-note')),
    ].filter(Boolean);
    for (const step of steps) {
      if (!entryCut(li)) return;
      step();
    }
    for (const nm of li.querySelectorAll('.nm')) if (nameOverflow(nm) > 0) nm.classList.add('cut');
  }

  // N'affiche que les entrées qui tiennent, puis « + N autres ». Renvoie true si la file déborde.
  function fitQueue() {
    const list = els.queueList;
    if (list.hidden) return false;
    const items = [...list.children].filter((li) => !li.classList.contains('more'));
    const old = list.querySelector('.more');
    if (old) old.remove();
    for (const li of items) li.hidden = false;
    if (!items.length) return false;

    const maxH = list.clientHeight;
    const maxW = list.clientWidth;
    if (!maxH) return true;
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
        `<small>${hiddenPlayers} ${plural(hiddenPlayers, 'joueur', 'joueurs')}</small>`;
      if (fits(more) || visible === 0) break;
      visible -= 1;
    }
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

  // La colonne de droite garde la priorité à la file (au moins 3 lignes) et au message de fin de
  // journée : « À vos tables ! » montre moins d'entrées s'il le faut.
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:var(--u);height:0';
  document.body.appendChild(probe);

  const overflows = (el) => !el.hidden && el.scrollHeight > el.clientHeight + 1;

  function sideFits() {
    if (!lastState) return true;
    if (isClosed(lastState)) return !overflows(els.queueClosed);
    if (!(lastState.queue || []).length) return !overflows(els.queueEmpty);
    const u = probe.offsetWidth || 10;
    return els.queueList.parentElement.clientHeight >= u * 17.4;
  }

  function fitAll() {
    fitNames(els.tables, 0.64);
    placedMax = PLACED_MAX;
    placedKey = '';
    renderPlaced(lastState, client ? client.now() : Date.now());
    for (;;) {
      els.queueClosed.classList.remove('tight');
      fitQueueLayout();
      if (overflows(els.queueClosed)) els.queueClosed.classList.add('tight');
      if (sideFits() || els.placed.hidden || placedMax <= 1) break;
      placedMax -= 1;
      placedKey = '';
      renderPlaced(lastState, client ? client.now() : Date.now());
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

  // ---------------------------------------------------------------- bandeau

  function renderFooter(state) {
    if (isClosed(state)) {
      const playing = activeMatchCount(state) > 0;
      els.cta.classList.toggle('single', !playing);
      els.ctaGoodies.hidden = !playing;
      els.goodiesText.innerHTML = '<b>Parties en cours</b> : goodies offerts en fin de partie';
      return;
    }
    els.cta.classList.remove('single');
    els.ctaGoodies.hidden = false;
    const ms = (state.settings && state.settings.matchDurationMs) || 60 * MIN;
    els.goodiesText.innerHTML = `<b>${esc(durationLabel(ms))} de jeu</b> = goodies offerts`;
  }

  // ---------------------------------------------------------------- horloge et timers

  let client = null;
  let lastQueueRefresh = 0;

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
      const fresh = phase === 'run' && now - t.startedAt < NEW_MS;
      if (fresh !== t.fresh) {
        t.slot.classList.toggle('is-new', fresh);
        t.fresh = fresh;
      }
    }

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
    renderFooter(state);
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
