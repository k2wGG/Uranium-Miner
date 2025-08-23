// src/core/refinery.cjs
/**
 * Контроллер 8-часового Refinery с корректной обработкой КД/активации.
 * Не завязан на XPath. В headless ищет по тексту/структуре, умеет парсить "remaining".
 *
 * Экспорт:
 *   createRefineryController({ page, cfg, log, state })
 *   URL_HOME, URL_REFINERY, gotoIfNeeded
 */

const URL_HOME = 'https://www.geturanium.io/';
const URL_REFINERY = 'https://www.geturanium.io/refinery';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const now = () => Date.now();

function defaultLog(msg, level = 'info') {
  const colors = { info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m', ok: '\x1b[32m', debug: '\x1b[90m' };
  const c = colors[level] || '\x1b[37m';
  const t = new Date().toLocaleTimeString('ru-RU');
  console.log(`${c}[${t}] ${msg}\x1b[0m`);
}

async function gotoIfNeeded(page, url, label, log = defaultLog) {
  const cur = String(page.url() || '').replace(/\/+$/, '');
  const dest = String(url).replace(/\/+$/, '');
  if (cur === dest) return false;
  log(`↪️ Переходим на ${label || url} …`, 'info');
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(800);
  return true;
}

/** Большая универсальная кнопка на /refinery (используем когда можно жать) */
async function findRefineElementHandle(page) {
  const variants = [
    'initiate uranium refining',
    'start refining',
    'begin refining',
    'refine now',
    'start conversion',
    'initiate refining'
  ].map(s => s.toLowerCase());

  // до 8 попыток с прокруткой
  for (let step = 0; step < 8; step++) {
    const h = await page.evaluateHandle((needles) => {
      const N = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

      // 1) обычные кнопки
      const btns = Array.from(document.querySelectorAll('button'));
      for (const b of btns) {
        const t1 = N(b.innerText);
        const t2 = N(b.textContent);
        if (needles.some(n => t1.includes(n) || t2.includes(n))) return b;
      }

      // 2) кликабельные контейнеры
      const clickable = Array.from(document.querySelectorAll('a,div,[role="button"]'));
      for (const el of clickable) {
        const t1 = N(el.innerText);
        const t2 = N(el.textContent);
        if (needles.some(n => t1.includes(n) || t2.includes(n))) {
          const btn = el.closest('button') || el.querySelector?.('button') || el;
          return btn;
        }
      }

      // 3) «большая градиентная кнопка»
      const candidates = Array.from(document.querySelectorAll('button, [role="button"]'))
        .filter(el => /gradient|from-cyan|to-purple|rounded-lg|font-mono/i.test(el.className || ''));
      for (const el of candidates) {
        const t = N(el.textContent);
        if (needles.some(n => t.includes(n))) return el;
      }

      return null;
    }, variants);

    const el = h.asElement ? h.asElement() : null;
    if (el) return el;

    // листаем дальше
    try { await page.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 0.8))); } catch {}
    await sleep(300);
  }
  return null;
}

/** Щадящий «физический» клик */
async function physicalClick(page, elHandle) {
  try {
    await elHandle.evaluate(el => { try { el.scrollIntoView({ block: 'center' }); } catch {} });
    const box = await elHandle.boundingBox();
    if (!box || !box.width || !box.height) return false;
    const x = box.x + Math.random() * box.width;
    const y = box.y + Math.random() * box.height;
    await page.mouse.move(x, y, { steps: 15 });
    await page.mouse.down(); await sleep(40 + Math.random()*120); await page.mouse.up();
    return true;
  } catch { return false; }
}

/**
 * Сканирует страницу /refinery и возвращает состояние.
 *  - state: 'ready' | 'cooldown' | 'unknown'
 *  - cooldownMs: оценка оставшегося времени (если удалось распарсить)
 *  - hasBtn / btnDisabled: для диагностики
 */
