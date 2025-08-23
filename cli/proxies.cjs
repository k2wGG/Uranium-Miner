// cli/proxies.cjs
/**
 * Управление списком прокси.
 *
 * НОВОЕ:
 *  - Без «крашей» при вставке большого списка (50+ строк): режим через встроенный редактор.
 *  - Импорт из файла.
 *  - Дедупликация, авто-трим, корректная запись с переводами строк.
 *  - Понимает любые разделители: переносы строк, пробелы, запятые, ;, |, табы.
 *
 * Файл ищется тут: ./data/proxies.txt ИЛИ ./proxies.txt (в корне).
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const inquirer = require('inquirer'); // v8 (CommonJS)
const chalk = require('chalk');

const NL = os.EOL;
const CANDIDATES = [
  path.resolve('data', 'proxies.txt'),
  path.resolve('proxies.txt')
];

let _proxiesPath = null;

async function ensureFile() {
  if (_proxiesPath) return _proxiesPath;

  const existing = CANDIDATES.filter(p => fs.existsSync(p));
  if (existing.length === 1) {
    _proxiesPath = existing[0];
    return _proxiesPath;
  }
  if (existing.length > 1) {
    const { use } = await inquirer.prompt([{
      type: 'list',
      name: 'use',
      message: 'Обнаружены два файла прокси. Какой использовать по умолчанию?',
      choices: existing,
      loop: false,
      pageSize: existing.length
    }]);
    _proxiesPath = use;
    return _proxiesPath;
  }

  // нет ни одного → создаём ./data/proxies.txt
  _proxiesPath = CANDIDATES[0];
  await fsp.mkdir(path.dirname(_proxiesPath), { recursive: true });
  await fsp.writeFile(_proxiesPath, '', 'utf8');
  return _proxiesPath;
}

async function readLines(file) {
  try {
    const txt = await fsp.readFile(file, 'utf8');
    return txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function writeLines(file, lines) {
  const body = lines.join(NL) + (lines.length ? NL : '');
  await fsp.writeFile(file, body, 'utf8');
}

function splitMany(raw) {
  // поддерживаем: переносы строк, запятые, пробелы, ; | табы
  return String(raw || '')
    .split(/[\r\n,;|\t ]+/g)
    .map(s => s.trim())
    .filter(Boolean);
}

async function listProxies() {
  const file = await ensureFile();
  const lines = await readLines(file);
  if (!lines.length) {
    console.log(chalk.yellow(`⚠️ Список прокси пуст (${file})`));
    return [];
  }
  console.log(chalk.cyan(`🌐 Файл прокси: ${file}`));
  lines.forEach((p, i) => console.log(`${i + 1}. ${p}`));
  return lines;
}

/**
 * Добавление прокси:
 *  - «Быстрое» (одно/несколько через запятую/пробелы)
 *  - «Много строк» (через встроенный редактор — безопасно для 50+ строк)
 *  - «Импорт из файла»
 */
async function addProxy() {
  const file = await ensureFile();

  const { mode } = await inquirer.prompt([{
    type: 'list',
    name: 'mode',
    message: 'Как добавить прокси?',
    choices: [
      { name: '➕ Ввести здесь (одно или несколько через запятую/пробелы)', value: 'inline' },
      { name: '📝 Вставить много строк (откроется редактор — удобно для 50+)', value: 'editor' },
      { name: '📥 Импорт из файла', value: 'file' }
    ],
    loop: false,
    pageSize: 3
  }]);

  let incoming = [];

  if (mode === 'inline') {
    const { proxyRaw } = await inquirer.prompt([{
      type: 'input',
      name: 'proxyRaw',
      message: 'Введите прокси (host:port или user:pass@host:port). Можно сразу несколько через запятую/пробелы/; :'
    }]);
    incoming = splitMany(proxyRaw);

  } else if (mode === 'editor') {
    // откроет системный редактор (на Windows — notepad). Можно вставить столбик из любого места.
    const { bigText } = await inquirer.prompt([{
      type: 'editor',
      name: 'bigText',
      message: 'Вставьте список прокси (по одному на строку). Сохраните и закройте редактор.'
    }]);
    incoming = splitMany(bigText);

  } else if (mode === 'file') {
    const { p } = await inquirer.prompt([{
      type: 'input',
      name: 'p',
      message: 'Путь к файлу со списком прокси:'
    }]);
    try {
      const txt = await fsp.readFile(path.resolve(p), 'utf8');
      incoming = splitMany(txt);
    } catch (e) {
      console.log(chalk.red(`Не удалось прочитать файл: ${e.message}`));
      return;
    }
  }

  if (!incoming.length) {
    console.log(chalk.yellow('Ничего не добавлено.'));
    return;
  }

  // дедуп: сначала существующие, затем новые
  const before = await readLines(file);
  const set = new Set(before);
  const toAdd = [];

  for (const p of incoming) {
    if (!set.has(p)) {
      set.add(p);
      toAdd.push(p);
    }
  }

  if (!toAdd.length) {
    console.log(chalk.yellow('Все введённые прокси уже есть в списке.'));
    return;
  }

  const after = [...before, ...toAdd];
  try {
    await writeLines(file, after);
    console.log(chalk.green(`✅ Добавлено: ${toAdd.length}. Итоговый размер: ${after.length}.`));
  } catch (e) {
    console.log(chalk.red(`Ошибка записи: ${e.message}`));
  }
}

async function deleteProxy() {
  const file = await ensureFile();
  const lines = await readLines(file);
  if (!lines.length) {
    console.log(chalk.yellow(`⚠️ Список прокси пуст (${file})`));
    return;
  }
  const { idxs } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'idxs',
    message: 'Выберите прокси для удаления (пробел — отметить, Enter — подтвердить):',
    choices: lines.map((p, i) => ({ name: p, value: i })),
    validate: (arr) => arr.length ? true : 'Нужно выбрать хотя бы один пункт',
    loop: false,
    pageSize: Math.min(lines.length, 20)
  }]);

  if (!idxs || !idxs.length) return;

  const keep = lines.filter((_, i) => !idxs.includes(i));
  await writeLines(file, keep);
  console.log(chalk.red(`❌ Удалено: ${idxs.length}. Осталось: ${keep.length}.`));
}

module.exports = { listProxies, addProxy, deleteProxy };
