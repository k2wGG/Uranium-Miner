// cli/manager.cjs
/**
 * Процесс-менеджер ботов.
 * Функции:
 *   - startBot()               — запуск одного профиля
 *   - startBotsBatch(opts?)    — запуск выбранных профилей пачкой (headless + concurrency).
 *                                Если opts.profiles переданы — НЕ спрашиваем повторно.
 *   - startAllBotsPrompt()     — алиас на интерактивный батч-запуск (совместимость)
 *   - stopBot(), restartBot(), listRunning(), stopAllBots()
 *
 * ВАЖНО: при spawn передаём сначала ПУТЬ К СКРИПТУ, затем аргументы скрипта.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const inquirer = require('inquirer');
const chalk = require('chalk');

const PROFILES_DIR = path.resolve(process.cwd(), 'profiles');
const DATA_DIR     = path.resolve(process.cwd(), 'data');
const PROXIES_FILE = path.join(DATA_DIR, 'proxies.txt');

const running = new Map(); // name -> child proc

function logPrefix(name, line) {
  return `[${chalk.cyan(name)}] ${line}`;
}

async function listProfiles() {
  try {
    const entries = await fsp.readdir(PROFILES_DIR, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name).sort();
  } catch {
    return [];
  }
}

/* ─────────────── работа с прокси ─────────────── */

async function readProxiesFile() {
  try {
    const raw = await fsp.readFile(PROXIES_FILE, 'utf8');
    return raw
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('#'));
  } catch {
    return [];
  }
}

function maskProxyForLog(p) {
  try {
    let s = p.trim();
    if (!/^([a-z]+:)?\/\//i.test(s)) s = 'http://' + s;
    const u = new URL(s);
    const host = u.hostname;
    const port = u.port ? `:${u.port}` : '';
    const scheme = u.protocol.replace(':','');
    return `${scheme}://${host}${port}`;
  } catch {
    return p.replace(/:.+@/, ':***@');
  }
}

function pickProxyForProfile(profile, proxies) {
  if (!proxies.length) return null;
  // стабильное распределение: простейший hash по имени
  let h = 0;
  for (const ch of profile) h = ((h << 5) - h + ch.charCodeAt(0)) | 0;
  const idx = Math.abs(h) % proxies.length;
  return proxies[idx];
}

/* ─────────────── запуск дочернего процесса ─────────────── */

/**
 * Запуск дочернего процесса бота.
 * Передаём:
 *   node <script> --profile <path> --headless <true|false> [--proxy <string>]
 * Дублируем headless/proxy в ENV для совместимости.
 */
function spawnBot({ profile, headless = false, proxy = '', extraEnv = {} }) {
  const nodeBin = process.execPath;
  const script = path.resolve(__dirname, '..', 'bin', 'start.cjs');

  const args = [script, '--profile', path.resolve(PROFILES_DIR, profile), '--headless', String(!!headless)];
  if (proxy) args.push('--proxy', proxy);

  const env = {
    ...process.env,
    HEADLESS: headless ? '1' : '0',
    PROXY: proxy || '',
    ...extraEnv
  };

  const child = spawn(nodeBin, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
    windowsHide: true
  });

  running.set(profile, child);

  child.stdout.on('data', (b) => {
    const s = String(b).split(/\r?\n/).filter(Boolean);
    for (const ln of s) console.log(logPrefix(profile, ln));
  });
  child.stderr.on('data', (b) => {
    const s = String(b).split(/\r?\n/).filter(Boolean);
    for (const ln of s) console.log(logPrefix(profile, chalk.red(ln)));
  });
  child.on('exit', (code) => {
    console.log(logPrefix(profile, chalk.gray(`процесс упал (code ${code})`)));
    running.delete(profile);
  });

  return child;
}

/* ─────────────── публичные действия ─────────────── */

async function startBot() {
  const profiles = await listProfiles();
  if (!profiles.length) {
    console.log(chalk.yellow('Нет профилей в ./profiles'));
    return;
  }

  const ans = await inquirer.prompt([
    { type: 'list', name: 'profile', message: 'Какой профиль запустить?', choices: profiles, loop: false, pageSize: profiles.length },
    { type: 'confirm', name: 'headless', message: 'Запуск без окон (headless)?', default: true }
  ]);

  if (running.has(ans.profile)) {
    console.log(chalk.yellow('Этот профиль уже запущен.'));
    return;
  }

  const proxies = await readProxiesFile();
  const proxy   = pickProxyForProfile(ans.profile, proxies);
  if (proxy) console.log(chalk.gray(`Прокси для ${ans.profile}: ${maskProxyForLog(proxy)}`));

  spawnBot({ profile: ans.profile, headless: ans.headless, proxy });
}

