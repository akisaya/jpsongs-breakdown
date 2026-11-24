#!/usr/bin/env node
/**
 * check.js — 生成页验收（无头 Chrome）
 *
 *   node check.js <index.html> [--shots]
 *
 * 检查项：控制台错误 / 板块是否按配置裁剪 / 结构完整性 / 显示切换 / 掌握进度 /
 *         语法例句 / 多断点横向溢出
 * 依赖：playwright-core。缺失时自动降级为静态检查。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2).filter(a => a !== '--shots');
const shots = process.argv.includes('--shots');
const target = path.resolve(args[0] || 'index.html');

if (!fs.existsSync(target)) {
  console.error('✗ 找不到文件: ' + target);
  process.exit(1);
}

const html = fs.readFileSync(target, 'utf8');
const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);

const present = new Set(
  Array.from(html.matchAll(/<section class="section" id="([\w-]+)"/g)).map(m => m[1])
);
const has = k => present.has(k);

/* ---------- 静态检查（永远可跑） ---------- */
const statics = [];
const sp = (ok, msg) => statics.push((ok ? '✓ ' : '✗ ') + msg);

['map', 'lines', 'vocab', 'grammar'].forEach(k => sp(has(k), `含板块 ${k}`));
sp(html.includes('id="lyric-list"'), '含 id="lyric-list"');
/* 默认包含完整歌词；显式关闭时才省略 */
if (has('lyrics')) {
  sp(html.includes('id="lyrics-body"'), '含完整歌词容器 id="lyrics-body"');
}
sp(html.includes('id="v-body"'), '含 id="v-body"');
sp(html.includes('id="grammar-list"'), '含 id="grammar-list"');
sp(html.includes('window.SONG'), '含 window.SONG');
sp(!/__SONG_JSON__|__CSS__|__RENDER_JS__/.test(html), '无未替换的构建占位符');
sp(!/\{\{[\w.]+\}\}/.test(html), '无未替换的 {{}} 占位符');
sp(!/id="(?:struct|struct-legend|sec-filters)"/.test(html), '无曲式时间轴、图例或筛选器');
sp(!/id="steps"/.test(html), '无三步学习法卡片');

sp([...present].every(k => ['map', 'lyrics', 'lines', 'vocab', 'grammar'].includes(k)), '章节范围正确');
const fails = statics.filter(s => s.startsWith('✗'));
console.log(`静态检查  ${target}  (${kb} KB)  板块: ${[...present].join(' / ')}`);
statics.forEach(s => console.log('  ' + s));
if (fails.length) {
  console.error('✗ 静态检查未通过');
  process.exit(1);
}

/* ---------- 动态检查 ---------- */
let chromium;
try {
  chromium = require('playwright-core').chromium;
} catch (e) {
  console.log('\n⚠ 未安装 playwright-core，已跳过浏览器检查。');
  console.log('  安装后再跑一次：npm i playwright-core');
  process.exit(0);
}

const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
];

async function launch() {
  for (const p of CANDIDATES) {
    if (fs.existsSync(p)) {
      try { return await chromium.launch({ executablePath: p, headless: true }); } catch (e) {}
    }
  }
  try { return await chromium.launch({ headless: true }); } catch (e) {}
  throw new Error('找不到可用的 Chrome。装一个 Chrome，或 npx playwright install chromium');
}

