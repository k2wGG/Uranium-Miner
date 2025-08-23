// src/core/actions.cjs
/**
 * Клики по бустам на главной (Mine) — устойчивый поиск и ЖЁСТКОЕ подтверждение.
 * Экспорт: setClientFlags, waitForMineReady, runClicksOnce
 */

const URL_HOME = 'https://www.geturanium.io/';

let CLIENT = { showClientLogs: false };
function setClientFlags(f = {}) { CLIENT = { ...CLIENT, ...f }; }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rnd   = (min, max) => (min + Math.random() * (max - min)) | 0;

/* ───────────────────────── базовые помощники ───────────────────────── */

async function ensureOnHome(page) {
  const onHome = await page.evaluate((home) => {
    try {
      const u = new URL(location.href);
      const p = (u.pathname || '/').replace(/\/+$/, '');
      return /(^|\.)geturanium\.io$/i.test(u.hostname) && (p === '' || p === '/');
    } catch { return false; }
  }, URL_HOME);

  if (!onHome) {
    await page.goto(URL_HOME, { waitUntil: 'networkidle2', timeout: 60000 });
  }

  // «подтолкнуть» гидрацию
  try { await page.waitForSelector('body', { timeout: 10000 }); } catch {}
  try {
    await page.evaluate(() => {
      try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch {}
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
      document.dispatchEvent(new Event('focus', { bubbles: true }));
      if (window.requestAnimationFrame) for (let i = 0; i < 6; i++) requestAnimationFrame(() => {});
    });
  } catch {}
}

/** Закрытие куки-баннеров/модалок */
async function dismissOverlays(page) {
  try {
    await page.evaluate(() => {
      const N = s => String(s||'').toLowerCase().replace(/\s+/g,' ').trim();
      const maybeButtons = Array.from(document.querySelectorAll('button,[role="button"],a'));
      const needles = [
        'accept all','accept','agree','got it','ok','close','start','continue','i understand',
        'allow','dismiss','skip'
      ];
      for (const el of maybeButtons) {
        const t = N(el.innerText || el.textContent);
        if (needles.some(n => t === n || t.includes(' '+n+' '))) {
          try { el.click(); } catch {}
        }
      }
      // примитивные backdrop/модалки
      Array.from(document.querySelectorAll('[data-headlessui-state="open"],.fixed.inset-0,.modal,.backdrop'))
        .forEach(el => { el.style.display = 'none'; el.setAttribute('data-auto-closed','1'); });
    });
  } catch {}
}

/** Физический клик мышью (с небольшим «человечным» движением) */
async function physicalClick(page, elHandle) {
  try {
    await elHandle.evaluate(el => { try { el.scrollIntoView({ block: 'center' }); } catch {} });
    const box = await elHandle.boundingBox();
    if (!box || !box.width || !box.height) return false;
    const x = box.x + Math.random() * box.width;
    const y = box.y + Math.random() * box.height;
    await page.mouse.move(x, y, { steps: 16 });
    await page.mouse.down(); await sleep(40 + Math.random()*120); await page.mouse.up();
    return true;
  } catch { return false; }
}