async function scanRefineryState(page) {
  return await page.evaluate(() => {
    const N = s => String(s||'').toLowerCase().replace(/\s+/g, ' ').trim();
    const bodyText = N(document.body?.innerText || document.body?.textContent || '');

    // признаки активного процесса/кулдауна
    const isActive = /refining process|converting shards|conversion progress|uranium reactor.*active/i.test(bodyText);
    const mentionsCd = /(remaining|cooldown|time left|available in|next in)/i.test(bodyText);

    // находим большую кнопку (даже если текст отличается)
    let btn = null;
    const btns = Array.from(document.querySelectorAll('button'));
    for (const b of btns) {
      const t = N(b.textContent || b.innerText);
      if (/initiate.*refining|start.*refining|begin.*refining|refine now|initiate refining/i.test(t)) { btn = b; break; }
    }
    if (!btn) {
      const bigs = btns.filter(b => {
        const r = b.getBoundingClientRect();
        return r && r.width > 250 && r.height > 48 && /gradient|from-cyan|to-purple|rounded-lg|font-mono/i.test(b.className || '');
      });
      if (bigs.length) btn = bigs[0];
    }

    // оценка оставшегося времени (очень терпимая к формату)
    const parseCd = (txt) => {
      const s = N(txt || '');
      let d=0,h=0,m=0,sec=0;
      let m1 = s.match(/(\d+)\s*d/); if (m1) d = +m1[1];
      m1 = s.match(/(\d+)\s*h/); if (m1) h = +m1[1];
      m1 = s.match(/(\d+)\s*m/); if (m1) m = +m1[1];
      m1 = s.match(/(\d+)\s*s/); if (m1) sec = +m1[1];
      const total = ((d*24 + h)*60 + m)*60*1000 + sec*1000;
      return total;
    };

    let cooldownMs = 0;
    if (mentionsCd) cooldownMs = Math.max(cooldownMs, parseCd(bodyText));
    if (btn) {
      const t = N(btn.textContent || btn.innerText);
      cooldownMs = Math.max(cooldownMs, parseCd(t));
    }

    const canClick = !!btn && !btn.disabled &&
      /initiate|start|begin|refine now|initiate refining/i.test(N(btn?.textContent || btn?.innerText || ''));

    let state = 'unknown';
    if (canClick) state = 'ready';
    else if (isActive || (btn && btn.disabled) || cooldownMs > 0) state = 'cooldown';

    return {
      hasBtn: !!btn,
      btnDisabled: !!(btn && btn.disabled),
      state,
      cooldownMs: cooldownMs || 0
    };
  });
}

function computeNextVisit(lastTs, hours = 8, minMinutes = 30) {
  const win = Math.max(1, hours) * 60 * 60 * 1000;
  const min = Math.max(1, minMinutes) * 60 * 1000;
  const ts = now();
  let next = lastTs ? lastTs + win - 90 * 1000 : ts;
  const floor = ts + min;
  if (lastTs && next < floor) next = floor;
  return next;
}

async function confirmRefine(page) {
  // Считаем успехом: кнопка исчезла/задизейблилась или в тексте есть признаки процесса
  return await page.evaluate(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const N = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

    function active() {
      const txt = N(document.body.innerText || '');
      return /refining process|converting shards|conversion progress|uranium reactor.*active|time remaining|completion time/i.test(txt);
    }
    function clickableRefineExists() {
      const needles = [
        'initiate uranium refining','start refining','begin refining','refine now','start conversion','initiate refining'
      ];
      const pool = Array.from(document.querySelectorAll('button, [role="button"], a, div'));
      for (const el of pool) {
        const t = N(el.innerText || el.textContent);
        if (needles.some(n => t.includes(n))) {
          if (el.disabled) return false;
          if (/cooldown|processing|activating|active|remaining/i.test(t)) return false;
          return true; // всё ещё кликабельна
        }
      }
      return false;
    }

    for (let i=0;i<12;i++){
      if (!clickableRefineExists() || active()) return true;
      await wait(1000);
    }
    return false;
  });
}

