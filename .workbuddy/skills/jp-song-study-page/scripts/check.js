#!/usr/bin/env node
/**
 * check.js — 生成页验收（无头 Chrome）
 *
 *   node check.js <index.html> [--shots]
 *
 * 检查项：控制台错误 / 板块是否按配置裁剪 / 结构完整性 / 筛选 / 掌握进度 /
 *         答题（有 quiz 时）/ 标注（有 studio 时）/ 计划勾选（有 plan 时）/ 多断点横向溢出
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
sp(html.includes('id="v-body"'), '含 id="v-body"');
sp(html.includes('id="grammar-list"'), '含 id="grammar-list"');
sp(html.includes('window.SONG'), '含 window.SONG');
sp(!/__SONG_JSON__|__CSS__|__RENDER_JS__/.test(html), '无未替换的构建占位符');
sp(!/\{\{[\w.]+\}\}/.test(html), '无未替换的 {{}} 占位符');

if (has('quiz')) sp(html.includes('id="quiz-list"'), '含 id="quiz-list"');
if (has('studio')) sp(html.includes('id="studio-out"'), '含 id="studio-out"');
if (has('plan')) sp(html.includes('id="plan-grid"'), '含 id="plan-grid"');
if (has('listen')) sp(html.includes('id="listen-grid"'), '含 id="listen-grid"');

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
      words: q('#v-body tr'),
      gram: q('#grammar-list details'),
      quiz: q('#quiz-list .q'),
      plan: q('#plan-grid .day'),
      nums: Array.from(document.querySelectorAll('.sec-num')).map(e => e.textContent)
    };
  });

  ok(errs.length === 0, '控制台无错误' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  ok(counts.sections === present.size, `板块数一致（HTML ${present.size} / 运行 ${counts.sections}）`);
  ok(counts.nav === counts.sections, `导航项与板块数一致（${counts.nav} 项）`);
  ok(counts.lines > 0 && counts.words > 0 && counts.gram > 0,
     `结构完整 ${counts.lines} 卡 / ${counts.words} 词 / ${counts.gram} 语法`
     + (has('quiz') ? ` / ${counts.quiz} 题` : '') + (has('plan') ? ` / ${counts.plan} 天` : ''));
  ok(counts.statValues.length === counts.stats && counts.statValues.every(v => v > 0),
     `数据条 ${counts.stats} 项，数值均非 0（${counts.statValues.join(' / ')}）`);
  ok(counts.nums.every((n, i) => n === String(i + 1).padStart(2, '0')),
     `章节编号连续（${counts.nums.join(' ')}）`);

  // 段落筛选
  const filters = await p.$$eval('#sec-filters .filter', els => els.map(e => e.dataset.sec));
  ok(filters.length >= 2, `段落筛选 ${filters.length} 个（${filters.join('/')}）`);
  if (filters.length > 1) {
    await p.click(`#sec-filters .filter[data-sec="${filters[1]}"]`);
    await p.waitForTimeout(150);
    const n = await p.$$eval('#lyric-list .lyric', e => e.length);
    ok(n > 0 && n < counts.lines, `筛选「${filters[1]}」→ ${n} 张卡`);
    await p.click('#sec-filters .filter[data-sec="all"]');
    await p.waitForTimeout(100);
  }

  // 掌握进度
  await p.click('#v-body tr:nth-child(1) .v-check');
  await p.waitForTimeout(150);
  const prog = await p.textContent('#nav-progress-text');
  ok(/已掌握 1 \//.test(prog), `掌握度更新（${prog.trim()}）`);
  await p.click('#v-body tr:nth-child(1) .v-check');
  await p.waitForTimeout(100);

  // 条件项
  if (has('quiz')) {
    await p.click('#quiz-list .q:nth-child(1) .opt:nth-child(1)');
    await p.waitForTimeout(150);
    const a = await p.evaluate(() => {
      const c = document.querySelector('#quiz-list .q');
      return { correct: !!c.querySelector('.opt.correct'), why: getComputedStyle(c.querySelector('.q-why')).display };
    });
    ok(a.correct, '答题后正确项高亮');
    ok(a.why !== 'none', '答题后显示解析');
  }

  if (has('studio')) {
    await p.fill('#paste', '夢を つかめ 光の ように');
    await p.waitForTimeout(450);
    const hit = Number(await p.textContent('#studio-count'));
    ok(hit > 0, `歌词标注命中 ${hit} 处`);
    await p.fill('#paste', '');
    await p.waitForTimeout(300);
  }

  if (has('plan')) {
    await p.click('#plan-grid .day-check input');
    await p.waitForTimeout(150);
    const done = await p.$eval('#plan-grid .day', e => e.className.includes('done'));
    ok(done, '计划勾选生效');
    await p.click('#plan-grid .day-check input');
  }

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