/** Активное ожидание блока Boosters: скроллим, «шевелим» страницу, один мягкий reload */
async function waitForBoosters(page, totalTimeoutMs = 45000, allowSoftReloadOnce = true) {
  const t0 = Date.now();

  while (Date.now() - t0 < totalTimeoutMs) {
    const ok = await page.evaluate(() => {
      const N = (s) => String(s || '').toLowerCase();
      const bodyText = N(document.body?.innerText || document.body?.textContent || '');
      const hasTitle = /\bboosters\b/.test(bodyText) || /temporary power-ups/i.test(bodyText);

      // грид с ≥3 широкими кнопками
      let hasGrid = false;
      const grids = Array.from(document.querySelectorAll('div,section,article'))
        .filter(el => /grid|grid-cols|sm:grid-cols-3|gap-3/i.test(el.className || ''));
      for (const g of grids) {
        const btns = Array.from(g.querySelectorAll('button'));
        const wide = btns.filter(b => {
          const r = b.getBoundingClientRect();
          return r && r.width > 250 && r.height > 48;
        });
        if (wide.length >= 3) { hasGrid = true; break; }
      }

      const h3s = Array.from(document.querySelectorAll('h3'))
        .map(h => N(h.textContent||h.innerText));
      const hasH3 = ['auto collector','shard multiplier','conveyor booster']
        .every(lbl => h3s.some(t => t.includes(lbl)));

      return hasTitle || hasGrid || hasH3;
    });
    if (ok) return true;

    // «подталкиваем» рендер
    try {
      await page.evaluate(() => {
        window.scrollBy(0, Math.round(window.innerHeight * 0.6));
        const b = document.body;
        if (b) {
          const r = b.getBoundingClientRect();
          const x = r.left + Math.random()*r.width;
          const y = r.top  + Math.random()*r.height;
          b.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:x,clientY:y}));
        }
        document.dispatchEvent(new Event('visibilitychange', { bubbles:true }));
        if (window.requestIdleCallback) requestIdleCallback(()=>{});
      });
    } catch {}

    await sleep(350);
  }

  if (allowSoftReloadOnce) {
    try {
      await page.goto(`${URL_HOME}?_=${Date.now()}`, { waitUntil:'networkidle2', timeout:60000 });
      await sleep(1200);
      await dismissOverlays(page);
    } catch {}
    return await waitForBoosters(page, 25000, false);
  }

  return false;
}

/** Публичная обёртка для обратной совместимости */
async function waitForMineReady(page, timeoutMs = 30000) {
  await ensureOnHome(page);
  await dismissOverlays(page);
  const ok = await waitForBoosters(page, timeoutMs, true);
  return ok;
}

/* ───────────── поиск кнопок (точно по <h3> + grid + близость) ───────────── */

function labelFor(key) {
  return key === 'autoAC' ? 'auto collector'
       : key === 'autoSM' ? 'shard multiplier'
       : key === 'autoCB' ? 'conveyor booster' : '';
}

/** Под вашу разметку: ищем <h3> и берём ближайший <button> */
async function findBoostByH3(page, key) {
  const label = labelFor(key);
  if (!label) return null;

  for (let i = 0; i < 6; i++) {
    const h = await page.evaluateHandle((needle) => {
      const N = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const hs = Array.from(document.querySelectorAll('h3'));
      for (const h3 of hs) {
        const t = N(h3.textContent || h3.innerText);
        if (!t.includes(needle)) continue;

        // 1) сам <button> предком
        let btn = h3.closest('button');
        if (btn) return btn;

        // 2) ближайший <button> вверх/вниз по иерархии
        let p = h3.parentElement;
        for (let k=0; k<5 && p; k++) {
          btn = p.querySelector?.('button');
          if (btn) return btn;
          p = p.parentElement;
        }
      }
      return null;
    }, label);

    const el = h.asElement ? h.asElement() : null;
    if (el) return el;

    try { await page.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 0.5))); } catch {}
    await sleep(200);
  }
  return null;
}

async function findBoostByGrid(page, key) {
  const indexMap = { autoAC: 0, autoSM: 1, autoCB: 2 };
  const idx = indexMap[key];

  const h = await page.evaluateHandle((idx) => {
    const grids = Array.from(document.querySelectorAll('div,section,article'))
      .filter(el => /grid|grid-cols|sm:grid-cols-3|gap-3/i.test(el.className || ''));
    for (const g of grids) {
      const btns = Array.from(g.querySelectorAll('button'))
        .filter(b => {
          const r = b.getBoundingClientRect();
          return r && r.width > 220 && r.height > 40;
        });
      if (btns.length >= 3) return btns[idx] || null;
    }
    return null;
  }, idx);

  return h.asElement ? h.asElement() : null;
}

