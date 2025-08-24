// cli/menu.cjs
/**
 * Главное интерактивное меню управления ботами (CJS).
 * Совместимо с inquirer@8 и chalk@4.
 * Фиксы: отключен цикл (loop:false), pageSize = числу элементов, узкий баннер на Windows.
 * Добавлены пункты массового запуска: «Запустить выбранные», «Запустить все».
 */

const inquirer = require('inquirer'); // npm i inquirer@8
const chalk = require('chalk');       // npm i chalk@4
const { Separator } = inquirer;
let figlet = null; try { figlet = require('figlet'); } catch {}

const { initSessionsMenu } = require('./sessions.cjs');
const { listAccounts, addAccount, deleteAccount, checkCookies, editConfig } = require('./helpers.cjs');
const { listProxies, addProxy, deleteProxy } = require('./proxies.cjs');
const { startBot, startBotsBatch, stopBot, restartBot, listRunning, stopAllBots } = require('./manager.cjs');

const IS_WIN = process.platform === 'win32';
const EMOJI = process.env.FORCE_EMOJI ? true : !IS_WIN;
const ico = (e, fallback='') => (EMOJI ? e : fallback);

// кеш последнего выбора для «Запустить выбранные»
let _cachedSelection = [];

function showBanner() {
  console.clear();
  const font = IS_WIN ? 'Standard' : 'ANSI Shadow';
  if (figlet && typeof figlet.textSync === 'function') {
    try { console.log(chalk.green(figlet.textSync('N3R', { font }))); }
    catch { console.log(chalk.green('\n=== N3R ===\n')); }
  } else {
    console.log(chalk.green('\n=== N3R ===\n'));
  }
  console.log(chalk.cyan('Web3 / Nodes Manager CLI by @NodesN3R\n'));
}

async function askList({ message, items }) {
  const { value } = await inquirer.prompt([{
    type: 'list',
    name: 'value',
    message,
    choices: items,
    pageSize: items.length,
    loop: false
  }]);
  return value;
}

// единый чекбокс-диалог выбора профилей
async function pickAccounts({ accounts, preselected = [] }) {
  const { accs } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'accs',
    message: 'Выберите аккаунты:',
    choices: accounts.map(a => ({ name: a, value: a })),
    default: preselected,
    validate: arr => arr.length ? true : 'Нужно выбрать хотя бы один аккаунт',
    pageSize: Math.max(3, Math.min(accounts.length, 20)),
    loop: false
  }]);
  return accs;
}

async function mainMenu() {
  showBanner();

  while (true) {
    try {
      const value = await askList({
        message: chalk.cyan('Выберите раздел:'),
        items: [
          { name: `${ico('👥','-')} Аккаунты`, value: 'accounts' },
          { name: `${ico('🌐','-')} Прокси`, value: 'proxies' },
          new Separator(),
          { name: `${ico('🔑','-')} Инициализировать сессии (логин)`, value: 'sessions' },
          { name: `${ico('🤖','-')} Боты`, value: 'bots' },
          { name: `${ico('⚙️','-')} Конфиг`, value: 'config' },
          { name: `${ico('📜','-')} Логи`, value: 'logs' },
          new Separator(),
          { name: `${ico('🚪','-')} Выход`, value: 'exit' }
        ]
      });

      if (value === 'accounts')       await accountsMenu();
      else if (value === 'proxies')   await proxiesMenu();
      else if (value === 'sessions')  await initSessionsMenu();
      else if (value === 'bots')      await botsMenu();
      else if (value === 'config')    await configMenu();
      else if (value === 'logs')      await logsMenu();
      else if (value === 'exit') {
        await stopAllBots();
        console.log(chalk.yellow('👋 Выход'));
        process.exit(0);
      }
    } catch (e) {
      console.log(chalk.red(`Ошибка: ${e.message}`));
    }
  }
}

async function accountsMenu() {
  const accounts = await safeListAccounts();

  const value = await askList({
    message: chalk.green('Управление аккаунтами:'),
    items: [
      { name: `${ico('➕','+')} Добавить аккаунт`, value: 'add' },
      { name: `${ico('❌','x')} Удалить аккаунт`, value: 'del' },
      { name: `${ico('🔍','>')} Проверить cookies`, value: 'check' },
      new Separator(),
      { name: 'Назад', value: 'back' }
    ]
  });

  if (value === 'add')   await addAccount();
  if (value === 'del')   await deleteAccount(accounts);
  if (value === 'check') await checkCookies(accounts);
}

async function proxiesMenu() {
  const value = await askList({
    message: chalk.green('Управление прокси:'),
    items: [
      { name: `${ico('📜','>')} Список прокси`, value: 'list' },
      { name: `${ico('➕','+')} Добавить прокси`, value: 'add' },
      { name: `${ico('❌','x')} Удалить прокси`, value: 'del' },
      new Separator(),
      { name: 'Назад', value: 'back' }
    ]
  });

  if (value === 'list') await listProxies();
  if (value === 'add')  await addProxy();
  if (value === 'del')  await deleteProxy();
}

async function botsMenu() {
  const accounts = await safeListAccounts();
  const running  = listRunning();

  const value = await askList({
    message: chalk.green('Управление ботами:'),
    items: [
      { name: `${ico('▶️','>')} Запустить 1 бота`, value: 'startOne' },
      { name: '✅ Запустить выбранные', value: 'startSelected' },
      { name: '🚀 Запустить все аккаунты', value: 'startAll' },
      { name: `${ico('⏸','| |')} Остановить бота`, value: 'stop' },
      { name: `${ico('🔄','~')} Перезапустить бота`, value: 'restart' },
      { name: `${ico('📋','>')} Список активных`, value: 'ls' },
      new Separator(),
      { name: 'Назад', value: 'back' }
    ]
  });

  if (value === 'startOne') {
    // интерактивный ввод имени профиля внутри startBot()
    await startBot();
    return;
  }

  if (value === 'startSelected') {
    if (!accounts.length) {
      console.log(chalk.yellow('Нет профилей в ./profiles'));
      return;
    }
    // если уже выбирали раньше — не спрашиваем повторно
    const list = _cachedSelection.length
      ? _cachedSelection
      : await pickAccounts({ accounts });

    if (!list.length) return;
    _cachedSelection = list;

    // передаём выбранные напрямую в менеджер
    await startBotsBatch({ profiles: list });
    return;
  }

  if (value === 'startAll') {
    if (!accounts.length) {
      console.log(chalk.yellow('Нет профилей в ./profiles'));
      return;
    }
    _cachedSelection = [...accounts];
    await startBotsBatch({ profiles: accounts });
    return;
  }

  if (value === 'stop')    { await stopBot(running); return; }
  if (value === 'restart') { await restartBot(running); return; }
  if (value === 'ls') {
    console.log(chalk.cyan('Активные:'), running.length ? running.join(', ') : 'нет');
  }
}

async function configMenu() {
  const accounts = await safeListAccounts();
  await editConfig(accounts);
}

async function logsMenu() {
  console.log(
    chalk.yellow(
      'Уровень логов настраивается в config.json профиля через "showClientLogs".\n' +
      'Пример:\n{\n  "showClientLogs": false\n}\n'
    )
  );
}

async function safeListAccounts() {
  try { return await listAccounts(); }
  catch (e) {
    console.log(chalk.red(`Не удалось прочитать список аккаунтов: ${e.message}`));
    return [];
  }
}

mainMenu();
