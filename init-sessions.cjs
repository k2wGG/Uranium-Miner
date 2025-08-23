#!/usr/bin/env node
/**
 * init-sessions.cjs
 * Предподготовка профилей: открывает окно на каждый аккаунт, ждёт логин (если нужен),
 * проверяет наличие UI и сохраняет cookies в <profile>/<cookies.json>.
 *
 * Приоритет источников аккаунтов:
 *  1) --accounts acc1,acc2,acc3
 *  2) --accountsFile ./accounts.txt   (по одному имени в строке; # и ; — комментарии)
 *  3) --count N  → acc1..accN
 *  4) (fallback) автоскан подпапок в --baseDir
 *
 * Примеры:
 *  node init-sessions.cjs --count 2 --baseDir ./profile --proxies ./proxies.txt --headless=false
 *  node init-sessions.cjs --accountsFile ./accounts.txt --baseDir ./profile --headless=false
 *  node init-sessions.cjs --accounts acc1,acc2 --baseDir ./profile --proxies ./proxies.txt
 */

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const minimist = require('minimist');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const argv = minimist(process.argv.slice(2), {
  string: [
    'baseDir',
    'proxies',
    'chromePath',
    'startUrl',
    'accounts',
    'accountsFile',
    'acceptLanguage',
    'timezone'
  ],
  boolean: [
    'headless'
  ],
  default: {
    baseDir: path.resolve(process.cwd(), 'profile'),
    proxies: path.resolve(process.cwd(), 'proxies.txt'),
    startUrl: 'https://www.geturanium.io/',
    headless: false,
    count: 1,
    acceptLanguage: 'en-US,en;q=0.9',
    timezone: 'Europe/Berlin'
  },
  alias: {
    n: 'count',
    d: 'baseDir'
  }
});

function color(s, code){ return `\x1b[${code}m${s}\x1b[0m`; }
const C = {
  gray:   s=>color(s,90),
  cyan:   s=>color(s,36),
  yellow: s=>color(s,33),
  red:    s=>color(s,31),
  green:  s=>color(s,32),
  bold:   s=>`\x1b[1m${s}\x1b[0m`
};

async function ensureDir(dir){ await fsp.mkdir(dir, { recursive:true }); }

