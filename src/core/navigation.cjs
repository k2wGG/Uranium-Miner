// src/core/navigation.cjs
/**
 * Навигация и устойчивое ожидание UI.
 * Обновлённая версия: больше не опираемся только на <button>,
 * распознаём любые кликабельные элементы (div/a/[role=button]) с нужным текстом
 * и нижнее меню (Mine/Tasks/Earn/Upgrades/Profile).
 */

const { log } = require('../utils/logger.cjs');

async function gotoIfNeeded(page, url, label='целевую') {
  const cur = page.url();
  if (!cur.startsWith('https://geturanium.io') && !cur.startsWith('https://www.geturanium.io')) {
    log(`Навигация на ${label} страницу…`, 'debug');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  }
}

/**
 * Ждём, пока на странице появится ЛЮБОЙ из характерных элементов UI.
 * Используем XPath с translate() по тексту и проверяем видимость (bbox + display/visibility).
 */
async function waitForUIReady(page, timeoutMs = 30000) {
  // Ищем как «бусты», так и нижнее меню, чтобы не зависеть от конкретного экрана
  const texts = [
    'auto collector',
    'shard multiplier',
    'conveyor booster',
    'boosters',
    'refinery',
    // нижняя навигация приложения
    'mine',
    'tasks',
    'earn',
    'upgrades',
    'profile'
  ];

  // Для каждого текста строим несколько XPath, чтобы покрыть div/a/[role=button] и т.п.
  const xpaths = [];
  for (const t of texts) {
    const T = t.toUpperCase();
    // любой элемент, содержащий текст (кроме script/style)
    xpaths.push(`//*[not(self::script or self::style)] [contains(translate(normalize-space(.), 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'), '${T}')]`);
    // явные кнопки/ссылки
    xpaths.push(`//button[contains(translate(normalize-space(.), 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'), '${T}')]`);
    xpaths.push(`//a[contains(translate(normalize-space(.), 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'), '${T}')]`);
    // элементы с role=button
    xpaths.push(`//*[@role='button' and contains(translate(normalize-space(.), 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'), '${T}')]`);
  }

  // Функция проверки «видимого» совпадения
  const isAnyVisible = await page.waitForFunction(
    (xps) => {
      function visibleByXPath(xpath) {
        const snap = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        for (let i = 0; i < snap.snapshotLength; i++) {
          const el = snap.snapshotItem(i);
          if (!el) continue;
          const rect = el.getBoundingClientRect?.() || { width: 0, height: 0 };
          const style = window.getComputedStyle ? getComputedStyle(el) : null;
          const okSize = rect.width > 1 && rect.height > 1;
          const okDisplay = !style || (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0');
          if (okSize && okDisplay) return true;
        }
        return false;
      }
      for (const xp of xps) {
        if (visibleByXPath(xp)) return true;
      }
      return false;
    },
    { timeout: timeoutMs },
    xpaths
  ).catch(() => false);

  if (!isAnyVisible) {
    log('UI не распознан за отведённое время, дадим странице ещё немного…', 'warn');
    await page.waitForTimeout(3000);
  }
}

module.exports = { gotoIfNeeded, waitForUIReady };
