// src/config/def.cjs
/**
 * Централизованный конфиг и статистика.
 * Хранит значения по умолчанию и умеет подмешивать CLI-параметры.
 */

const fs = require('fs').promises;
const path = require('path');

const DEF = {
  // Тогглы действий
  autoAC: true,       // Auto Collector
  autoSM: true,       // Shard Multiplier
  autoCB: true,       // Conveyor Booster
  autoFarm: true,     // резерв под фарм, если нужен
  autoRefine: true,   // Инициировать Refinery

  // Интервалы (для бустов можешь добавить собственную логику таймеров)
  boostIntervalMs: 300000, // 5 минут
  boostJitterMs: 15000,

  // Перезагрузка
  reloadSec: 900,             // каждые 15 минут
  rotateProxyOnReload: false, // смена прокси на релонче — на стороне запуска

  // Запуск
  headless: true,
  slowMo: 0,
  useSystemChrome: false,
  chromePath: "",
  proxy: "",
  acceptLanguage: "en-US,en;q=0.9",
  timezone: "Europe/Berlin",
  startUrl: "https://www.geturanium.io/",
  showClientLogs: false,

  // Пути профиля и файлы
  profile: path.resolve(process.cwd(), 'run/default'),
  cookiesFilePath: 'cookies.json',
  configFilePath: 'config.json',
  statsFilePath: 'stats.json'
};

let _config = null;
let _stats  = null;

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function load(file, def) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { return def; }
}

async function save(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

async function loadConfigAndStats(argv) {
  const profileDir = argv.profile || DEF.profile;
  await ensureDir(profileDir);

  const cfgPath = argv.configFilePath
    ? path.resolve(argv.configFilePath)
    : path.join(profileDir, DEF.configFilePath);

  const stPath  = argv.statsFilePath
    ? path.resolve(argv.statsFilePath)
    : path.join(profileDir, DEF.statsFilePath);

  // Базовый конфиг из файла
  const base = await load(cfgPath, {});
  _config = {
    ...DEF,
    ...base,

    // приоритет CLI > file > default
    profile: profileDir,
    proxy: argv.proxy || base.proxy || DEF.proxy,
    chromePath: argv.chromePath || base.chromePath || DEF.chromePath,
    headless: typeof argv.headless === 'boolean' ? argv.headless : (base.headless ?? DEF.headless),
    showClientLogs: argv.showClientLogs ?? (base.showClientLogs ?? DEF.showClientLogs),
    rotateProxyOnReload: argv.rotateProxyOnReload ?? (base.rotateProxyOnReload ?? DEF.rotateProxyOnReload),
    reloadSec: argv.reloadSec || base.reloadSec || DEF.reloadSec,
    startUrl: argv.startUrl || base.startUrl || DEF.startUrl,
    acceptLanguage: argv.acceptLanguage || base.acceptLanguage || DEF.acceptLanguage,
    timezone: argv.timezone || base.timezone || DEF.timezone,

    // файлы в пределах профиля
    cookiesFilePath: base.cookiesFilePath
      ? path.join(profileDir, base.cookiesFilePath)
      : path.join(profileDir, DEF.cookiesFilePath),

    configFilePath: cfgPath,
    statsFilePath: stPath,
  };

  // Статистика
  const loadedStats = await load(stPath, {});
  _stats = {
    reloadCount: loadedStats.reloadCount || 0,
    clickCount: loadedStats.clickCount || {
      autoAC:0, autoSM:0, autoCB:0, autoFarm:0, autoRefine:0
    },
    lastClick:  loadedStats.lastClick  || {
      autoAC:0, autoSM:0, autoCB:0, autoFarm:0, autoRefine:0
    }
  };

  return {
    DEF,
    config: _config,
    stats: _stats,
    setConfig: (c)=>{ _config = c; },
    setStats: (s)=>{ _stats = s; }
  };
}

async function saveAll(config, stats) {
  try {
    await save(config.configFilePath, config);
    await save(config.statsFilePath, stats);
  } catch {
    // best-effort, умышленно без throw
  }
}

module.exports = { DEF, loadConfigAndStats, saveAll };
