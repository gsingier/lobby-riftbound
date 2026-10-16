// Boutique (comptoir), /boutique : remise des cartes promo.
// Le visiteur donne son nom ou son n° de billet ; on le cherche (boutiqueSearch), on lit son état
// (carte à remettre, déjà remise, partie en cours, en file, pas de carte) et on remet la carte
// d'un appui (giveGoodies), avec « Annuler » pendant 10 s. La liste « À remettre » et les
// « Dernières remises » arrivent en direct (événement `state`).
// Mises à jour sans re-rendu complet : chaque liste est réconciliée par identifiant (une carte
// inchangée garde son élément, donc le focus), le champ de recherche n'est jamais reconstruit.
// Toute donnée venue du serveur est échappée (escapeHtml) ; l'email n'est jamais affiché.
(function () {
  'use strict';

  const LC = window.LobbyClient;
  const esc = LC.escapeHtml;
  const $ = (sel, root = document) => root.querySelector(sel);

  const SEARCH_DEBOUNCE_MS = 250;
  const UNDO_MS = 10000; // « Annuler » après une remise
  const MESSAGE_MS = 7000; // information ou erreur dans la zone de retour
  const NEW_HIGHLIGHT_MS = 12000; // nouvelle carte à remettre (fin de partie en direct)
  const CONFIRM_MS = 5000; // second appui pour annuler une remise depuis « Dernières remises »
  const MOVE_GUARD_MS = 500; // appui ignoré sur une carte qui vient de bouger (mise à jour en direct)
  const REFRESH_MS = 700; // relance discrète de la recherche après un changement d'état
  const MIN = 60 * 1000;
  const LOGIN_URL = '/login';

  // Statuts sans carte promo pour lesquels le visiteur n'a pas joué : il peut se réinscrire.
  const CAN_REREGISTER = new Set(['removed', 'expired', 'interrupted']);

  const input = $('#q');
  const clearBtn = $('#q-clear');
  const busyEl = $('#search-busy');
  const feedback = $('#feedback');
  const layout = $('#layout');
  const listScroll = $('#list-scroll');
  const pendingList = $('#pending-list');
  const resultsList = $('#results-list');
  const recentList = $('#recent-list');
  const listTitle = $('#list-title');
  const listCount = $('#list-count');
  const listSub = $('#list-sub');
  const srResults = $('#sr-results');
  const srNews = $('#sr-news');

  let client = null;
  let online = false;
  let view = null; // état boutique (voir adapt)
  let knownPending = null; // identifiants « à remettre » du dernier état (null avant le premier)
  const newUntil = new Map(); // id → fin de la mise en évidence « Nouveau »
  let newTimer = 0;

  let results = null; // résultats affichés (null : pas de recherche)
  let resultsQuery = '';
  let searchSeq = 0;
  let debounceTimer = 0;
  let userSearchPending = false;
  let refreshTimer = 0;

  const busy = new Set(); // remises en cours d'envoi
  let feedbackTimer = 0;
  let feedbackKind = 'hint';
  let armed = null; // bouton « Annuler » de « Dernières remises » en attente de confirmation
  let armedTimer = 0;

  const isTouch = !!window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;

  // ================================================================ utilitaires

  const dayMonthFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit' });
  const now = () => (client ? client.now() : Date.now());
  const clock = (ms) => LC.formatClock(ms);
  const dateTime = (ms) => `le ${dayMonthFmt.format(new Date(ms))} à ${clock(ms)}`;
  const isToday = (ms) => !!view && ms >= view.day.startedAt;
  const when = (ms) => (isToday(ms) ? `à ${clock(ms)}` : dateTime(ms));
  const fullName = (p) => `${p.firstName || ''} ${p.lastName || ''}`.trim() || p.displayName || 'Joueur';
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const cleanQuery = (s) => String(s ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
  // Mêmes normalisations que le serveur (billet : majuscules, sans espaces, tirets, points, _).
  const normTicket = (s) => String(s ?? '').trim().toUpperCase().replace(/[\s\p{Pd}_.]/gu, '');
  const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

  const icon = (id) => `<svg class="ic" aria-hidden="true"><use href="#${id}"/></svg>`;

  function setText(el, text) {
    const value = String(text);
    if (el.textContent !== value) el.textContent = value;
  }

  // Seuls les champs utiles sont gardés (l'état de l'accueil contient aussi l'email : jamais repris).
  function pick(p) {
    return {
      id: Number(p.id),
      firstName: p.firstName,
      lastName: p.lastName,
      displayName: p.displayName,
      ticket: p.ticket,
      status: p.status,
      statusLabel: p.statusLabel,
      dayNumber: p.dayNumber,
      goodiesGivenAt: p.goodiesGivenAt ?? null,
      tableNo: p.tableNo ?? null,
      slot: p.slot ?? null,
      endedAt: p.endedAt ?? null,
      endsAt: p.endsAt ?? null,
    };
  }

  // État boutique. Connecté avec le mot de passe de l'accueil, le socket reçoit l'état complet de
  // l'accueil : on en tire la même vue (parties du jour seulement).
  function adapt(s) {
    if (Array.isArray(s.pending)) {
      return {
        day: s.day,
        pending: s.pending.map(pick),
        recentGiven: (s.recentGiven || []).map(pick),
        stats: s.stats,
        partial: false,
      };
    }
    const goodies = (Array.isArray(s.goodies) ? s.goodies : []).map(pick);
    const pending = goodies.filter((g) => !g.goodiesGivenAt);
    const given = goodies.filter((g) => g.goodiesGivenAt);
    const startedAt = s.day ? s.day.startedAt : 0;
    return {
      day: s.day,
      pending,
      recentGiven: given.slice().sort((a, b) => b.goodiesGivenAt - a.goodiesGivenAt || b.id - a.id).slice(0, 20),
      stats: {
        pending: pending.length,
        givenToday: given.filter((g) => g.goodiesGivenAt >= startedAt).length,
        playing: s.stats ? s.stats.playing : 0,
      },
      partial: true,
    };
  }

  // Met en évidence les morceaux trouvés (<mark>), caractère par caractère : la recherche ignore
  // accents et casse (noms) ou espaces et tirets (billet). Tout le texte est échappé.
  function highlight(text, needles, mapChar) {
    const chars = Array.from(String(text ?? ''));
    const list = needles.filter((n) => n && n.length >= 2);
    if (!list.length) return esc(text);
    let folded = '';
    const owner = [];
    chars.forEach((c, i) => {
      const f = mapChar(c);
      folded += f;
      for (let k = 0; k < f.length; k++) owner.push(i);
    });
    const marked = new Array(chars.length).fill(false);
    for (const n of list) {
      let from = 0;
      for (;;) {
        const idx = folded.indexOf(n, from);
        if (idx < 0) break;
        for (let k = owner[idx]; k <= owner[idx + n.length - 1]; k++) marked[k] = true;
        from = idx + n.length;
      }
    }
    let out = '';
    let open = false;
    chars.forEach((c, i) => {
      if (marked[i] !== open) {
        out += open ? '</mark>' : '<mark>';
        open = marked[i];
      }
      out += esc(c);
    });
    return open ? `${out}</mark>` : out;
  }

  function stateOf(p) {
    if (p.status === 'completed') return p.goodiesGivenAt ? 'given' : 'due';
    if (p.status === 'playing') return 'playing';
    if (p.status === 'waiting') return 'waiting';
    return 'none';
  }

  const isExact = (p, q) => {
    const t = normTicket(q);
    return t.length > 0 && normTicket(p.ticket) === t;
  };

  function untilText(endsAt) {
    const left = Math.ceil((endsAt - now()) / MIN);
    return left > 0 ? `dans ${left} min` : 'fin imminente';
  }

  const placeOf = (p) => (p.tableNo ? `Table ${p.tableNo} · ${p.slot}` : '');

  function findPerson(id) {
    const lists = [results || [], view ? view.pending : [], view ? view.recentGiven : []];
    for (const list of lists) {
      const p = list.find((x) => x.id === id);
      if (p) return p;
    }
    return null;
  }

  // ================================================================ réconciliation des listes

  const tpl = document.createElement('template');
  function fromHtml(html) {
    tpl.innerHTML = html.trim();
    return tpl.content.firstElementChild;
  }

  // Sélecteur pour retrouver l'élément qui avait le focus dans une carte reconstruite.
  function focusKey(el) {
    if (!el || !el.dataset || !el.dataset.action) return null;
    return `[data-action="${el.dataset.action}"][data-id="${el.dataset.id}"]`;
  }

  // Remet le focus dans le champ si l'élément focalisé va disparaître (jamais de focus perdu sur <body>).
  function rescueFocus(el) {
    if (el.contains(document.activeElement)) input.focus({ preventScroll: true });
  }

  function setEmpty(container, html) {
    if (container.dataset.emptySig === html) return;
    rescueFocus(container);
    container.innerHTML = html;
    container.dataset.emptySig = html;
  }

  // items → éléments, par clé : une ligne inchangée garde son élément (et son focus), une ligne
  // modifiée est remplacée sur place, seules les lignes nouvelles ou déplacées sont insérées.
  // `live` (mise à jour qui n'a pas été demandée : fin de partie, autre poste) : chaque ligne qui
  // apparaît ou bouge à l'écran est datée (data-moved-at) ; un appui juste après est ignoré, pour
  // ne jamais remettre la carte du voisin qui vient de glisser sous le doigt.
  // Renvoie les éléments remplacés (pour signaler un changement d'état).
  function reconcile(container, items, { key, sig, build, live = false }) {
    if (container.dataset.emptySig) {
      rescueFocus(container);
      container.textContent = '';
      container.dataset.emptySig = '';
    }
    const existing = new Map();
    const before = new Map();
    for (const el of Array.from(container.children)) {
      if (el.dataset.key) {
        existing.set(el.dataset.key, el);
        if (live) before.set(el.dataset.key, Math.round(el.getBoundingClientRect().top));
      } else el.remove();
    }
    const replaced = [];
    const wanted = items.map((item) => {
      const k = String(key(item));
      const s = sig(item);
      let el = existing.get(k);
      if (el) existing.delete(k);
      if (el && el.dataset.sig === s) return el;
      const fresh = fromHtml(build(item));
      fresh.dataset.key = k;
      fresh.dataset.sig = s;
      if (el) {
        const refocus = el.contains(document.activeElement) ? focusKey(document.activeElement) : null;
        replaced.push({ before: el, after: fresh });
        el.replaceWith(fresh);
        const target = refocus && fresh.querySelector(refocus);
        if (target && !target.disabled) target.focus({ preventScroll: true });
        else if (refocus) input.focus({ preventScroll: true });
      }
      return fresh;
    });
    for (const el of existing.values()) {
      rescueFocus(el);
      el.remove();
    }
    wanted.forEach((el, i) => {
      const cur = container.children[i];
      if (cur !== el) container.insertBefore(el, cur || null);
    });
    if (live && !container.hidden) {
      const t = String(Math.round(performance.now()));
      for (const el of wanted) {
        const top = before.get(el.dataset.key);
        if (top === undefined || top !== Math.round(el.getBoundingClientRect().top)) el.dataset.movedAt = t;
      }
    }
    return replaced;
  }

  // ================================================================ zone de retour (hauteur fixe)

  let feedbackHtml = '';
  function setFeedback(html, kind, ms) {
    clearTimeout(feedbackTimer);
    // Consigne identique : rien à réannoncer (pas de relecture à chaque frappe).
    if (kind === 'hint' && feedbackKind === 'hint' && html === feedbackHtml) return;
    feedbackKind = kind;
    feedbackHtml = html;
    const hadFocus = feedback.contains(document.activeElement);
    // Erreur : annoncée tout de suite ; le reste poliment.
    feedback.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
    feedback.innerHTML = html;
    if (hadFocus) input.focus({ preventScroll: true });
    if (ms) {
      feedbackTimer = setTimeout(() => {
        if (feedback.contains(document.activeElement)) input.focus({ preventScroll: true });
        showHint();
      }, ms);
    }
  }

  function showHint() {
    const q = cleanQuery(input.value);
    if (q.length === 1) {
      setFeedback(`<div class="fb fb-hint">${icon('i-info')}<div class="fb-text"><strong>Tapez au moins 2 caractères.</strong><small>Nom, prénom ou n° de billet.</small></div></div>`, 'hint');
      return;
    }
    const tip = isTouch
      ? 'Les résultats s’affichent dès 2 caractères.'
      : 'Résultats dès 2 caractères · n° de billet complet + Entrée : remise directe · Échap : effacer.';
    setFeedback(`<div class="fb fb-hint">${icon('i-info')}<div class="fb-text"><strong>Demandez au visiteur son nom ou son n° de billet.</strong><small>${tip}</small></div></div>`, 'hint');
  }

  function showMessage(kind, title, detail) {
    const ic = kind === 'error' ? 'i-stop' : 'i-info';
    setFeedback(
      `<div class="fb fb-${kind}">${icon(ic)}<div class="fb-text"><strong>${esc(title)}</strong>${detail ? `<small>${esc(detail)}</small>` : ''}</div></div>`,
      kind,
      MESSAGE_MS,
    );
  }

  function showReceipt(p) {
    const name = fullName(p);
    setFeedback(
      `<div class="fb fb-done" style="--bq-undo-ms:${UNDO_MS}ms">${icon('i-check')}
        <div class="fb-text"><strong>Carte promo remise à ${esc(name)}</strong><small>Billet ${esc(p.ticket)} · ${esc(clock(now()))}</small></div>
        <button type="button" class="btn btn-undo-now" data-action="undo-last" data-id="${p.id}" aria-label="Annuler la remise de la carte promo de ${esc(name)}">${icon('i-undo')}Annuler</button>
        <span class="fb-timer" aria-hidden="true"></span>
      </div>`,
      'done',
      UNDO_MS,
    );
  }

  // ================================================================ en-tête

  function renderHeader() {
    const { stats } = view;
    setText($('#stat-pending'), stats.pending);
    $('#stat-pending-box').classList.toggle('is-pending', stats.pending > 0);
    setText($('#stat-given'), stats.givenToday);
    setText($('#stat-playing'), stats.playing);
    setText($('#day-badge'), `Jour ${view.day.number}`);
    const tabPending = $('#tab-pending-count');
    setText(tabPending, stats.pending);
    tabPending.classList.toggle('is-pending', stats.pending > 0);
    setText($('#tab-recent-count'), view.recentGiven.length);
    const title = stats.pending > 0 ? `(${stats.pending}) Boutique – Cartes promo Riftbound` : 'Boutique – Cartes promo Riftbound';
    if (document.title !== title) document.title = title;
    $('#admin-note').hidden = !view.partial;
  }

  function updateListHead() {
    if (layout.dataset.mode === 'results') {
      setText(listTitle, 'Résultats');
      const q = cleanQuery(input.value);
      if (!results) {
        setText(listCount, '…');
        listCount.classList.remove('is-pending');
        setText(listSub, `pour « ${q} »`);
        return;
      }
      const due = results.filter((p) => stateOf(p) === 'due').length;
      setText(listCount, results.length);
      listCount.classList.toggle('is-pending', due > 0);
      setText(listSub, `pour « ${resultsQuery} »${due ? ` · ${plural(due, 'carte à remettre', 'cartes à remettre')}` : ''}`);
    } else {
      setText(listTitle, 'Cartes promo à remettre');
      const n = view ? view.stats.pending : 0;
      setText(listCount, view ? n : '–');
      listCount.classList.toggle('is-pending', n > 0);
      setText(listSub, n > 1 ? 'plus récentes d’abord' : '');
    }
  }

  // ================================================================ liste « À remettre »

  function pendingWhere(p) {
    const parts = [];
    if (p.tableNo) parts.push(placeOf(p));
    if (p.endedAt) parts.push(`terminée ${when(p.endedAt)}`);
    return parts.join(' · ');
  }

  function buildPending(p) {
    const name = fullName(p);
    const isNew = newUntil.has(p.id);
    const otherDay = view && p.dayNumber !== view.day.number;
    const where = pendingWhere(p);
    return `<li class="prow${isNew ? ' is-new' : ''}">
      <div class="prow-main">
        <span class="prow-name">${esc(name)}</span>
        <span class="prow-meta"><span><span class="ticket-lbl">Billet</span> <span class="ticket-val">${esc(p.ticket)}</span></span>${where ? `<span>${esc(where)}</span>` : ''}</span>
      </div>
      ${isNew ? '<span class="chip chip-new">Nouveau</span>' : ''}${otherDay ? `<span class="chip chip-day">Jour ${esc(p.dayNumber)}</span>` : ''}
      <button type="button" class="btn btn-give is-compact" data-action="give" data-id="${p.id}"${busy.has(p.id) ? ' disabled aria-busy="true"' : ''}
        aria-label="Remettre la carte promo à ${esc(name)}, billet ${esc(p.ticket)}">${icon('i-card')}Remettre</button>
    </li>`;
  }

  function renderPending() {
    const items = view.pending;
    if (!items.length) {
      const playing = view.stats.playing;
      setEmpty(
        pendingList,
        `<li class="empty"><strong>Aucune carte promo à remettre pour l’instant.</strong>${
          playing ? `${esc(plural(playing, 'joueur est', 'joueurs sont'))} en jeu : leur carte sera à remettre à la fin de leur partie.` : 'Les joueurs apparaissent ici dès la fin de leur partie.'
        }</li>`,
      );
    } else {
      const day = view.day.number;
      reconcile(pendingList, items, {
        key: (p) => p.id,
        sig: (p) => JSON.stringify([p.firstName, p.lastName, p.ticket, p.dayNumber, day, p.tableNo, p.slot, p.endedAt, isToday(p.endedAt || 0), newUntil.has(p.id), busy.has(p.id)]),
        build: buildPending,
        live: true,
      });
    }
    if (layout.dataset.mode === 'pending') updateListHead();
  }

  function scheduleNewCleanup() {
    clearTimeout(newTimer);
    if (!newUntil.size) return;
    const next = Math.min(...newUntil.values());
    newTimer = setTimeout(() => {
      const t = Date.now();
      for (const [id, until] of newUntil) if (until <= t + 50) newUntil.delete(id);
      if (view) renderPending();
      scheduleNewCleanup();
    }, Math.max(100, next - Date.now()));
  }

  // ================================================================ « Dernières remises »

  function buildRecent(p) {
    const name = fullName(p);
    return `<li class="rrow">
      <span class="rrow-icon">${icon('i-check')}</span>
      <div class="rrow-main">
        <span class="rrow-name">${esc(name)}</span>
        <span class="rrow-meta"><b>${esc(when(p.goodiesGivenAt))}</b> · <span class="nowrap">${esc(p.ticket)}</span></span>
      </div>
      <button type="button" class="btn btn-undo" data-action="undo" data-id="${p.id}" aria-label="Annuler la remise de la carte promo de ${esc(name)}">${icon('i-undo')}<span class="btn-undo-label">Annuler</span></button>
    </li>`;
  }

  function renderRecent() {
    const items = view.recentGiven;
    if (!items.length) {
      setEmpty(recentList, '<li class="empty">Aucune carte promo remise pour l’instant.</li>');
      return;
    }
    reconcile(recentList, items, {
      key: (p) => p.id,
      sig: (p) => JSON.stringify([p.firstName, p.lastName, p.ticket, p.goodiesGivenAt, isToday(p.goodiesGivenAt)]),
      build: buildRecent,
      live: true,
    });
    if (armed && !armed.isConnected) disarm();
  }

  // ================================================================ résultats de recherche

  function stateBox(kind, ic, title, detailHtml) {
    return `<div class="state state-${kind}">${icon(ic)}<div class="state-text"><strong>${esc(title)}</strong>${detailHtml ? `<small>${detailHtml}</small>` : ''}</div></div>`;
  }

  function buildCard(p) {
    const st = stateOf(p);
    const name = fullName(p);
    const q = resultsQuery;
    const nameNeedles = fold(q).split(' ');
    const otherDay = view && p.dayNumber !== view.day.number;
    let body = '';
    let action = '';
    if (st === 'due') {
      const detail = [p.endedAt ? `Partie terminée ${when(p.endedAt)}` : 'Partie terminée', placeOf(p)].filter(Boolean).join(' · ');
      body = stateBox('due', 'i-check', 'Carte promo à remettre', esc(detail));
      action = `<button type="button" class="btn btn-give" data-action="give" data-id="${p.id}"${busy.has(p.id) ? ' disabled aria-busy="true"' : ''}
        aria-label="Remettre la carte promo à ${esc(name)}, billet ${esc(p.ticket)}">${icon('i-card')}Remettre la carte promo</button>`;
    } else if (st === 'given') {
      body = stateBox('given', 'i-stop', `Déjà remise ${dateTime(p.goodiesGivenAt)}`, 'Une seule carte promo par joueur : n’en remettez pas une deuxième.');
    } else if (st === 'playing') {
      const where = placeOf(p);
      const title = p.endsAt
        ? `Partie en cours — ${where ? `${where}, ` : ''}fin vers ${clock(p.endsAt)}`
        : `Partie en cours${where ? ` — ${where}` : ''}`;
      const detail = `${p.endsAt ? `<span data-ends="${Number(p.endsAt)}">${esc(untilText(p.endsAt))}</span> · ` : ''}carte promo à récupérer après la partie.`;
      body = stateBox('playing', 'i-clock', title, detail);
    } else if (st === 'waiting') {
      body = stateBox('waiting', 'i-hourglass', 'Pas encore joué (en file d’attente)', 'La carte promo se récupère après la partie.');
    } else {
      const reason = p.statusLabel || p.status;
      const extra = CAN_REREGISTER.has(p.status) ? ' N’a pas joué : peut se réinscrire à l’accueil.' : '';
      body = stateBox('none', 'i-ban', 'Pas de carte promo', `${esc(`Raison : ${reason}.`)}${esc(extra)}`);
    }
    return `<article class="pcard is-${st}" data-state="${st}" aria-label="${esc(name)}">
      <div class="pcard-id">
        <h3 class="pcard-name">${highlight(name, nameNeedles, fold)}</h3>
        <div class="pcard-meta">
          <span class="ticket"><span class="ticket-lbl">Billet</span><span class="ticket-val">${highlight(p.ticket, [normTicket(q)], normTicket)}</span></span>
          ${isExact(p, q) ? `<span class="chip chip-exact">${icon('i-check')}Billet exact</span>` : ''}
          ${otherDay ? `<span class="chip chip-day">Jour ${esc(p.dayNumber)}</span>` : ''}
        </div>
      </div>
      <div class="pcard-foot">${body}${action}</div>
    </article>`;
  }

  // live : mise à jour venue de l'état (et non de la recherche tapée).
  function renderResults({ live = false } = {}) {
    if (layout.dataset.mode !== 'results') return;
    if (!results) {
      setEmpty(resultsList, '<p class="empty">Recherche…</p>');
    } else if (!results.length) {
      setEmpty(
        resultsList,
        `<p class="empty"><strong>Aucun visiteur trouvé pour « ${esc(resultsQuery)} ».</strong>Vérifiez l’orthographe ou demandez le n° de billet. Un visiteur introuvable ne s’est pas inscrit à l’accueil : pas de carte promo.</p>`,
      );
    } else {
      const day = view ? view.day.number : 0;
      const replaced = reconcile(resultsList, results, {
        key: (p) => p.id,
        sig: (p) => JSON.stringify([resultsQuery, p.firstName, p.lastName, p.ticket, p.status, p.goodiesGivenAt, p.tableNo, p.slot, p.endsAt, p.endedAt, p.dayNumber, day, busy.has(p.id)]),
        build: buildCard,
        live,
      });
      // Changement d'état en direct (fin de partie, remise par un autre poste) : bref liseré.
      for (const { before, after } of replaced) {
        if (before.dataset.state !== after.dataset.state) after.classList.add('is-updated');
      }
    }
    updateListHead();
  }

  function announceResults() {
    if (!results) return;
    const q = resultsQuery;
    const first = results[0];
    let text;
    if (!results.length) text = `Aucun visiteur trouvé pour ${q}.`;
    else if (first && isExact(first, q)) {
      const st = stateOf(first);
      const what = {
        due: 'carte promo à remettre',
        given: `carte promo déjà remise ${dateTime(first.goodiesGivenAt || 0)}`,
        playing: 'partie en cours',
        waiting: 'en file d’attente',
        none: 'pas de carte promo',
      }[st];
      text = `Billet exact : ${fullName(first)}, ${what}.`;
    } else {
      const due = results.filter((p) => stateOf(p) === 'due').length;
      text = `${plural(results.length, 'résultat', 'résultats')}. ${due ? plural(due, 'carte promo à remettre', 'cartes promo à remettre') : 'Aucune carte promo à remettre'}.`;
    }
    srResults.textContent = text;
  }

  // Remet à jour les résultats affichés d'après l'état reçu (sans attendre la recherche relancée).
  function patchResults() {
    if (!results || !view) return;
    const pending = new Map(view.pending.map((p) => [p.id, p]));
    const given = new Map(view.recentGiven.map((p) => [p.id, p]));
    results = results.map((r) => {
      const fresh = pending.get(r.id) || given.get(r.id);
      return fresh ? { ...r, ...fresh, endsAt: null } : r;
    });
  }

  function setMode(mode) {
    if (layout.dataset.mode === mode) return;
    layout.dataset.mode = mode;
    pendingList.hidden = mode !== 'pending';
    resultsList.hidden = mode !== 'results';
    listScroll.scrollTop = 0;
    if (mode === 'results') renderResults();
    updateListHead();
  }

  function setView(v) {
    layout.dataset.view = v;
    for (const tab of document.querySelectorAll('.view-tab')) tab.setAttribute('aria-pressed', String(tab.dataset.view === v));
  }

  function cancelSearch() {
    searchSeq += 1;
    clearTimeout(debounceTimer);
    debounceTimer = 0;
    clearTimeout(refreshTimer);
    refreshTimer = 0;
    userSearchPending = false;
    busyEl.hidden = true;
    results = null;
    resultsQuery = '';
  }

  async function runSearch(q, { silent = false } = {}) {
    clearTimeout(debounceTimer);
    debounceTimer = 0;
    const seq = ++searchSeq;
    if (!silent) {
      userSearchPending = true;
      busyEl.hidden = false;
    }
    try {
      const res = await client.action('boutiqueSearch', { query: q });
      if (seq !== searchSeq) return null;
      results = (Array.isArray(res) ? res : []).map(pick);
      resultsQuery = q;
      renderResults({ live: silent });
      if (!silent) announceResults();
      return results;
    } catch (err) {
      if (seq !== searchSeq) return null;
      if (!silent) {
        results = null;
        resultsQuery = q;
        setEmpty(resultsList, `<p class="empty"><strong>Recherche impossible.</strong>${esc(err.message || 'Erreur inconnue.')}</p>`);
        setText(listCount, '–');
      }
      return null;
    } finally {
      if (seq === searchSeq) {
        userSearchPending = false;
        busyEl.hidden = true;
      }
    }
  }

  // Après un changement d'état : la recherche affichée est relancée discrètement (au plus une fois
  // par REFRESH_MS), sauf si une recherche tapée est en attente (elle sera de toute façon à jour).
  function scheduleRefresh(delay = REFRESH_MS) {
    if (refreshTimer || !results) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = 0;
      const q = cleanQuery(input.value);
      if (q.length >= 2 && q === resultsQuery && !debounceTimer && !userSearchPending && online) runSearch(q, { silent: true });
    }, delay);
  }

  function refreshNow() {
    clearTimeout(refreshTimer);
    refreshTimer = 0;
    scheduleRefresh(0);
  }

  function onInput() {
    clearBtn.hidden = !input.value;
    const q = cleanQuery(input.value);
    clearTimeout(debounceTimer);
    debounceTimer = 0;
    if (q.length < 2) {
      cancelSearch();
      setMode('pending');
      if (feedbackKind === 'hint') showHint();
      return;
    }
    if (feedbackKind === 'hint') showHint();
    if (layout.dataset.mode !== 'results') {
      results = null;
      setMode('results');
    } else updateListHead();
    busyEl.hidden = false;
    debounceTimer = setTimeout(() => {
      debounceTimer = 0;
      runSearch(q);
    }, SEARCH_DEBOUNCE_MS);
  }

  function clearSearch() {
    if (input.value) input.value = '';
    clearBtn.hidden = true;
    cancelSearch();
    setMode('pending');
    if (feedbackKind === 'hint') showHint();
    input.focus({ preventScroll: true });
  }

  // Entrée : recherche immédiate ; n° de billet complet → remise directe si la carte est due
  // (lecteur de code-barres), sinon l'état est rappelé dans la zone de retour.
  async function onEnter() {
    const q = cleanQuery(input.value);
    if (q.length < 2) return;
    const fresh = q === resultsQuery && results && !debounceTimer && !userSearchPending;
    const res = fresh ? results : await runSearch(q);
    if (!res || cleanQuery(input.value) !== q) return;
    const first = res[0];
    if (first && isExact(first, q)) {
      const st = stateOf(first);
      if (st === 'due') {
        give(first.id, null);
      } else if (st === 'given') {
        showMessage('error', `Carte promo déjà remise ${dateTime(first.goodiesGivenAt)}.`, `${fullName(first)} · billet ${first.ticket} : n’en remettez pas une deuxième.`);
      } else if (st === 'playing') {
        showMessage('info', `${fullName(first)} : partie en cours${first.endsAt ? `, fin vers ${clock(first.endsAt)}` : ''}.`, 'Pas de carte promo pour l’instant : elle se récupère à la fin de la partie.');
      } else if (st === 'waiting') {
        showMessage('info', `${fullName(first)} n’a pas encore joué (en file d’attente).`, 'La carte promo se récupère après la partie.');
      } else {
        showMessage('info', `${fullName(first)} : pas de carte promo.`, `Raison : ${first.statusLabel || first.status}.`);
      }
      return;
    }
    // Une seule carte due parmi les résultats : le focus va sur son bouton (Entrée pour remettre).
    const due = res.filter((p) => stateOf(p) === 'due');
    if (due.length === 1) {
      const btn = resultsList.querySelector(`[data-action="give"][data-id="${due[0].id}"]`);
      if (btn) btn.focus();
    }
  }

  // ================================================================ remise et annulation

  function setBusy(id, on) {
    for (const btn of document.querySelectorAll(`[data-action="give"][data-id="${id}"]`)) {
      btn.disabled = on;
      if (on) btn.setAttribute('aria-busy', 'true');
      else btn.removeAttribute('aria-busy');
    }
  }

  function offlineMessage() {
    showMessage('error', 'Hors ligne : rien n’a été enregistré.', 'Notez le n° de billet et cochez-le au retour de la connexion.');
  }

  function flash(el) {
    if (!el) return;
    el.classList.remove('is-updated');
    void el.offsetWidth;
    el.classList.add('is-updated');
  }

  async function give(id, btn) {
    if (busy.has(id)) return;
    if (!online) {
      offlineMessage();
      return;
    }
    const row = btn && btn.closest('[data-key]');
    if (row && performance.now() - Number(row.dataset.movedAt || -1e9) < MOVE_GUARD_MS) {
      showMessage('info', 'La liste vient de changer.', 'Vérifiez le nom, puis appuyez de nouveau.');
      flash(row);
      return;
    }
    const person = findPerson(id);
    busy.add(id);
    setBusy(id, true);
    try {
      await client.action('giveGoodies', { participantId: id, given: true });
      showReceipt(person || { id, firstName: 'Joueur', lastName: '', ticket: '' });
      // Visiteur suivant : champ vidé, liste « À remettre », focus dans le champ.
      if (input.value) {
        input.value = '';
        clearBtn.hidden = true;
        cancelSearch();
        setMode('pending');
      }
      setView('pending');
      input.focus({ preventScroll: true });
    } catch (err) {
      const name = person ? fullName(person) : 'Ce joueur';
      if (err.code === 'already_given') {
        // Deux postes en même temps : la carte a déjà été remise ailleurs.
        const givenAt = err.details && err.details.givenAt;
        if (results && givenAt) {
          results = results.map((r) => (r.id === id ? { ...r, goodiesGivenAt: givenAt } : r));
          renderResults();
          flash(resultsList.querySelector(`[data-key="${id}"]`));
        }
        showMessage('error', err.message || 'Carte promo déjà remise.', `${name}${person ? ` · billet ${person.ticket}` : ''} : n’en remettez pas une deuxième.`);
        refreshNow();
      } else if (err.code === 'conflict' || err.code === 'not_found') {
        showMessage('error', err.message || 'Remise impossible.', `${name} : vérifiez son état ci-dessous.`);
        refreshNow();
      } else {
        showMessage('error', err.message || 'Erreur inconnue.', 'La carte promo n’a pas été enregistrée : réessayez.');
      }
      input.focus({ preventScroll: true });
    } finally {
      busy.delete(id);
      setBusy(id, false);
    }
  }

  async function undo(id, btn) {
    if (!online) {
      offlineMessage();
      return;
    }
    const person = findPerson(id);
    const name = person ? fullName(person) : 'ce joueur';
    if (btn) btn.disabled = true;
    try {
      await client.action('giveGoodies', { participantId: id, given: false });
      showMessage('info', `Remise annulée : ${name}.`, 'Sa carte promo est de nouveau à remettre.');
      refreshNow();
    } catch (err) {
      showMessage('error', err.message || 'Annulation impossible.', 'La remise n’a pas été annulée.');
    } finally {
      if (btn && btn.isConnected) btn.disabled = false;
      input.focus({ preventScroll: true });
    }
  }

  function disarm() {
    clearTimeout(armedTimer);
    if (armed && armed.isConnected) {
      armed.classList.remove('is-confirm');
      const label = armed.querySelector('.btn-undo-label');
      if (label) label.textContent = 'Annuler';
      if (armed.dataset.label) armed.setAttribute('aria-label', armed.dataset.label);
    }
    armed = null;
  }

  // « Annuler » dans « Dernières remises » : un premier appui demande confirmation (5 s).
  function undoRecent(btn, id) {
    if (armed === btn) {
      disarm();
      undo(id, btn);
      return;
    }
    disarm();
    armed = btn;
    btn.classList.add('is-confirm');
    const label = btn.querySelector('.btn-undo-label');
    if (label) label.textContent = 'Confirmer l’annulation';
    btn.dataset.label = btn.getAttribute('aria-label') || '';
    btn.setAttribute('aria-label', `Confirmer l’annulation : ${btn.dataset.label.replace(/^Annuler /, '')}`);
    armedTimer = setTimeout(disarm, CONFIRM_MS);
  }

  // ================================================================ état en direct

  function onState(raw) {
    if (!raw || !raw.day) return;
    const next = adapt(raw);
    const prevGiven = view ? new Set(view.recentGiven.map((p) => p.id)) : new Set();
    const ids = new Set(next.pending.map((p) => p.id));
    if (knownPending) {
      // Nouvelles cartes à remettre (fin de partie) ; pas une remise annulée.
      const fresh = next.pending.filter((p) => !knownPending.has(p.id) && !prevGiven.has(p.id));
      if (fresh.length) {
        const until = Date.now() + NEW_HIGHLIGHT_MS;
        for (const p of fresh) newUntil.set(p.id, until);
        srNews.textContent = fresh.length === 1
          ? `Nouvelle carte promo à remettre : ${fullName(fresh[0])}.`
          : `${fresh.length} nouvelles cartes promo à remettre.`;
      }
    }
    for (const id of newUntil.keys()) if (!ids.has(id)) newUntil.delete(id);
    knownPending = ids;
    view = next;
    renderHeader();
    renderPending();
    renderRecent();
    scheduleNewCleanup();
    if (results) {
      patchResults();
      renderResults({ live: true });
      scheduleRefresh();
    }
  }

  function setConnection(isOnline) {
    online = isOnline;
    const conn = $('#conn');
    conn.dataset.state = isOnline ? 'online' : 'offline';
    setText($('#conn-label'), isOnline ? 'Connecté' : 'Déconnecté');
    $('#offline-banner').hidden = isOnline;
    document.body.classList.toggle('is-offline', !isOnline);
    if (isOnline && results) refreshNow();
  }

  // ================================================================ événements

  input.addEventListener('input', onInput);

  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      clearSearch();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onEnter();
    }
  });

  clearBtn.addEventListener('click', clearSearch);

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const id = Number(btn.dataset.id);
    if (!Number.isSafeInteger(id) || id <= 0) return;
    if (btn.dataset.action === 'give') give(id, btn);
    else if (btn.dataset.action === 'undo-last') undo(id, btn);
    else if (btn.dataset.action === 'undo') undoRecent(btn, id);
  });

  for (const tab of document.querySelectorAll('.view-tab')) {
    tab.addEventListener('click', () => setView(tab.dataset.view));
  }

  const TEXT_TYPES = new Set(['text', 'search', 'email', 'number', 'tel', 'url', 'password']);
  const isTextEntry = (el) => !!el && el.tagName === 'INPUT' && TEXT_TYPES.has(el.type);

  // Hors du champ (focus sur un bouton) : Échap vide la recherche, une lettre tapée (ou un lecteur de
  // code-barres) revient dans le champ.
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target === input || isTextEntry(e.target)) return;
    if (e.key === 'Escape') {
      if (armed) disarm();
      else clearSearch();
      return;
    }
    if ((e.key.length === 1 && e.key !== ' ') || e.key === 'Backspace') input.focus({ preventScroll: true });
  });

  // « dans N min » des parties en cours.
  setInterval(() => {
    for (const el of resultsList.querySelectorAll('[data-ends]')) setText(el, untilText(Number(el.dataset.ends)));
  }, 20000);

  // ================================================================ démarrage

  showHint();
  client = LC.connect({
    onState,
    onStatus: setConnection,
    onSession: (session) => {
      const role = session && session.role;
      if (!role) {
        window.location.href = LOGIN_URL;
        return;
      }
      $('#link-accueil').hidden = role !== 'admin';
    },
  });
  input.focus({ preventScroll: true });
})();
