/* ============================================================
   render.js — 由 song.json 驱动整页渲染
   约定：window.SONG 由 build 注入；所有文案在 JSON 里，脚本不含任何歌曲内容
   板块开关：SONG.modules 里把某项设为 false，该 section 会被移除
             （导航、章节编号、顶部数据条自动跟随）
   ============================================================ */
(function () {
  'use strict';

  const SONG   = window.SONG || {};
  const META   = SONG.meta || {};
  const LYRIC  = SONG.lines || [];
  const VOCAB  = SONG.vocab || [];
  const GRAM   = SONG.grammar || [];
  const QUIZ   = SONG.quiz || [];
  const PLAN   = (SONG.plan && SONG.plan.days) || [];
  const SEGS   = SONG.segments || [];
  const NS     = 'jss.' + (META.slug || 'default') + '.';

  const ALL_SECTIONS = ['map', 'lyrics', 'lines', 'vocab', 'grammar', 'listen', 'studio', 'quiz', 'plan'];
  const MODULES = Object.assign({}, ...ALL_SECTIONS.map(k => ({ [k]: true })), SONG.modules || {});
  const on = k => MODULES[k] !== false;

  /* ---------------- 基础工具 ---------------- */
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const store = {
    get(k, d) { try { const v = localStorage.getItem(NS + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch (e) {} }
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const escapeAttr = escapeHtml;

  /* 把 漢字[かな] 转成 ruby */
  function ruby(s) {
    return escapeHtml(s).replace(/([\u4e00-\u9fff々〆]+)\[([^\]]+)\]/g,
      (m, kanji, kana) => '<ruby>' + kanji + '<rt>' + kana + '</rt></ruby>');
  }
  function plain(s) { return String(s || '').replace(/\[([^\]]+)\]/g, ''); }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  const SPEAKER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
  const CHECK   = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 12 5 5L20 6"/></svg>';

  const TONE_COLOR = { a: '#BFE0D8', b: '#F7CFA6', s: '#F3C3CC', c: '#C4D3EB', i: '#E3DFD6' };

  /* ---------------- 语音 ---------------- */
  let jaVoice = null;
  function pickVoice() {
    if (!('speechSynthesis' in window)) return;
    const vs = speechSynthesis.getVoices() || [];
    jaVoice = vs.find(v => v.lang === 'ja-JP') || vs.find(v => (v.lang || '').indexOf('ja') === 0) || null;
  }
  function speak(text) {
    if (!('speechSynthesis' in window) || !text) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP';
      u.rate = 0.82;
      if (jaVoice) u.voice = jaVoice;
      speechSynthesis.speak(u);
    } catch (e) {}
  }
  if ('speechSynthesis' in window) {
    pickVoice();
    speechSynthesis.addEventListener('voiceschanged', pickVoice);
  }

  /* ---------------- 板块卸载 + 章节编号重排 ---------------- */
  function renumberSections() {
    $$('main > section').forEach((s, i) => {
      const n = s.querySelector('.sec-num');
      if (n) n.textContent = String(i + 1).padStart(2, '0');
    });
  }

  ALL_SECTIONS.forEach(k => {
    if (!on(k)) {
      const el = document.getElementById(k);
      if (el) el.remove();
    }
  });
  renumberSections();

  /* ---------------- 首屏右侧：封面 ----------------
     meta.cover = "disc"  → 用模板里的 CD 图形
     meta.cover = 图片路径 → 图片封面
     不填（默认）        → 排版式封面（纯 CSS + 文字，随歌名生成）
  */
  function renderHeroArt() {
    const box = $('#hero-art');
    if (!box) return;
    const cover = META.cover;

    if (cover === 'disc') return;

    if (cover && cover !== 'type') {
      const alt = META.coverAlt || ((META.titleLine1 || '') + ' ' + (META.titleLine2 || '') + ' 封面').trim();
      box.innerHTML = '<figure class="cover cover--img"><img src="' + escapeAttr(cover) + '" alt="' + escapeAttr(alt) + '"'
        + ' loading="eager" decoding="async"></figure>';
      return;
    }

    const work = String(META.kicker || '').split('·')[0].trim().toUpperCase();
    const title = escapeHtml(META.titleLine1 || '')
      + (META.titleLine2 ? '<br>' + escapeHtml(META.titleLine2) : '');

    box.innerHTML = '<figure class="cover cover--type">'
      + '<span class="cover-ring" aria-hidden="true"></span>'
      + '<div class="cover-inner">'
      +   '<div class="cover-row">'
      +     '<span class="cover-tag">' + escapeHtml(META.coverTag || 'Single') + '</span>'
      +     '<span class="cover-year">' + escapeHtml(META.discLabel || '') + '</span>'
      +   '</div>'
      +   '<div class="cover-mid">'
      +     (work ? '<span class="cover-work">' + escapeHtml(work) + '</span>' : '')
      +     '<span class="cover-title">' + title + '</span>'
      +     '<span class="cover-artist">' + escapeHtml(META.artist || '') + '</span>'
      +   '</div>'
      +   '<div class="cover-foot">'
      +     '<span>' + escapeHtml(META.subtitle || '歌詞精読') + '</span>'
      +     '<span>' + escapeHtml(META.level || '') + '</span>'
      +   '</div>'
      + '</div></figure>';
  }

  /* ---------------- 完整歌词 ---------------- */
  function renderLyrics() {
    const box = $('#lyrics-body');
    if (!box) return;
    const L = SONG.lyrics;
    const blocks = (L && Array.isArray(L.blocks))
      ? L.blocks.filter(b => b && Array.isArray(b.lines) && b.lines.length) : [];

    /* 没有歌词数据就把这一节整块撤掉，章节编号重新排 */
    if (!blocks.length) {
      const sec = document.getElementById('lyrics');
      if (sec) { sec.remove(); renumberSections(); }
      return;
    }

    box.innerHTML = blocks.map(b => {
      const head = '<div class="lyr-head"><span>' + escapeHtml(b.label || '')
        + '</span>' + (b.time ? '<em>' + escapeHtml(b.time) + '</em>' : '') + '</div>';
      const lines = b.lines.map(l =>
        '<p class="lyr-line" data-say="' + escapeAttr(plain(l)) + '">' + ruby(l) + '</p>').join('');
      return '<div class="lyr-block" data-tone="' + escapeAttr(b.tone || 'a') + '">'
        + head + lines + '</div>';
    }).join('');

    const foot = $('#lyrics-foot');
    if (foot) {
      foot.innerHTML = L.foot
        || '点任意一行可以朗读。这一段是整首歌词，方便对照听唱；注音与逐句讲解见下一节。';
    }
  }

  /* ---------------- 导航 ---------------- */
  const BACK_ARROW = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">'
    + '<path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.7" '
    + 'stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* 返回合集入口：meta.backHref 不填默认 ../index.html，显式写空则不显示 */
  function backLink() {
    const href = META.backHref === undefined ? '../index.html' : META.backHref;
    if (!href) return '';
    return '<a class="nav-back" href="' + escapeAttr(href) + '">' + BACK_ARROW
      + escapeHtml(META.backLabel || '合集') + '</a>';
  }

  function renderNav() {
    const items = (SONG.nav || []).filter(n => document.getElementById(n.id));
    const links = items.map((n, i) =>
      '<a class="nav-link' + (i === 0 ? ' is-active' : '') + '" href="#' + escapeAttr(n.id) + '">' + escapeHtml(n.label) + '</a>').join('');
    $('#nav-inner').innerHTML = backLink() + links
      + '<div class="nav-spacer"></div>'
      + '<div class="nav-progress"><span id="nav-progress-text">已掌握 0 / 0</span><span class="bar"><i id="nav-progress-bar"></i></span></div>';
  }

  /* ---------------- 顶部数据条 ---------------- */
  const STAT_VALUE = {
    lines: () => LYRIC.length,
    vocab: () => VOCAB.length,
    grammar: () => GRAM.length,
    quiz: () => QUIZ.length
  };

  function renderStats() {
    const box = $('#hero-stats');
    if (!box) return;
    const items = (SONG.stats || []).filter(s => !s.module || on(s.module));
    box.style.setProperty('--stat-cols', items.length || 1);
    box.innerHTML = items.map(s => {
      const v = STAT_VALUE[s.key] ? STAT_VALUE[s.key]() : (s.value != null ? s.value : 0);
      return '<div class="stat"><b>' + v + '</b><span>' + escapeHtml(s.label) + '</span></div>';
    }).join('');
  }

  /* ---------------- 徽章 / 为什么 / 结构 / 步骤 ---------------- */
  function renderBadges() {
    const el = $('#badges');
    if (!el) return;
    el.innerHTML = (META.badges || []).map((b, i) =>
      '<span class="badge ' + (i === 0 ? 'badge--level' : 'badge--dot') + '">' + escapeHtml(b) + '</span>').join('');
  }

  function renderWhy() {
    const el = $('#why-list');
    if (!el) return;
    el.innerHTML = ((SONG.map && SONG.map.why) || []).map((w, i) =>
      '<li class="why-item"><span class="why-idx">' + (i + 1) + '</span>'
      + '<div><b>' + escapeHtml(w.t) + '</b><p>' + escapeHtml(w.d) + '</p></div></li>').join('');
  }

  function renderStructure() {
    const box = $('#struct');
    if (!box) return;
    const blocks = (SONG.map && SONG.map.blocks) || [];
    box.innerHTML = blocks.map(b =>
      '<button class="st-' + escapeAttr(b.tone || 'a') + '" data-filter="' + escapeAttr(b.key || '') + '"'
      + ' data-min="' + escapeAttr(b.time || '') + '" style="--w:' + (b.weight || 10) + '">'
      + escapeHtml(b.label) + '<small>' + escapeHtml(b.role || '') + '</small></button>').join('');

    const lg = $('#struct-legend');
    if (lg) {
      lg.innerHTML = ((SONG.map && SONG.map.legend) || []).map(l =>
        '<span><i style="background:' + (TONE_COLOR[l.tone] || TONE_COLOR.i) + '"></i>' + escapeHtml(l.label) + '</span>').join('');
    }
  }

  function renderSteps() {
    const el = $('#steps');
    if (!el) return;
    el.innerHTML = (SONG.steps || []).map(s =>
      '<div class="step"><em>' + escapeHtml(s.k) + '</em><b>' + escapeHtml(s.t) + '</b><p>' + escapeHtml(s.d) + '</p></div>').join('');
  }

  /* ---------------- 逐句精读 ---------------- */
  function initLines() {
    const list = $('#lyric-list');
    const empty = $('#lyric-empty');
    if (!list) return;

    let currentSec = 'all';

    function render() {
      const items = currentSec === 'all' ? LYRIC : LYRIC.filter(x => x.sec === currentSec);
      list.innerHTML = items.map(it => {
        const words = (it.words || []).map(w =>
          '<span class="wchip"><b>' + escapeHtml(w[0]) + '</b><i>' + escapeHtml(w[1]) + '</i><em>' + escapeHtml(w[2]) + '</em></span>'
        ).join('');
        const say = escapeAttr(plain(it.jp));
        return '<article class="lyric reveal in" data-sec="' + escapeAttr(it.sec) + '">'
          + '<div class="lyric-main">'
          +   '<div class="lyric-top">'
          +     '<p class="lyric-jp" lang="ja">' + ruby(it.jp) + '</p>'
          +     '<button class="icon-btn" data-say="' + say + '" aria-label="朗读这一句">' + SPEAKER + '</button>'
          +   '</div>'
          +   '<p class="lyric-tr">' + escapeHtml(it.tr) + '</p>'
          + '</div>'
          + '<div class="lyric-side">'
          +   '<div class="words">' + words + '</div>'
          +   '<div class="note"><b>语法</b> ' + (it.g || '') + '</div>'
          +   '<p class="nuance">▸ ' + (it.n || '') + '</p>'
          + '</div>'
          + '</article>';
      }).join('');
      if (empty) empty.hidden = items.length > 0;
    }

    const filters = $('#sec-filters');
    if (filters) {
      filters.innerHTML = '<button class="filter is-on" data-sec="all">全部</button>'
        + SEGS.map(s => '<button class="filter" data-sec="' + escapeAttr(s.key) + '">' + escapeHtml(s.label) + '</button>').join('');
      filters.addEventListener('click', e => {
        const btn = e.target.closest('.filter');
        if (!btn) return;
        $$('.filter', filters).forEach(b => b.classList.remove('is-on'));
        btn.classList.add('is-on');
        currentSec = btn.dataset.sec;
        render();
      });
    }

    const struct = $('#struct');
    if (struct) {
      struct.addEventListener('click', e => {
        const btn = e.target.closest('button');
        if (!btn) return;
        currentSec = btn.dataset.filter;
        if (filters) $$('.filter', filters).forEach(b => b.classList.toggle('is-on', b.dataset.sec === currentSec));
        render();
        const target = document.getElementById('lines');
        if (target) target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      });
    }

    const furi = $('#t-furi');
    if (furi) {
      const saved = store.get('furi', true);
      furi.checked = saved;
      document.body.classList.toggle('hide-furi', !saved);
      furi.addEventListener('change', e => {
        document.body.classList.toggle('hide-furi', !e.target.checked);
        store.set('furi', e.target.checked);
      });
    }

    const tr = $('#t-tr');
    if (tr) {
      const saved = store.get('tr', true);
      tr.checked = saved;
      document.body.classList.toggle('hide-tr', !saved);
      tr.addEventListener('change', e => {
        document.body.classList.toggle('hide-tr', !e.target.checked);
        store.set('tr', e.target.checked);
      });
    }

    render();
  }

  /* ---------------- 词汇表 ---------------- */
  function initVocab() {
    const body = $('#v-body');
    const search = $('#v-search');
    if (!body || !search) return;

    const keyOf = v => v.k + '|' + v.r;
    const mastery = new Set(store.get('mastery', []));
    let level = 'all';
    let undone = false;

    function updateProgress() {
      const total = VOCAB.length;
      const done = mastery.size;
      const pct = total ? Math.round(done / total * 100) : 0;
      const t = $('#nav-progress-text');
      if (t) t.textContent = '已掌握 ' + done + ' / ' + total;
      const bar = $('#nav-progress-bar');
      if (bar) bar.style.width = pct + '%';
      const vp = $('#v-progress');
      if (vp) vp.textContent = '已掌握 ' + done + '（' + pct + '%）';
    }

    function render() {
      const q = search.value.trim().toLowerCase();
      const rows = VOCAB.filter(v => {
        if (level !== 'all' && v.lv !== level) return false;
        if (undone && mastery.has(keyOf(v))) return false;
        if (!q) return true;
        return (v.k + v.r + v.cn + v.p).toLowerCase().indexOf(q) > -1;
      });

      body.innerHTML = rows.length ? rows.map(v => {
        const k = keyOf(v);
        const done = mastery.has(k);
        return '<tr' + (done ? ' class="done"' : '') + '>'
          + '<td><button class="v-check" role="switch" aria-checked="' + done + '" aria-label="标记 ' + escapeAttr(v.k) + ' 已掌握" data-key="' + escapeAttr(k) + '">' + CHECK + '</button></td>'
          + '<td class="v-word" lang="ja">' + escapeHtml(v.k) + '</td>'
          + '<td class="v-read" lang="ja">' + escapeHtml(v.r) + '</td>'
          + '<td class="v-pos">' + escapeHtml(v.p || '') + '</td>'
          + '<td class="v-cn">' + escapeHtml(v.cn) + '</td>'
          + '<td><span class="lv lv-' + v.lv + '">' + v.lv + '</span></td>'
          + '<td><button class="icon-btn" data-say="' + escapeAttr(v.k) + '" aria-label="朗读 ' + escapeAttr(v.k) + '">' + SPEAKER + '</button></td>'
          + '</tr>';
      }).join('') : '<tr><td colspan="7" style="text-align:center;padding:2.4rem 1rem;color:var(--ink-3);font-size:.86rem">没有匹配的词，换个关键词试试。</td></tr>';

      $('#v-count').textContent = '共 ' + VOCAB.length + ' 个词，当前显示 ' + rows.length + ' 个';
      updateProgress();
    }

    body.addEventListener('click', e => {
      const btn = e.target.closest('.v-check');
      if (!btn) return;
      const k = btn.dataset.key;
      if (mastery.has(k)) mastery.delete(k); else mastery.add(k);
      store.set('mastery', Array.from(mastery));
      render();
    });

    search.addEventListener('input', render);

    $$('#v-levels .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        $$('#v-levels .chip').forEach(c => c.classList.remove('is-on'));
        chip.classList.add('is-on');
        level = chip.dataset.lv;
        render();
      });
    });

    const undoneBtn = $('#v-undone');
    if (undoneBtn) {
      undoneBtn.addEventListener('click', e => {
        undone = !undone;
        e.currentTarget.classList.toggle('is-on', undone);
        render();
      });
    }

    const reset = $('#v-reset');
    if (reset) {
      reset.addEventListener('click', () => {
        mastery.clear();
        store.set('mastery', []);
        render();
      });
    }

    render();
  }

  /* ---------------- 语法 ---------------- */
  function initGrammar() {
    const el = $('#grammar-list');
    if (!el) return;
    el.innerHTML = GRAM.map(g =>
      '<details class="g reveal">'
      + '<summary>'
      +   '<div class="g-head"><span class="g-pattern" lang="ja">' + escapeHtml(g.p) + '</span><span class="g-sub">' + escapeHtml(g.sub) + '</span></div>'
      +   '<span class="g-plus" aria-hidden="true">+</span>'
      + '</summary>'
      + '<div class="g-body">'
      +   '<dl style="display:grid;gap:.55rem;margin:0">'
      +     '<div class="g-row"><dt>接续</dt><dd><span class="g-eg">' + escapeHtml(g.form) + '</span></dd></div>'
      +     '<div class="g-row"><dt>意思</dt><dd>' + escapeHtml(g.mean) + '</dd></div>'
      +     '<div class="g-row"><dt>原句</dt><dd><span class="g-eg" lang="ja">' + escapeHtml(g.eg) + '</span></dd></div>'
      +   '</dl>'
      +   '<p class="g-warn"><b>注意</b> ' + escapeHtml(g.warn) + '</p>'
      + '</div>'
      + '</details>').join('');
  }

  /* ---------------- 听说训练 ---------------- */
  function initListen() {
    const el = $('#listen-grid');
    if (!el) return;
    el.innerHTML = (SONG.listen || []).map(c =>
      '<div class="lcard reveal"><em>' + escapeHtml(c.tag) + '</em><b>' + escapeHtml(c.t) + '</b>'
      + '<p>' + escapeHtml(c.d) + '</p><div class="ex">' + (c.ex || '') + '</div></div>').join('');
  }

  /* ---------------- 填空测验 ---------------- */
  function initQuiz() {
    const list = $('#quiz-list');
    if (!list) return;

    let score = 0;
    let answered = 0;
    let best = store.get('best', null);

    function paintBest() {
      const el = $('#quiz-best');
      if (el) el.textContent = best === null ? '—' : best + ' / ' + QUIZ.length;
    }

    function render() {
      score = 0; answered = 0;
      $('#quiz-score').textContent = '0';
      $('#quiz-total').textContent = QUIZ.length;

      list.innerHTML = QUIZ.map((q, i) => {
        const opts = shuffle(q.opts.slice()).map(o =>
          '<button class="opt" data-opt="' + escapeAttr(o) + '" lang="ja">' + escapeHtml(o) + '</button>').join('');
        return '<div class="q" data-i="' + i + '">'
          + '<span class="q-num">Q ' + String(i + 1).padStart(2, '0') + '</span>'
          + '<p class="q-text" lang="ja">' + escapeHtml(q.q).replace('【】', '<u></u>') + '</p>'
          + '<div class="q-opts">' + opts + '</div>'
          + '<div class="q-why"><b>解析</b> ' + escapeHtml(q.why) + '</div>'
          + '</div>';
      }).join('');
      paintBest();
    }

    list.addEventListener('click', e => {
      const btn = e.target.closest('.opt');
      if (!btn) return;
      const card = btn.closest('.q');
      if (card.classList.contains('answered')) return;

      const q = QUIZ[Number(card.dataset.i)];
      card.classList.add('answered');
      answered++;

      $$('.opt', card).forEach(b => {
        b.disabled = true;
        if (b.dataset.opt === q.a) b.classList.add('correct');
      });
      if (btn.dataset.opt !== q.a) btn.classList.add('wrong');
      else score++;

      $('#quiz-score').textContent = score;

      if (answered === QUIZ.length && (best === null || score > best)) {
        best = score;
        store.set('best', best);
        paintBest();
      }
    });

    const reset = $('#quiz-reset');
    if (reset) reset.addEventListener('click', render);

    render();
  }

  /* ---------------- 学习计划 ---------------- */
  function initPlan() {
    const grid = $('#plan-grid');
    if (!grid) return;

    const done = new Set(store.get('plan', []));

    grid.innerHTML = PLAN.map((d, i) => {
      const isDone = done.has(i);
      return '<div class="day' + (isDone ? ' done' : '') + '" data-i="' + i + '">'
        + '<div class="day-d"><em>' + escapeHtml(d.d) + '</em><small>' + escapeHtml(d.m || '') + '</small></div>'
        + '<div class="day-mid"><b>' + escapeHtml(d.t) + '</b><p>' + escapeHtml(d.p) + '</p></div>'
        + '<label class="day-check"><input type="checkbox" data-day="' + i + '"' + (isDone ? ' checked' : '') + '> 完成</label>'
        + '</div>';
    }).join('');

    grid.addEventListener('change', e => {
      const cb = e.target.closest('input[data-day]');
      if (!cb) return;
      const i = Number(cb.dataset.day);
      if (cb.checked) done.add(i); else done.delete(i);
      store.set('plan', Array.from(done));
      cb.closest('.day').classList.toggle('done', cb.checked);
    });
  }

  /* ---------------- 歌词工作台 ---------------- */
  function initStudio() {
    const paste = $('#paste');
    const out = $('#studio-out');
    if (!paste || !out) return;

    const SURF = new Map();
    VOCAB.forEach(v => {
      const put = s => { if (s && s.length >= 1 && !SURF.has(s)) SURF.set(s, v); };
      put(v.k);
      if (v.k.length >= 2) {
        if (/[るうくすむぶつぬぐ]$/.test(v.k)) put(v.k.slice(0, -1));
        if (/い$/.test(v.k)) put(v.k.slice(0, -1));
      }
    });
    const keys = Array.from(SURF.keys()).sort((a, b) => b.length - a.length);
    const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(keys.map(reEsc).join('|'), 'g');

    const TIP_HTML = '<p class="tip">粘贴之后，这里会显示带标注的歌词。<br>标了底色的词，把鼠标停上去可以看到读音和释义。</p>';

    function annotate(text) {
      let total = 0;
      const html = text.split(/\r?\n/).slice(0, 260).map(line => {
        if (!line.trim()) return '<div class="line">&nbsp;</div>';
        const marked = escapeHtml(line).replace(re, m => {
          const v = SURF.get(m);
          if (!v) return m;
          total++;
          const tip = v.k + '（' + v.r + '） ' + v.cn;
          return '<span class="hl" tabindex="0" data-tip="' + escapeAttr(tip) + '" title="' + escapeAttr(tip) + '">' + m + '</span>';
        });
        return '<div class="line">' + marked + '</div>';
      }).join('');
      return { html, total };
    }

    let timer = null;

    function render() {
      if (!paste.value.trim()) {
        out.innerHTML = TIP_HTML;
        $('#studio-count').textContent = '0';
        return;
      }
      const r = annotate(paste.value);
      out.innerHTML = r.html;
      $('#studio-count').textContent = String(r.total);
    }

    const saved = store.get('lyrics', '');
    if (saved) paste.value = saved;

    paste.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        render();
        store.set('lyrics', paste.value);
      }, 180);
    });

    const clear = $('#studio-clear');
    if (clear) {
      clear.addEventListener('click', () => {
        paste.value = '';
        store.set('lyrics', '');
        render();
      });
    }

    render();
  }

  /* ---------------- 启动 ---------------- */
  renderLyrics();
  renderNav();
  renderStats();
  renderHeroArt();
  renderBadges();
  renderWhy();
  renderStructure();
  renderSteps();
  initLines();
  initVocab();
  initGrammar();
  initListen();
  initQuiz();
  initPlan();
  initStudio();

  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-say]');
    if (btn) speak(btn.dataset.say);
  });

  /* 滚动高亮 */
  const navLinks = $$('.nav-link');
  const sections = navLinks.map(a => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);

  if ('IntersectionObserver' in window) {
    const spy = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (en.isIntersecting) {
          navLinks.forEach(a => a.classList.toggle('is-active', a.getAttribute('href') === '#' + en.target.id));
        }
      });
    }, { rootMargin: '-20% 0px -70% 0px', threshold: 0 });
    sections.forEach(s => spy.observe(s));

    const revealer = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          revealer.unobserve(en.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    $$('.reveal').forEach(el => revealer.observe(el));
  } else {
    $$('.reveal').forEach(el => el.classList.add('in'));
  }
})();
