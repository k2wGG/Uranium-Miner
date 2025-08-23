#!/usr/bin/env node
/**
 * bin/start.cjs — модульная архитектура + refinery + headless через аргументы/ENV.
 * Без дублирования логики — всё делегируется в src/core/*
 */

const path = require('path');
const minimist = require('minimist');

const { loadConfigAndStats, saveAll } = require('../src/config/def.cjs');
const { log } = require('../src/utils/logger.cjs');
const { launch, closeBrowser, bindPageSafety } = require('../src/core/puppeteer.cjs');
const { gotoIfNeeded, waitForUIReady } = require('../src/core/navigation.cjs');
const { hardReload, scheduleReload, cancelReloadTimer, setReloadConfig } = require('../src/core/reload.cjs');
const { setClientFlags, runClicksOnce, waitForMineReady } = require('../src/core/actions.cjs');
const { createRefineryController } = require('../src/core/refinery.cjs');

/* ───────────── ENV/CLI ───────────── */
const HEADLESS_ENV = ['1','true','yes','on'].includes(String(process.env.HEADLESS || '').trim().toLowerCase());

const argv = minimist(process.argv.slice(2), {
  string: ['profile','proxy','chromePath','startUrl','acceptLanguage','timezone'],
  boolean: ['headless','showClientLogs','rotateProxyOnReload'],
  default: {
    profile: path.resolve(process.cwd(), 'run/default'),
    proxy: '',
    chromePath: '',
    headless: HEADLESS_ENV,
    showClientLogs: false,
    rotateProxyOnReload: false,
    reloadSec: 900,
    startUrl: 'https://www.geturanium.io/',
    acceptLanguage: 'en-US,en;q=0.9',
    timezone: 'Europe/Berlin'
  },
  alias: { p: 'profile', x: 'proxy', H: 'headless' }
});

/* ───────────── helpers ───────────── */
const DEFAULT_URL = 'https://www.geturanium.io/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function ensureUrl(u) {
  try {
    if (typeof u !== 'string') return DEFAULT_URL;
    let s = u.trim();
    if (!s) return DEFAULT_URL;
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
    new URL(s); // валидация
    return s;
  } catch {
    return DEFAULT_URL;
  }
}

async function gotoHomeSafe(page, url, label='главную') {
  const target = ensureUrl(url);
  try {
    await gotoIfNeeded(page, target, label);
  } catch (e) {
    log(`WRN gotoIfNeeded(${target}) → ${e.message}. Повтор с ${DEFAULT_URL}`,'warn');
    await gotoIfNeeded(page, DEFAULT_URL, label);
  }
}

/* ───────────── main ───────────── */
(async () => {
  const { config, stats } = await loadConfigAndStats(argv);

  // Жёстко нормализуем startUrl (фикс “Page.navigate: Invalid params”)
  config.startUrl = ensureUrl(config.startUrl || argv.startUrl || DEFAULT_URL);
  log(`Start URL: ${config.startUrl}`, 'info');

  // Пробрасываем флаги в модули
  setClientFlags({ showClientLogs: config.showClientLogs });
  setReloadConfig({ rotateProxyOnReload: config.rotateProxyOnReload, reloadSec: config.reloadSec });

  // Грейсфул-выход
  async function gracefulExit(code=0) {
    try { await saveAll(config, stats); } catch(e){ log(`saveAll: ${e.message}`,'warn'); }
    cancelReloadTimer();
    await closeBrowser();
    process.exit(code);
  }
  process.on('SIGINT',  () => gracefulExit(0));
  process.on('SIGTERM', () => gracefulExit(0));

  try {
    const { page } = await launch(config);
    bindPageSafety(page, config);

    // Первичная навигация и «прогрев» UI/Mine
    await gotoHomeSafe(page, config.startUrl, 'главную');
    try {
      await waitForUIReady(page);
    } catch (e) {
      // fallback: мягкий ре-энтри
      log(`WRN waitForUIReady: ${e.message}. Перезаход на главную…`,'warn');
      await gotoHomeSafe(page, config.startUrl, 'главную');
      await waitForUIReady(page);
    }
    try {
      await waitForMineReady(page);
    } catch (e) {
      log(`WRN waitForMineReady: ${e.message}. Ещё раз обновим главную…`,'warn');
      await gotoHomeSafe(page, config.startUrl, 'главную');
      await waitForUIReady(page);
      await waitForMineReady(page);
    }

    // Плановая авто-перезагрузка (после — всегда возвращаемся на Mine)
    scheduleReload(async () => {
      await hardReload({ page, config });
      await gotoHomeSafe(page, config.startUrl, 'главную');
      await waitForUIReady(page);
      await waitForMineReady(page);
    });

    // Контроллер 8-часового /refinery (вся логика внутри модуля)
    const refinery = createRefineryController({
      page,
      cfg: {
        autoRefine: config.autoRefine !== false,
        refineHours: Number(config.refineHours) || 8,
        refineMinMinutes: Number(config.refineMinMinutes) || 30
      },
      log,
      state: { stats, lastClick: stats.lastClick },
      onNextAt(ts) {
        log(`🗓 Следующий визит на /refinery ≈ ${new Date(ts).toLocaleTimeString()}`, 'info');
      }
    });

    let lastPersistAt = 0;

    // Основной цикл
    while (true) {
      // 1) /refinery по расписанию
      try {
        const didRefinery = await refinery.tick();
        const cur = String(page.url() || '');
        if (didRefinery || cur.includes('/refinery') || !cur.startsWith('https://www.geturanium.io/')) {
          await gotoHomeSafe(page, config.startUrl, 'главную');
          await waitForUIReady(page);
          await waitForMineReady(page);
        }
      } catch (e) {
        log(`ERR ❌ [Refinery] tick(): ${e.message}`, 'error');
        try {
          await gotoHomeSafe(page, config.startUrl, 'главную');
          await waitForUIReady(page);
          await waitForMineReady(page);
        } catch {}
      }

      // 2) бусты (Mine)
      try {
        await gotoHomeSafe(page, config.startUrl);
        await waitForUIReady(page);
        await waitForMineReady(page);

        const { updatedLastClick, incClicks } =
          await runClicksOnce(page, config, stats.lastClick);

        stats.lastClick = { ...updatedLastClick };
        for (const k of Object.keys(incClicks)) {
          stats.clickCount[k] = (stats.clickCount[k] || 0) + incClicks[k];
        }
      } catch (e) {
        log(`WRN runClicksOnce: ${e.message}`, 'warn');
      }

      // 3) периодическое сохранение
      if (Date.now() - lastPersistAt > 5*60*1000) {
        try { await saveAll(config, stats); lastPersistAt = Date.now(); }
        catch(e){ log(`WRN saveAll tick: ${e.message}`,'warn'); }
      }

      await sleep(5000);
    }
  } catch (e) {
    log(`FATAL: ${e.message}`,'error');
    cancelReloadTimer();
    await closeBrowser();
    process.exit(1);
  }
})();
