#!/usr/bin/env node
/** 汇总页静态与浏览器冒烟检查。 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const html = fs.readFileSync(INDEX, 'utf8');
const songFiles = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => path.join(ROOT, entry.name, `${entry.name}.song.json`))
  .filter(file => fs.existsSync(file));
const songs = songFiles.map(file => JSON.parse(fs.readFileSync(file, 'utf8')));
const songCount = songs.length;
const mizukiCount = songs.filter(song => {
  const artists = song.meta.catalog?.artists;
  return (artists?.length ? artists : [song.meta.artist]).includes('米津玄師');
}).length;
const errors = [];

if (!html.includes(`共 ${songCount} 首`)) errors.push(`首页 SEO 描述未同步为 ${songCount} 首`);
if (!html.includes('曲目清单由 scripts/build-site.js')) errors.push('首页模板提示未更新');
if (!/var SONGS = \[/.test(html)) errors.push('首页缺少生成的 SONGS 数组');
if (/\{\{[A-Z0-9_]+\}\}|__SITE_SONGS__/.test(html)) errors.push('首页仍有未替换占位符');
if (!fs.existsSync(path.join(ROOT, 'SONGS.md'))) errors.push('缺少 SONGS.md');

if (errors.length) {
  console.error('✗ 首页静态检查未通过：');
  errors.forEach(error => console.error('  · ' + error));
  process.exit(1);
}
console.log(`✓ 首页静态检查通过（${songCount} 首）`);

const browserCheck = process.argv.includes('--browser');
if (!browserCheck) {
  console.log('  首页浏览器检查未请求；运行 npm run check:browser 可执行交互与四档断点检查');
  process.exit(0);
}

let chromium;
try {
  chromium = require(path.join(ROOT, '.agents', 'skills', 'jp-song-study-page', 'node_modules', 'playwright-core')).chromium;
} catch (_) {
  try {
    chromium = require('playwright-core').chromium;
  } catch (_) {
    console.error('✗ 缺少 playwright-core，无法执行首页浏览器检查');
    process.exit(1);
  }
}

const candidates = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
];

async function launch() {
  for (const executablePath of candidates) {
    if (!fs.existsSync(executablePath)) continue;
    try {
      return await chromium.launch({ executablePath, headless: true });
    } catch (_) {}
  }
  return chromium.launch({ headless: true });
}

(async () => {
  const browser = await launch();
  const url = 'file://' + INDEX;
  const results = [];
  const check = (condition, message) => results.push({ ok: Boolean(condition), message });
  const consoleErrors = [];

  for (const width of [390, 768, 1024, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 950 } });
    page.on('pageerror', error => consoleErrors.push(`pageerror: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(150);
    const state = await page.evaluate(() => ({
      cards: document.querySelectorAll('#songs .song').length,
      listCount: document.querySelector('#list-count')?.textContent || '',
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    }));
    check(!state.overflow, `${width}px 无横向溢出`);
    check(state.cards === 10, `${width}px 首屏 10 张卡片（实际 ${state.cards}）`);
    check(state.listCount.startsWith(`${songCount} 首`), `${width}px 总数正确（${state.listCount}）`);

    if (width === 1440) {
      await page.fill('#song-search', 'Lemon');
      await page.waitForTimeout(50);
      check(await page.locator('#songs .song').count() === 1, '搜索 Lemon 只显示 1 首');
      check((await page.textContent('#songs .song-title'))?.includes('Lemon'), '搜索结果内容正确');

      await page.fill('#song-search', '');
      await page.waitForTimeout(50);
      await page.click('#artist-trigger');
      const option = page.locator('#artist-options .artist-option', { hasText: '米津玄師' }).first();
      check(await option.count() === 1, '歌手筛选中存在米津玄師');
      if (await option.count()) {
        await option.click();
        await page.waitForTimeout(50);
        check(await page.locator('#songs .song').count() === Math.min(10, mizukiCount), `米津玄師筛选为 ${mizukiCount} 首`);
      }
      await page.click('#artist-trigger');
      const allArtists = page.locator('#artist-options .artist-option[data-artist=""]');
      check(await allArtists.count() === 1, '歌手菜单包含「全部歌手」');
      if (await allArtists.count()) await allArtists.click();
      check(await page.locator('#songs .song').count() === 10, '清除歌手筛选后恢复分页首屏');
    }
    await page.close();
  }

  check(consoleErrors.length === 0, `控制台无错误${consoleErrors.length ? '：' + consoleErrors.slice(0, 3).join(' | ') : ''}`);
  await browser.close();

  let failed = 0;
  for (const result of results) {
    console.log(`  ${result.ok ? '✓' : '✗'} ${result.message}`);
    if (!result.ok) failed++;
  }
  if (failed) {
    console.error(`✗ 首页浏览器检查失败：${failed} 项`);
    process.exit(1);
  }
  console.log('✓ 首页浏览器检查通过');
})().catch(error => {
  console.error('✗ 首页浏览器检查异常：' + error.message);
  process.exit(1);
});
