// src/core/reload.cjs
/**
 * Плановая/жёсткая перезагрузка без page.waitForTimeout.
 * • scheduleReload/cancelReloadTimer
 * • hardReload: about:blank → home с cache-buster, терпим ERR_ABORTED
 * • setReloadConfig: rotateProxyOnReload + период
 */

const { URL_HOME, sleep, safeGoto, waitForUIReady } = require('./navigation.cjs');
const fs = require('fs').promises;
const path = require('path');

let RELOAD_CFG = {
  rotateProxyOnReload: false,
  reloadSec: 900
};
let reloadTimer = null;

function setReloadConfig(cfg = {}) {
  RELOAD_CFG = { ...RELOAD_CFG, ...cfg };
}

function cancelReloadTimer() {
  if (reloadTimer) {
    clearTimeout(reloadTimer);
    reloadTimer = null;
  }
}

/**
 * Плановая автоперезагрузка: зовёт cb() по расписанию.
 * cb() — асинхронная функция, где вы делаете hardReload + ожидания UI.
 */
function scheduleReload(cb) {
  cancelReloadTimer();
  if (!RELOAD_CFG.reloadSec || RELOAD_CFG.reloadSec <= 0) return;

  const nextMs = RELOAD_CFG.reloadSec * 1000;
  reloadTimer = setTimeout(async () => {
    try {
      await cb();
    } catch (e) {
      // проглатываем, логируйте на стороне вызывающего
    } finally {
      // перепланируем в любом случае
      scheduleReload(cb);
    }
  }, nextMs);
}

/**
 * Жёсткая перезагрузка вкладки.
 * Опционально можно делать rotateProxyOnReload на уровне вашего лаунчера/браузера,
 * здесь — только навигация и сохранности.
 */
async function hardReload({ page, config, log = console.log }) {
  try {
    log('WRN', '🚨 Жёсткая перезагрузка…');
  } catch {}

  // Скрин перед перезагрузкой
  try {
    await fs.mkdir(path.resolve(process.cwd(), 'screenshots'), { recursive: true });
    await page.screenshot({ path: path.resolve(process.cwd(), `screenshots/reload_before_${Date.now()}.png`) })
      .catch(()=>{});
  } catch {}

  // about:blank → home с cache buster
  try { await page.goto('about:blank').catch(()=>{}); } catch {}
  await sleep(150);

  const busterUrl = `${URL_HOME}?_=${Date.now()}`;
  try {
    await safeGoto(page, busterUrl, 'reload');
  } catch (e) {
    // терпимо: иногда бросает ERR_ABORTED, но страница уже на месте
    if (!/ERR_ABORTED/i.test(String(e.message||''))) {
      try { log('ERR', `hardReload goto: ${e.message}`); } catch {}
    }
  }

  // Если редиректнуло на /auth — дадим время на восстановление сессии
  try {
    const isAuth = await page.evaluate(() => /\/auth\b/.test(location.pathname)).catch(()=>false);
    if (isAuth) {
      // ждём до 3 минут «самологина»
      const t0 = Date.now();
      while (Date.now() - t0 < 180_000) {
        const done = await page.evaluate(() => !/\/auth\b/.test(location.pathname)).catch(()=>false);
        if (done) break;
        await sleep(1000);
      }
    } else {
      // чуть подождать прогрев
      await waitForUIReady(page, { totalTimeoutMs: 12_000, pollMs: 300 });
    }
  } catch {}

  // Скрин после перезагрузки
  try {
    await page.screenshot({ path: path.resolve(process.cwd(), `screenshots/reload_after_${Date.now()}.png`) })
      .catch(()=>{});
  } catch {}
}

module.exports = {
  setReloadConfig,
  scheduleReload,
  cancelReloadTimer,
  hardReload,
};
