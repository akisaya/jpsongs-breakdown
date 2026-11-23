/* ============================================================
   render.js — 由 song.json 驱动整页渲染
   约定：window.SONG 由 build 注入；所有文案在 JSON 里，脚本不含任何歌曲内容
   页面在语法图谱结束；完整歌词可省略，导航和章节编号自动跟随
   ============================================================ */
(function () {
  'use strict';

  const SONG   = window.SONG || {};
  const META   = SONG.meta || {};
  const LYRIC  = SONG.lines || [];
  const VOCAB  = SONG.vocab || [];
  const GRAM   = SONG.grammar || [];
  const NS     = 'jss.' + (META.slug || 'default') + '.';

  const ALL_SECTIONS = ['map', 'lyrics', 'lines', 'vocab', 'grammar'];
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

  const SPEAKER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
  const CHECK   = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 12 5 5L20 6"/></svg>';

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

    box.innerHTML = blocks.map((b, i) => {
      const head = '<h3 class="lyr-head">段落 ' + String(i + 1).padStart(2, '0') + '</h3>';
      const lines = b.lines.map(l =>
        '<p class="lyr-line" lang="ja"><span>' + ruby(l) + '</span>'
        + '<button class="icon-btn lyr-speak" data-say="' + escapeAttr(plain(l))
        + '" aria-label="朗读这一行">' + SPEAKER + '</button></p>').join('');
      return '<div class="lyr-block">'
        + head + lines + '</div>';
    }).join('');

    const foot = $('#lyrics-foot');
    if (foot) {
      foot.innerHTML = L.foot
        || '点击行末的喇叭可以朗读；注音与逐句讲解见下一节。';
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
    grammar: () => GRAM.length
  };

  function renderStats() {
    const box = $('#hero-stats');
    if (!box) return;
    const items = SONG.stats || [];
    box.style.setProperty('--stat-cols', items.length || 1);
    box.innerHTML = items.map(s => {
      const v = STAT_VALUE[s.key] ? STAT_VALUE[s.key]() : (s.value != null ? s.value : 0);
      return '<div class="stat"><b>' + v + '</b><span>' + escapeHtml(s.label) + '</span></div>';
    }).join('');
  }

  /* ---------------- 徽章 / 为什么 / 步骤 ---------------- */
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

  function renderSteps() {
    const el = $('#steps');
    if (!el) return;
    el.innerHTML = (SONG.steps || []).map(s =>
      '<div class="step"><em>' + escapeHtml(s.k) + '</em><b>' + escapeHtml(s.t) + '</b><p>' + escapeHtml(s.d) + '</p></div>').join('');
  }

  /* ---------------- 逐句精读 ---------------- */
  function initLines() {
    const list = $('#lyric-list');
    if (!list) return;

    function render() {
      list.innerHTML = LYRIC.map(it => {
        const words = (it.words || []).map(w =>
          '<span class="wchip"><b>' + escapeHtml(w[0]) + '</b><i>' + escapeHtml(w[1]) + '</i><em>' + escapeHtml(w[2]) + '</em></span>'
        ).join('');
        const say = escapeAttr(plain(it.jp));
        return '<article class="lyric reveal in">'
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
      +   '<div class="g-examples"><h4>例句</h4><ol>'
      +     g.examples.map(e => '<li><p class="g-example-jp" lang="ja">' + ruby(e.jp) + '</p>'
      +       '<p class="g-example-tr">' + escapeHtml(e.tr) + '</p></li>').join('')
      +   '</ol></div>'
      +   '<p class="g-warn"><b>注意</b> ' + escapeHtml(g.warn) + '</p>'
      + '</div>'
      + '</details>').join('');
  }

  /* ---------------- 启动 ---------------- */
  renderLyrics();
  renderNav();
  renderStats();
  renderHeroArt();
  renderBadges();
  renderWhy();
  renderSteps();
  initLines();
  initVocab();
  initGrammar();

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