async function findBoostByProximity(page, key) {
  const indexMap = { autoAC: 0, autoSM: 1, autoCB: 2 };
  const idx = indexMap[key];

  const h = await page.evaluateHandle((idx) => {
    const N = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    function headerBottom() {
      const headers = Array.from(document.querySelectorAll('h1,h2,h3,div,section'));
      for (const el of headers) {
        const t = N(el.textContent);
        if (/\bboosters\b/.test(t) || /temporary power-ups/i.test(t)) {
          const r = el.getBoundingClientRect();
          if (r && r.width && r.height) return r.bottom;
        }
      }
      return null;
    }
    const hb = headerBottom();
    const items = [];
    for (const b of Array.from(document.querySelectorAll('button'))) {
      const r = b.getBoundingClientRect();
      if (!r || !r.width || !r.height) continue;
      if (hb != null && r.top < hb - 10) continue;
      if (r.width < 220 || r.height < 40) continue;
      items.push({ y: r.top, el: b });
    }
    items.sort((a,b)=>a.y-b.y);
    if (items.length >= 3) return items[idx].el || null;
    return null;
  }, idx);

  return h.asElement ? h.asElement() : null;
}

async function findBoostElement(page, key) {
  const byH3   = await findBoostByH3(page, key);   if (byH3)   return byH3;
  const byGrid = await findBoostByGrid(page, key); if (byGrid) return byGrid;
  const byNear = await findBoostByProximity(page, key); if (byNear) return byNear;
  return null;
}

/* ───────────── состояние карточки + подтверждение ───────────── */

/** Строгое чтение состояния карточки буста */
async function getBoostState(page, key) {
  const label = labelFor(key);
  return await page.evaluate((needle) => {
    const norm = s => String(s||'').toLowerCase().replace(/\s+/g,' ').trim();

    function findBtnAndCard() {
      const hs = Array.from(document.querySelectorAll('h3'));
      for (const h3 of hs) {
        const t = norm(h3.textContent || h3.innerText);
        if (!t.includes(needle)) continue;

        let btn = h3.closest('button');
        if (!btn) {
          let p = h3.parentElement;
          for (let k=0; k<5 && p && !btn; k++) {
            btn = p.querySelector?.('button');
            p = p.parentElement;
          }
        }
        if (!btn) continue;

        const card = btn.closest('button, .rounded-lg, .border, [class*="rounded"], [class*="border"]') || btn.parentElement || btn;
        return { btn, card };
      }
      return { btn:null, card:null };
    }

    const found = findBtnAndCard();
    if (!found.btn) return { exists:false };

    const textBtn  = norm(found.btn.innerText || '');
    const textCard = norm(found.card?.innerText || '');
    const textAll  = `${textBtn} || ${textCard}`;

    const disabled = !!(found.btn.disabled || found.btn.getAttribute?.('aria-disabled') === 'true');

    // ВАЖНО: кулдаун только по явным маркерам, не по одиночным "5m".
    const inCooldown = /(remaining|time left|expires in|cooldown|active)/i.test(textAll);

    return { exists:true, disabled, inCooldown, text:textAll };
  }, label);
}

/** Подтверждаем клик: успех только по изменению состояния */
async function confirmBoostClicked(page, key, before) {
  const start = Date.now();
  while (Date.now() - start < 4500) {
    await sleep(300);
    const after = await getBoostState(page, key);
    if (!after.exists) continue;

    const becameDisabled = !before.disabled && after.disabled;
    const cooldownNow    = !before.inCooldown && after.inCooldown;

    // «таймер» засчитываем только вместе с ключевыми словами
    const hasTimerText = /(remaining|time left|expires in|cooldown|active)/i.test(after.text) &&
                         /\d+\s*(m|min|minutes?)|\d+\s*(s|sec|seconds?)/i.test(after.text);

    if (becameDisabled || cooldownNow || hasTimerText) {
      return { ok:true, reason: becameDisabled ? 'disabled' : (cooldownNow ? 'cooldown/remaining text' : 'timer text') };
    }
  }
  return { ok:false, reason:'no state change' };
}

