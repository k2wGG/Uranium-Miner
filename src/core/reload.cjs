// src/core/reload.cjs
/**
 * Логика жёсткой/плановой перезагрузки страницы.
 * Делает скриншоты «до» и «после», чтобы было проще отлаживать.
 */

const fs = require('fs').promises;
const { log } = require('../utils/logger.cjs');

let _reloadTimer = null;
let _cfg = { rotateProxyOnReload:false, reloadSec:900 };

function setReloadConfig({ rotateProxyOnReload, reloadSec }) {
  _cfg.rotateProxyOnReload = !!rotateProxyOnReload;
  _cfg.reloadSec = Number(reloadSec||900);
}

function scheduleReload(fn) {
  cancelReloadTimer();
  if (_cfg.reloadSec > 0) {
    _reloadTimer = setTimeout(async () => {
      try { await fn(); } catch(e){ log(`scheduleReload: ${e.message}`,'error'); }
      scheduleReload(fn);
    }, _cfg.reloadSec * 1000);
  }
}

function cancelReloadTimer() {
  if (_reloadTimer) clearTimeout(_reloadTimer);
  _reloadTimer = null;
}

async function hardReload({ page, config }) {
  log('🚨 Жёсткая перезагрузка…','warn');
  try {
    await fs.mkdir('./screenshots', { recursive: true });
    await page.screenshot({ path: `./screenshots/reload_before_${Date.now()}.png` }).catch(()=>{});
  } catch {}

  try {
    await page.goto('about:blank');
    await page.goto(`${config.startUrl}${config.startUrl.includes('?') ? '&' : '?'}_=${Date.now()}`, {
      waitUntil: 'networkidle2', timeout: 60000
    });
    if (page.url().includes('/auth')) {
      log('🔑 Попали на /auth, ждём вход…','info');
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 180000 }).catch(()=>{});
    } else {
      log('✅ Сессия активна после перезагрузки.','info');
    }
  } catch (e) {
    log(`hardReload goto: ${e.message}`,'error');
    // fallback: ещё раз пробуем на главную
    try {
      await page.goto(config.startUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    } catch {}
  }

  try {
    await page.screenshot({ path: `./screenshots/reload_after_${Date.now()}.png` }).catch(()=>{});
  } catch {}
}

module.exports = { hardReload, scheduleReload, cancelReloadTimer, setReloadConfig };
