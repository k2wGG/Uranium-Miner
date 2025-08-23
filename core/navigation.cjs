// src/core/navigation.cjs
/**
 * Навигация и ожидание UI без page.waitForTimeout.
 * • gotoIfNeeded: ретраи при net::ERR_ABORTED/Execution context destroyed
 * • waitForUIReady: опрос DOM (Next.js/текст/разметка), без жёстких селекторов
 */

const URL_HOME = 'https://www.geturanium.io/';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rnd   = (min, max) => (min + Math.random() * (max - min)) | 0;

// Внутренний "замок", чтобы не было параллельных goto на одной странице
const NAV_LOCK = new WeakMap();

async function withNavLock(page, fn) {
  const prev = NAV_LOCK.get(page);
  if (prev) {
    // ждём завершения предыдущей навигации
    try { await prev.catch(()=>{}); } catch {}
  }
  const p = (async () => {
    try { return await fn(); }
    finally { NAV_LOCK.delete(page); }
  })();
  NAV_LOCK.set(page, p);
  return p;
}

/** Безопасная навигация с ретраями */
async function safeGoto(page, url, label = '', attempts = 3) {
  return withNavLock(page, async () => {
    for (let i = 1; i <= attempts; i++) {
      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 });
        return true;
      } catch (e) {
        const msg = String(e && e.message || '');
        const soft =
          /ERR_ABORTED|Navigation failed because|Execution context was destroyed/i.test(msg);
        if (!soft && i === attempts) throw e;

        // лёгкий backoff и ещё раз
        await sleep(500 + i * 400 + rnd(0, 300));
      }
    }
    return false;
  });
}

/** Переход, только если мы не там */
async function gotoIfNeeded(page, url, label = '') {
  try {
    const cur = await page.evaluate(() => location.href).catch(() => '');
    const normalize = (s) => String(s || '').replace(/\/+$/, '');
    if (normalize(cur) === normalize(url)) return true;
  } catch {}
  return await safeGoto(page, url, label, 3);
}

/** Мягкое «подталкивание» рендера */
async function nudge(page) {
  try {
    await page.evaluate(() => {
      try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch {}
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
      document.dispatchEvent(new Event('focus', { bubbles: true }));
      if (window.requestAnimationFrame) for (let i=0;i<6;i++) requestAnimationFrame(()=>{});
      const b = document.body;
      if (b) {
        const r = b.getBoundingClientRect();
        const x = r.left + Math.random()*r.width;
        const y = r.top  + Math.random()*r.height;
        b.dispatchEvent(new MouseEvent('mousemove', { bubbles:true, clientX:x, clientY:y }));
      }
    });
  } catch {}
}

/**
 * Ожидание готовности UI:
 *  • body/__next присутствуют
 *  • есть признаки рендера (крупный текст, кнопки, длина bodyText)
 *  • если не готово — «подталкиваем» и пробуем ещё
 */
async function waitForUIReady(page, opts = {}) {
  const {
    totalTimeoutMs = 25_000,
    pollMs = 350,
    requireTextMinLen = 200
  } = opts;

  const t0 = Date.now();

  while (Date.now() - t0 < totalTimeoutMs) {
    const ok = await page.evaluate((minLen) => {
      const hasBody = !!document.body;
      if (!hasBody) return false;

      const hasNext = !!document.querySelector('#__next, [data-nextjs-router]');

      const txt = (document.body.innerText || document.body.textContent || '').trim();
      const longEnough = txt.length >= minLen;

      // ключевые слова, встречающиеся на домашней
      const hasKeywords = /\bboosters\b/i.test(txt)
        || /temporary power-ups/i.test(txt)
        || /uranium/i.test(txt)
        || /collector|multiplier|conveyor/i.test(txt);

      // есть минимум интерактивных элементов
      const hasButtons = document.querySelectorAll('button').length >= 3;

      return (hasBody && (hasNext || longEnough || hasKeywords || hasButtons));
    }, requireTextMinLen).catch(() => false);

    if (ok) return true;

    await nudge(page);
    await sleep(pollMs);
  }

  // не критично — пусть дальше модули сами дорендерят/ждут
  return false;
}

module.exports = {
  URL_HOME,
  sleep,
  rnd,
  gotoIfNeeded,
  waitForUIReady,
  safeGoto,
};