/* ───────────────────── основной API ───────────────────── */

async function runClicksOnce(page, config, lastClick = {}) {
  const updatedLastClick = { ...lastClick };
  const incClicks = { autoAC:0, autoSM:0, autoCB:0 };

  // 1) На главную + закрыть оверлеи
  await ensureOnHome(page);
  await dismissOverlays(page);

  // 2) Ждём секцию Boosters (с активным «подталкиванием» и мягким reload один раз)
  const ready = await waitForBoosters(page, 45000, true);
  if (!ready) {
    console.log('WRN', '⚠️ Не дождались секции Boosters (возможен медленный рендер/прокс).');
    return { updatedLastClick, incClicks };
  }

  // 3) Клики по бустам (с интервалами)
  const keys = ['autoAC','autoSM','autoCB'];
  const base = Number(config.boostIntervalMs) || 300000;   // 5m
  const jitter = Number(config.boostJitterMs) || 15000;

  // чтобы не спамить "уже в кулдауне"
  const __coolLog = (runClicksOnce.__coolLog ||= {});

  for (const k of keys) {
    if (config[k] === false) continue;

    const since = Date.now() - (updatedLastClick[k] || 0);
    const delay = base + rnd(-jitter, jitter);
    if (since < delay) continue;

    // текущие состояния до клика
    const before = await getBoostState(page, k);
    if (!before.exists) {
      console.log('WRN', `⚠️ Не нашли элемент для ${k} (после полной проверки DOM).`);
      continue;
    }

    if (before.disabled || before.inCooldown) {
      const now = Date.now();
      if (!__coolLog[k] || now - __coolLog[k] > 60_000) {
        console.log('INF', `⏳ ${k}: уже в кулдауне — пропускаем.`);
        __coolLog[k] = now;
      }
      continue;
    }

    // ищем сам button для физического клика
    let btn = await findBoostElement(page, k);
    if (!btn) {
      console.log('WRN', `⚠️ Не нашли элемент для ${k} (после полной проверки DOM).`);
      continue;
    }

    // до 3 попыток «физического» клика с подтверждением
    let success = false, reason = '';
    for (let attempt = 1; attempt <= 3 && !success; attempt++) {
      const okPhys = await physicalClick(page, btn);
      if (!okPhys) { try { await btn.click({ delay: 25 }); } catch {} }

      const conf = await confirmBoostClicked(page, k, before);
      success = conf.ok; reason = conf.reason || '';
      if (!success) {
        try { await sleep(600 + rnd(0,500)); } catch {}
        try { btn = await findBoostElement(page, k); } catch {}
      }
    }

    if (success) {
      console.log('OK', `✅ Подтверждён клик: ${k} (${reason})`);
      updatedLastClick[k] = Date.now();
      incClicks[k] = (incClicks[k] || 0) + 1;
      await sleep(500 + rnd(0,700));
    } else {
      console.log('WRN', `⚠️ Клик не подтвердился для ${k} (reason="${reason}").`);
      // lastClick не трогаем — попробуем в следующем цикле
    }
  }

  // 4) Лёгкий keep-alive
  if (config.keepAlive !== false && rnd(0,10) < 2) {
    try {
      await page.evaluate(() => {
        fetch('/favicon.ico',{cache:'no-store',mode:'no-cors'}).catch(()=>{});
        const b = document.body;
        if (b) {
          const r = b.getBoundingClientRect();
          const x = r.left + Math.random()*r.width;
          const y = r.top  + Math.random()*r.height;
          b.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:x,clientY:y}));
        }
      });
    } catch {}
  }

  return { updatedLastClick, incClicks };
}

module.exports = { setClientFlags, waitForMineReady, runClicksOnce };