function createRefineryController({ page, cfg = {}, log = defaultLog, state = {} }) {
  if (!state.stats) state.stats = {};
  if (!state.stats.clickCount) state.stats.clickCount = {};
  if (!state.stats.lastClick) state.stats.lastClick = {};
  if (!state.lastClick) state.lastClick = state.stats.lastClick;

  const autoRefine = cfg.autoRefine !== false;
  const refineHours = Number(cfg.refineHours) || 8;
  const refineMinMinutes = Number(cfg.refineMinMinutes) || 30;

  let nextAt = computeNextVisit(state.lastClick.autoRefine || 0, refineHours, refineMinMinutes);
  log(`📅 Следующий визит на /refinery ≈ ${new Date(nextAt).toLocaleTimeString()}`, 'info');

  async function doPass() {
    await gotoIfNeeded(page, URL_REFINERY, '/refinery', log);

    try { await page.waitForSelector('body', { timeout: 8000 }); } catch {}

    // Сначала считываем состояние (готово / кулдаун)
    const s = await scanRefineryState(page);

    if (s.state === 'ready') {
      // Ищем кликабельную кнопку и жмём
      const el = await findRefineElementHandle(page);
      if (!el) {
        log('WRN ⚠️ [Refinery] Кнопка видна как «ready», но хендл не получили — повторим позже.', 'warn');
        nextAt = now() + refineMinMinutes * 60 * 1000;
        return false;
      }
      let clicked = await physicalClick(page, el);
      if (!clicked) { try { await el.click({ delay: 20 }); clicked = true; } catch {} }
      if (!clicked) {
        log('WRN ⚠️ [Refinery] Не удалось кликнуть по кнопке.', 'warn');
        nextAt = now() + refineMinMinutes * 60 * 1000;
        return false;
      }

      const ok = await confirmRefine(page);
      if (ok) {
        log('⚡ [Refinery] Клик подтверждён.', 'info');
        state.lastClick.autoRefine = now();
        state.stats.clickCount.autoRefine = (state.stats.clickCount.autoRefine || 0) + 1;
        nextAt = computeNextVisit(state.lastClick.autoRefine, refineHours, refineMinMinutes);
        log(`📅 Следующий визит на /refinery ≈ ${new Date(nextAt).toLocaleTimeString()}`, 'info');
        return true;
      } else {
        log('WRN ⚠️ [Refinery] Клик не подтвердился — попробуем позже.', 'warn');
        nextAt = now() + refineMinMinutes * 60 * 1000;
        log(`📅 Следующий визит на /refinery ≈ ${new Date(nextAt).toLocaleTimeString()}`, 'info');
        return false;
      }
    }

    if (s.state === 'cooldown') {
      // мы на странице, кнопка не кликабельна или процесс активен — это НЕ «кнопка не найдена»
      const minMs = refineMinMinutes * 60 * 1000;
      const cdMs = s.cooldownMs && s.cooldownMs > 0 ? s.cooldownMs : 10 * 60 * 1000; // если не распарсили — 10 минут
      const wait = Math.max(minMs, cdMs);
      nextAt = now() + wait;
      const mins = Math.round(wait / 60000);
      log(`⏳ [Refinery] КД/активация. Следующая проверка через ~${mins} мин.`, 'info');
      log(`📅 Следующий визит на /refinery ≈ ${new Date(nextAt).toLocaleTimeString()}`, 'info');
      return false;
    }

    // unknown — не распознали разметку
    log('WRN ⚠️ [Refinery] Разметка не распознана. Проверим позже.', 'warn');
    nextAt = now() + refineMinMinutes * 60 * 1000;
    return false;
  }

  return {
    async tick() {
      if (!autoRefine) return false;
      if (now() < nextAt) return false;
      try {
        return await doPass();
      } catch (e) {
        log(`ERR ❌ [Refinery] Ошибка: ${e.message}`, 'error');
        nextAt = now() + refineMinMinutes * 60 * 1000;
        return false;
      }
    },
    getNextAt() { return nextAt; },
    scheduleInMinutes(mins) { nextAt = now() + Math.max(1, +mins) * 60 * 1000; }
  };
}

module.exports = { createRefineryController, URL_HOME, URL_REFINERY, gotoIfNeeded };