(async () => {
  const browser = await launch();
  const url = 'file://' + target;
  const results = [];
  const ok = (cond, msg) => results.push((cond ? '✓ ' : '✗ ') + msg);

  /* --- A. 桌面：结构与交互 --- */
  const p = await browser.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await p.goto(url, { waitUntil: 'load' });
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelectorAll('.reveal').forEach(e => e.classList.add('in')));

  const counts = await p.evaluate(() => {
    const q = s => document.querySelectorAll(s).length;
    return {
      sections: q('main > section'),
      nav: q('.nav-link'),
      stats: q('.hero-stats .stat'),
      statValues: Array.from(document.querySelectorAll('.hero-stats .stat b')).map(e => Number(e.textContent)),
      lines: q('#lyric-list .lyric'),
      lyrBlocks: q('#lyrics-body .lyr-block'),
      lyrLines: q('#lyrics-body .lyr-line'),
      words: q('#v-body tr'),
      gram: q('#grammar-list details'),
      nums: Array.from(document.querySelectorAll('.sec-num')).map(e => e.textContent)
    };
  });

  ok(errs.length === 0, '控制台无错误' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  ok(counts.sections === present.size, `板块数一致（HTML ${present.size} / 运行 ${counts.sections}）`);
  const wantsLyrics = await p.evaluate(() => window.SONG.modules?.lyrics !== false);
  ok(has('lyrics') === wantsLyrics, '默认包含全文，显式关闭时省略');
  ok(counts.nav === counts.sections, `导航项与板块数一致（${counts.nav} 项）`);
  ok(counts.lines > 0 && counts.words > 0 && counts.gram > 0,
     `结构完整 ${counts.lines} 卡 / ${counts.words} 词 / ${counts.gram} 语法`);
  ok(counts.statValues.length === counts.stats && counts.statValues.every(v => v > 0),
     `数据条 ${counts.stats} 项，数值均非 0（${counts.statValues.join(' / ')}）`);
  if (has('lyrics')) {
    const lyrics = await p.evaluate(() => {
      const blocks = window.SONG.lyrics.blocks;
      return {
        blocks: blocks.length,
        lines: blocks.reduce((n, b) => n + b.lines.length, 0),
        headings: Array.from(document.querySelectorAll('.lyr-head')).map(e => e.textContent),
        buttons: document.querySelectorAll('.lyr-line button[data-say]').length
      };
    });
    ok(counts.lyrBlocks === lyrics.blocks && counts.lyrLines === lyrics.lines,
       `完整歌词 ${counts.lyrBlocks} 段 / ${counts.lyrLines} 行`);
    ok(lyrics.headings.every((n, i) => n === '段落 ' + String(i + 1).padStart(2, '0')),
       '歌词段落自动编号');
    ok(lyrics.buttons === counts.lyrLines, '每行歌词都有原生朗读按钮');
    await p.evaluate(() => {
      window.__spokenText = '';
      window.speechSynthesis.speak = utterance => { window.__spokenText = utterance.text; };
    });
    const voice = p.locator('.lyr-line button[data-say]').first();
    await voice.focus();
    await voice.press('Enter');
    const spoken = await p.evaluate(() => window.__spokenText);
    ok(spoken === await voice.getAttribute('data-say'), '键盘可触发歌词朗读');
  }
  ok(counts.nums.every((n, i) => n === String(i + 1).padStart(2, '0')),
     `章节编号连续（${counts.nums.join(' ')}）`);

  // 全部精读卡可见，切换显示不改变内容数量
  const sourceLines = await p.evaluate(() => window.SONG.lines.length);
  ok(counts.lines === sourceLines, `完整显示 ${sourceLines} 张精读卡`);
  for (const [id, cls, label] of [['t-furi', 'hide-furi', '假名'], ['t-tr', 'hide-tr', '中文']]) {
    await p.uncheck('#' + id);
    ok(await p.evaluate(c => document.body.classList.contains(c), cls), `${label}可隐藏`);
    await p.check('#' + id);
    ok(!(await p.evaluate(c => document.body.classList.contains(c), cls)), `${label}可恢复`);
  }

  // 掌握进度
  await p.click('#v-body tr:nth-child(1) .v-check');
  await p.waitForTimeout(150);
  const prog = await p.textContent('#nav-progress-text');
  ok(/已掌握 1 \//.test(prog), `掌握度更新（${prog.trim()}）`);
  await p.click('#v-body tr:nth-child(1) .v-check');
  await p.waitForTimeout(100);

  // 例句完整显示，展开后可阅读；语法是最后一个正文章节
  const grammar = await p.evaluate(() => ({
    rows: Array.from(document.querySelectorAll('#grammar-list details')).map((el, i) => ({
      count: el.querySelectorAll('.g-examples li').length,
      expected: window.SONG.grammar[i].examples.length,
      translated: Array.from(el.querySelectorAll('.g-example-tr')).every(e => e.textContent.trim()),
      japanese: Array.from(el.querySelectorAll('.g-example-jp')).every(e => e.lang === 'ja' && e.textContent.trim())
    })),
    lastSection: document.querySelector('main > section:last-child').id
  }));
  ok(grammar.rows.length === counts.gram && grammar.rows.every(g => g.count === g.expected && g.count >= 2 && g.count <= 3 && g.translated && g.japanese),
     '每条语法包含 2–3 个日文例句和中文译文');
  ok(grammar.lastSection === 'grammar', '正文在语法图谱结束');
  await p.locator('#grammar-list details').first().locator('summary').click();
  ok(await p.locator('#grammar-list details').first().locator('.g-examples').isVisible(), '展开语法后例句可见');

  if (shots) {
    const dir = path.join(path.dirname(target), 'preview');
    fs.mkdirSync(dir, { recursive: true });
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.waitForTimeout(200);
    await p.screenshot({ path: path.join(dir, 'desktop-hero.png') });
    for (const id of [...present]) {
      const el = await p.$('#' + id);
      if (el) {
        await el.scrollIntoViewIfNeeded();
        await p.waitForTimeout(120);
        await el.screenshot({ path: path.join(dir, `${id}.png`) });
      }
    }
    await p.close();
    const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await m.goto(url); await m.waitForTimeout(300);
    await m.evaluate(() => document.querySelectorAll('.reveal').forEach(e => e.classList.add('in')));
    await m.waitForTimeout(200);
    await m.screenshot({ path: path.join(dir, 'mobile-hero.png') });
    if (has('lyrics')) {
      await m.$eval('#lyrics', e => e.scrollIntoView({ block: 'start', behavior: 'instant' }));
      await m.waitForTimeout(200);
      await m.screenshot({ path: path.join(dir, 'mobile-lyrics.png') });
    }
    await m.locator('#grammar-list details').first().locator('summary').click();
    await m.$eval('#grammar', e => e.scrollIntoView({ block: 'start', behavior: 'instant' }));
    await m.waitForTimeout(200);
    await m.screenshot({ path: path.join(dir, 'mobile-grammar.png') });
    await m.close();
    results.push('✓ 截图已输出到 ' + dir);
  } else {
    await p.close();
  }

  /* --- B. 多断点溢出 --- */
  for (const w of [390, 768, 1024, 1440]) {
    const q = await browser.newPage({ viewport: { width: w, height: 900 } });
    await q.goto(url);
    await q.waitForTimeout(250);
    await q.locator('#grammar-list details').evaluateAll(els => els.forEach(e => { e.open = true; }));
    const r = await q.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }));
    ok(r.sw <= r.vw + 1, `${w}px 无横向溢出（scrollW ${r.sw}）`);
    await q.close();
  }

  await browser.close();

  console.log('\n浏览器检查');
  results.forEach(r => console.log('  ' + r));
  const bad = results.filter(r => r.startsWith('✗'));
  if (bad.length) {
    console.error(`\n✗ ${bad.length} 项未通过`);
    process.exit(1);
  }
  console.log('\n✓ 全部通过');
})().catch(e => {
  console.error('✗ 检查失败: ' + e.message);
  process.exit(1);
});
