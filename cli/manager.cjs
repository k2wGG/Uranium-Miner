// cli/manager.cjs
/**
 * Процесс-менеджер ботов.
 * Функции:
 *   - startBot()               — запуск одного профиля
 *   - startAllBotsPrompt()     — запуск выбранных профилей пачкой (headless + concurrency)
 *   - stopBot(), restartBot(), listRunning(), stopAllBots()
 *
 * ВАЖНО: при spawn передаём сначала ПУТЬ К СКРИПТУ, затем аргументы скрипта.
 * Иначе Node подумает, что --profile — это флаг Node и выдаст "bad option: --profile".
 *
 * Экспортируем алиасы: startBotsBatch, startMany → startAllBotsPrompt (совместимость со старым меню).
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const inquirer = require('inquirer');
const chalk = require('chalk');

const PROFILES_DIR = path.resolve(process.cwd(), 'profiles');

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

/**
 * Запуск дочернего процесса бота.
 * Передаём:
 *   node <script> --profile <path> --headless <true|false>
 * и дублируем флаг через ENV HEADLESS=1/0 — для полной совместимости.
 */
function spawnBot({ profile, headless = false, extraEnv = {} }) {
  const nodeBin = process.execPath;
  const script = path.resolve(__dirname, '..', 'bin', 'start.cjs');

  // ВАЖНО: сначала путь к скрипту, потом аргументы скрипта!
  const args = [
    script,
    '--profile', path.resolve(PROFILES_DIR, profile),
    '--headless', String(!!headless)
  ];

  const env = { ...process.env, HEADLESS: headless ? '1' : '0', ...extraEnv };

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
  spawnBot({ profile: ans.profile, headless: ans.headless });
}

async function startAllBotsPrompt() {
  const profiles = await listProfiles();
  if (!profiles.length) {
    console.log(chalk.yellow('Нет профилей в ./profiles'));
    return;
  }

  const ans = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'accs',
      message: 'Выберите аккаунты:',
      choices: profiles.map(p => ({ name: p, value: p })),
      loop: false,
      pageSize: Math.min(profiles.length, 20),
      validate: v => v.length ? true : 'Нужно выбрать хотя бы один профиль'
    },
    { type: 'confirm', name: 'headless', message: 'Запуск без окон (headless)?', default: true },
    { type: 'number', name: 'concurrency', message: 'Сколько одновременно запускать?', default: 3, filter: v => Math.max(1, Number(v)||1) }
  ]);

  const queue = ans.accs.filter(p => !running.has(p));
  if (!queue.length) {
    console.log(chalk.yellow('Все выбранные уже запущены или пусто.'));
    return;
  }

  let active = 0, idx = 0;
  await new Promise((resolve) => {
    const tryNext = () => {
      while (active < ans.concurrency && idx < queue.length) {
        const profile = queue[idx++];
        active++;
        console.log(chalk.cyan(`Запуск ${profile} (headless=${ans.headless})…`));
        const ch = spawnBot({ profile, headless: ans.headless });
        ch.on('exit', () => { active--; tryNext(); });
      }
      if (idx >= queue.length && active === 0) resolve();
    };
    tryNext();
  });
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
  spawnBot({ profile: who, headless });
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
  startAllBotsPrompt,
  // совместимость со старыми именами:
  startBotsBatch: startAllBotsPrompt,
  startMany: startAllBotsPrompt,
  stopBot,
  restartBot,
  listRunning,
  stopAllBots
};
