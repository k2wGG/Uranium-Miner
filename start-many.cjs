#!/usr/bin/env node
/**
 * start-many.cjs
 * Запуск нескольких инстансов бота (bin/start.cjs) с разными профилями и прокси.
 *
 * Приоритет источников аккаунтов:
 *  1) --accounts acc1,acc2,acc3
 *  2) --accountsFile ./accounts.txt   (по одному имени в строке; # и ; — комментарии)
 *  3) --count N  → acc1..accN
 *  4) (fallback) автоскан папок в --baseDir
 *
 * Примеры:
 *  node start-many.cjs --count 3 --baseDir ./profile --proxies ./proxies.txt --headless=false --concurrency=2
 *  node start-many.cjs --accounts acc1,acc2 --baseDir ./profile --proxies ./proxies.txt --headless=false
 *  node start-many.cjs --accountsFile ./accounts.txt --baseDir ./profile --concurrency=3
 */

const { spawn } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const minimist = require('minimist');

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
    'headless',
    'rotateProxyOnReload',
    'showClientLogs',
    'sequential'
  ],
  default: {
    baseDir: path.resolve(process.cwd(), 'profile'),
    proxies: path.resolve(process.cwd(), 'proxies.txt'),
    startUrl: 'https://www.geturanium.io/',
    headless: false,
    rotateProxyOnReload: false,
    showClientLogs: false,
    sequential: false,
    concurrency: 4,
    count: 1,
    acceptLanguage: 'en-US,en;q=0.9',
    timezone: 'Europe/Berlin',
    reloadSec: 900
  },
  alias: {
    n: 'count',
    c: 'concurrency',
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

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

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

function pickProxy(list, idx) {
  if (!list || !list.length) return '';
  return list[idx % list.length]; // циклически
}

function ts() {
  return new Date().toISOString().slice(11,19);
}

function spawnBot({ name, profileDir, proxy }) {
  const childArgs = [
    path.resolve('bin/start.cjs'),
    '--profile', profileDir,
    '--startUrl', argv.startUrl,
    '--headless', String(!!argv.headless),
    '--rotateProxyOnReload', String(!!argv.rotateProxyOnReload),
    '--showClientLogs', String(!!argv.showClientLogs),
    '--reloadSec', String(argv.reloadSec),
    '--acceptLanguage', argv.acceptLanguage,
    '--timezone', argv.timezone
  ];
  if (argv.chromePath) childArgs.push('--chromePath', argv.chromePath);
  if (proxy) childArgs.push('--proxy', proxy);

  const child = spawn(process.execPath, childArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env
  });

  const prefix = C.cyan(`[${name}]`);
  child.stdout.on('data', (d) => {
    process.stdout.write(`${prefix} ${d}`);
  });
  child.stderr.on('data', (d) => {
    process.stderr.write(`${prefix} ${d}`);
  });
  child.on('exit', (code, sig) => {
    const msg = sig ? `signal ${sig}` : `code ${code}`;
    console.log(`${prefix} ${C.yellow('process exited')} (${msg})`);
  });

  return child;
}

async function resolveAccounts() {
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

  // 4) fallback: сканируем baseDir
  const scanned = await scanSubdirs(argv.baseDir);
  if (scanned.length) return scanned;

  return ['acc1'];
}

async function main() {
  const baseDir = path.resolve(argv.baseDir);
  await ensureDir(baseDir);

  // Загружаем прокси (может быть пусто)
  const proxies = await readLines(argv.proxies);

  // Список аккаунтов
  const accounts = await resolveAccounts();

  // Очередь задач
  const tasks = accounts.map((acc, idx) => {
    return async () => {
      const profileDir = path.join(baseDir, acc);
      await ensureDir(profileDir);
      const proxy = pickProxy(proxies, idx);
      console.log(`${C.gray(ts())} ${C.green('[LAUNCH]')} ${C.bold(acc)} → profile=${profileDir} proxy=${proxy || 'none'}`);
      spawnBot({ name: acc, profileDir, proxy });
      // небольшая пауза между стартами
      await new Promise(r => setTimeout(r, 300));
    };
  });

  // graceful shutdown для всех подпроцессов
  const children = new Set();
  const origSpawnBot = spawnBot;
  spawnBot = (opts) => {
    const ch = origSpawnBot(opts);
    children.add(ch);
    ch.on('exit', () => children.delete(ch));
    return ch;
  };
  const killAll = () => {
    console.log(`${C.gray(ts())} ${C.yellow('[SHUTDOWN]')} terminating children…`);
    for (const ch of children) {
      try { process.platform === 'win32' ? ch.kill() : ch.kill('SIGTERM'); } catch {}
    }
  };
  process.on('SIGINT', () => { killAll(); process.exit(0); });
  process.on('SIGTERM', () => { killAll(); process.exit(0); });

  if (argv.sequential) {
    for (const t of tasks) await t();
  } else {
    const conc = Math.max(1, Number(argv.concurrency || 4));
    let i = 0;
    await Promise.all(
      Array.from({ length: conc }, async () => {
        while (i < tasks.length) {
          const j = i++;
          await tasks[j]();
        }
      })
    );
  }
}

main().catch((e) => {
  console.error(C.red(`FATAL: ${e.stack || e.message}`));
  process.exit(1);
});
