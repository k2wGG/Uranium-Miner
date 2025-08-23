// cli/sessions.cjs
/**
 * Инициализация сессий прямо из интерактивного меню:
 * - выбираешь аккаунты (один/несколько),
 * - headless (обычно false для ручного логина),
 * - выбор файла прокси (./data/proxies.txt или ./proxies.txt),
 * - запускаем init-sessions.cjs и стримим вывод.
 *
 * Совместимо с CommonJS, Node 18+.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const inquirer = require('inquirer');
const chalk = require('chalk');

const { listAccounts } = require('./helpers.cjs');

const CANDIDATE_PROXY_FILES = [
  path.resolve('data', 'proxies.txt'),
  path.resolve('proxies.txt'),
];

async function pickProxyFile() {
  const existing = CANDIDATE_PROXY_FILES.filter(p => fs.existsSync(p));
  if (existing.length === 0) {
    const def = CANDIDATE_PROXY_FILES[0];
    await fsp.mkdir(path.dirname(def), { recursive: true });
    await fsp.writeFile(def, '', 'utf8');
    return def;
  }
  if (existing.length === 1) return existing[0];

  const { file } = await inquirer.prompt([{
    type: 'list',
    name: 'file',
    message: 'Обнаружено несколько файлов прокси. Какой использовать?',
    choices: existing
  }]);
  return file;
}

function runInitSessions({ accounts, baseDir, proxiesFile, headless }) {
  return new Promise((resolve, reject) => {
    if (!accounts || !accounts.length) {
      return reject(new Error('Не выбраны аккаунты'));
    }
    const args = [
      path.resolve('init-sessions.cjs'),
      '--accounts', accounts.join(','),
      '--baseDir', baseDir,
      '--proxies', proxiesFile,
      '--headless', String(!!headless)
    ];

    console.log(chalk.cyan('\n▶️  Запуск инициализации сессий:'));
    console.log(chalk.gray(`node ${args.map(a => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`));

    const child = spawn(process.execPath, args, { stdio: 'inherit' });

    child.once('error', (err) => {
      console.log(chalk.red(`\n❌ Ошибка запуска init-sessions: ${err.message}`));
      reject(err);
    });

    child.once('exit', (code) => {
      if (code === 0) {
        console.log(chalk.green('\n✅ Инициализация завершена.'));
        resolve();
      } else {
        console.log(chalk.red(`\n❌ init-sessions.cjs завершился с кодом ${code}`));
        reject(new Error(`exit ${code}`));
      }
    });
  });
}

/**
 * Точка входа из меню.
 * Показывает форму:
 *  - выбор аккаунтов (checkbox)
 *  - headless (false для ручного логина)
 *  - baseDir (обычно ./profiles)
 *  - выбор файла прокси (авто)
 */
async function initSessionsMenu() {
  const allAccounts = await listAccounts();
  if (allAccounts.length === 0) {
    console.log(chalk.yellow('⚠️ Сначала создайте аккаунты: Аккаунты → Добавить аккаунт.'));
    return;
  }

  const answers = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selected',
      message: 'Выберите аккаунты (пробел — отметить, Enter — продолжить):',
      choices: allAccounts.map(a => ({ name: a, value: a })),
      validate: (arr) => (arr && arr.length) ? true : 'Нужно выбрать хотя бы один аккаунт'
    },
    {
      type: 'confirm',
      name: 'headless',
      message: 'Открывать без окна (headless)? (РЕКОМЕНДУЮ: Нет — чтобы можно было залогиниться)',
      default: false
    },
    {
      type: 'input',
      name: 'baseDir',
      message: 'Папка профилей:',
      default: './profiles'
    }
  ]);

  const proxiesFile = await pickProxyFile();

  await runInitSessions({
    accounts: answers.selected,
    baseDir: path.resolve(answers.baseDir),
    proxiesFile,
    headless: answers.headless
  });

  console.log(
    chalk.green(
      '\nГотово! Проверить cookies можно в меню: Аккаунты → Проверить cookies.\n' +
      'Дальше: 🤖 Боты → Запустить бота.'
    )
  );
}

module.exports = { initSessionsMenu };