/**
 * Батч-запуск. Если передан opts.profiles — НЕ спрашиваем повторно список.
 * opts: { profiles?: string[], headless?: boolean, concurrency?: number }
 */
async function startBotsBatch(opts = {}) {
  const allProfiles = await listProfiles();
  if (!allProfiles.length) {
    console.log(chalk.yellow('Нет профилей в ./profiles'));
    return;
  }

  let profiles = Array.isArray(opts) ? opts : Array.isArray(opts.profiles) ? opts.profiles : null;

  // если профили не переданы — интерактивный выбор
  if (!profiles) {
    const ansPick = await inquirer.prompt([{
      type: 'checkbox',
      name: 'accs',
      message: 'Выберите аккаунты:',
      choices: allProfiles.map(p => ({ name: p, value: p })),
      loop: false,
      pageSize: Math.min(allProfiles.length, 20),
      validate: v => v.length ? true : 'Нужно выбрать хотя бы один профиль'
    }]);
    profiles = ansPick.accs;
  }

  const notRunning = profiles.filter(p => !running.has(p));
  if (!notRunning.length) {
    console.log(chalk.yellow('Все выбранные уже запущены или пусто.'));
    return;
  }

  // headless / concurrency — берём из opts, иначе спрашиваем
  let headless = typeof opts.headless === 'boolean' ? opts.headless : undefined;
  let concurrency = Number.isFinite(opts.concurrency) ? Math.max(1, opts.concurrency|0) : undefined;

  if (headless === undefined || concurrency === undefined) {
    const ans = await inquirer.prompt([
      ...(headless === undefined ? [{ type: 'confirm', name: 'headless', message: 'Запуск без окон (headless)?', default: true }] : []),
      ...(concurrency === undefined ? [{ type: 'number', name: 'concurrency', message: 'Сколько одновременно запускать?', default: 3, filter: v => Math.max(1, Number(v)||1) }] : [])
    ]);
    if (headless === undefined) headless = !!ans.headless;
    if (concurrency === undefined) concurrency = Math.max(1, ans.concurrency|0);
  }

  const proxies = await readProxiesFile();

  let active = 0, idx = 0;
  await new Promise((resolve) => {
    const tryNext = () => {
      while (active < concurrency && idx < notRunning.length) {
        const profile = notRunning[idx++];
        active++;

        const proxy = pickProxyForProfile(profile, proxies);
        const proxyInfo = proxy ? `, proxy=${maskProxyForLog(proxy)}` : ', proxy=none';
        console.log(chalk.cyan(`Запуск ${profile} (headless=${headless}${proxyInfo})…`));

        const ch = spawnBot({ profile, headless, proxy });
        ch.on('exit', () => { active--; tryNext(); });
      }
      if (idx >= notRunning.length && active === 0) resolve();
    };
    tryNext();
  });
}

// старое имя — оставляем для совместимости с меню/скриптами
async function startAllBotsPrompt() {
  return startBotsBatch({});
}

async function stopBot(runningMap = running) {
  const names = Array.from(runningMap.keys());
  if (!names.length) return console.log(chalk.gray('Нет активных процессов.'));
  const { who } = await inquirer.prompt([
    { type: 'list', name: 'who', message: 'Кого остановить?', choices: names, loop: false, pageSize: names.length }
  ]);
  const ch = runningMap.get(who);
  if (ch) { ch.kill(); runningMap.delete(who); }
}

async function restartBot(runningMap = running) {
  const names = Array.from(runningMap.keys());
  if (!names.length) return console.log(chalk.gray('Нет активных процессов.'));
  const { who, headless } = await inquirer.prompt([
    { type: 'list', name: 'who', message: 'Кого перезапустить?', choices: names, loop: false, pageSize: names.length },
    { type: 'confirm', name: 'headless', message: 'Перезапустить без окон (headless)?', default: true }
  ]);
  const ch = runningMap.get(who);
  if (ch) ch.kill();

  const proxies = await readProxiesFile();
  const proxy   = pickProxyForProfile(who, proxies);
  if (proxy) console.log(chalk.gray(`Прокси для ${who}: ${maskProxyForLog(proxy)}`));

  spawnBot({ profile: who, headless, proxy });
}

function listRunning() {
  return Array.from(running.keys());
}

async function stopAllBots() {
  for (const [name, ch] of running) { try { ch.kill(); } catch {} }
  running.clear();
}

module.exports = {
  startBot,
  startBotsBatch,
  startAllBotsPrompt, // совместимость
  stopBot,
  restartBot,
  listRunning,
  stopAllBots
};