async function readLines(file) {
  try {
    const txt = await fsp.readFile(file, 'utf8');
    return txt
      .split(/\r?\n/)
      .map(l => l.replace(/[#;].*$/,'').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function scanSubdirs(dir) {
  try {
    const names = await fsp.readdir(dir, { withFileTypes: true });
    return names.filter(d => d.isDirectory()).map(d => d.name);
  } catch {
    return [];
  }
}

function normalizeProxy(p) {
  try {
    if (!p) return null;
    let s = String(p).trim();
    if (!/^[a-z]+:\/\//i.test(s)) s = 'http://' + s; // по умолчанию http
    const u = new URL(s);
    const scheme = u.protocol.replace(':','').toLowerCase();
    const host = u.hostname;
    const port = u.port;
    if (!host || !port) return null;
    const auth = (u.username || u.password) ? {
      username: decodeURIComponent(u.username||''),
      password: decodeURIComponent(u.password||'')
    } : null;
    return { serverArg: `${scheme}://${host}:${port}`, auth };
  } catch {
    return null;
  }
}

function ts(){ return new Date().toISOString().slice(11,19); }

async function waitForUI(page, timeoutMs=20000) {
  const xpaths = [
    "//button[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'),'auto collector')]",
    "//button[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'),'shard multiplier')]",
    "//button[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'),'conveyor booster')]",
    "//*[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'),'refinery')]",
  ];
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    for (const xp of xpaths) {
      try {
        await page.waitForXPath(xp, { timeout: 1500 });
        return true;
      } catch {}
    }
  }
  return false;
}

async function saveCookies(page, profileDir) {
  const cookies = await page.cookies();
  const cookiesPath = path.join(profileDir, 'cookies.json');
  await fsp.writeFile(cookiesPath, JSON.stringify(cookies, null, 2), 'utf8');
  return cookiesPath;
}

async function seedOne({ name, profileDir, proxy }) {
  const userDataDir = path.join(profileDir, 'browser_profile');
  await ensureDir(userDataDir);

  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-notifications',
    '--disable-popup-blocking'
  ];
  const parsed = normalizeProxy(proxy);
  if (parsed) args.push(`--proxy-server=${parsed.serverArg}`);

  const browser = await puppeteer.launch({
    headless: argv.headless ? 'new' : false,
    userDataDir,
    executablePath: argv.chromePath || undefined,
    args
  });

  const [page] = await browser.pages();

  if (parsed && parsed.auth) {
    try { await page.authenticate(parsed.auth); }
    catch (e) { console.log(C.yellow(`[${name}] proxy-auth: ${e.message}`)); }
  }
  if (argv.acceptLanguage) await page.setExtraHTTPHeaders({ 'Accept-Language': argv.acceptLanguage });
  if (argv.timezone) { try { await page.emulateTimezone(argv.timezone); } catch {} }

  console.log(`${C.cyan(`[${name}]`)} Открываю ${argv.startUrl}  (proxy ${parsed ? parsed.serverArg : 'none'}${parsed&&parsed.auth?' with auth':''})`);
  await page.goto(argv.startUrl, { waitUntil: 'networkidle2', timeout: 60000 });

  console.log(`${C.cyan(`[${name}]`)} Если требуется — выполните вход. Скрипт будет ждать UI до 3 минут.`);

  // ждём UI до 3 минут, проверяя каждые ~1.5 сек
  const hardEnd = Date.now() + 180000;
  let uiDetected = false;
  while (Date.now() < hardEnd) {
    uiDetected = await waitForUI(page, 3000);
    if (uiDetected) break;
    // иногда после логина редиректит на /auth — подождём навигацию
    try {
      await page.waitForNavigation({ waitUntil:'networkidle2', timeout: 2000 }).catch(()=>{});
    } catch {}
  }

  if (uiDetected) {
    console.log(`${C.cyan(`[${name}]`)} UI найден. Сохраняю cookies…`);
  } else {
    console.log(`${C.cyan(`[${name}]`)} UI не распознан. Сохраняю cookies на всякий случай…`);
  }
  const cookiesPath = await saveCookies(page, profileDir);
  console.log(`${C.cyan(`[${name}]`)} Cookies сохранены → ${cookiesPath}`);

  // финальный скрин — на случай отладки
  try {
    await fsp.mkdir(path.join(profileDir, 'screens'), { recursive: true });
    await page.screenshot({ path: path.join(profileDir, 'screens', `init_${Date.now()}.png`), fullPage: true }).catch(()=>{});
  } catch {}

  await browser.close().catch(()=>{});
}

async function resolveAccounts(baseDir) {
  // 1) --accounts
  if (argv.accounts) {
    return String(argv.accounts)
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }

  // 2) --accountsFile
  if (argv.accountsFile) {
    const list = await readLines(argv.accountsFile);
    if (list.length) return list;
  }

  // 3) --count → acc1..accN
  const n = Math.max(1, Number(argv.count || 1));
  if (n > 0) {
    return Array.from({ length: n }, (_, i) => `acc${i+1}`);
  }

  // 4) fallback — подпапки
  const scanned = await scanSubdirs(baseDir);
  if (scanned.length) return scanned;

  return ['acc1'];
}

async function main() {
  const baseDir = path.resolve(argv.baseDir);
  await ensureDir(baseDir);

  const proxies = await readLines(argv.proxies);
  const accounts = await resolveAccounts(baseDir);

  for (let i=0; i<accounts.length; i++) {
    const acc = accounts[i];
    const profileDir = path.join(baseDir, acc);
    await ensureDir(profileDir);
    const proxy = proxies.length ? proxies[i % proxies.length] : '';
    console.log(`${C.gray(ts())} ${C.green('[INIT]')} ${C.bold(acc)} → profile=${profileDir} proxy=${proxy || 'none'}`);
    try {
      await seedOne({ name: acc, profileDir, proxy });
    } catch (e) {
      console.log(C.red(`[${acc}] ERROR: ${e.stack || e.message}`));
    }
  }

  console.log(C.green('Готово. Теперь можно запускать ботов через start-many.cjs или bin/start.cjs.'));
}

main().catch(e => {
  console.error(C.red(`FATAL: ${e.stack||e.message}`));
  process.exit(1);
});
