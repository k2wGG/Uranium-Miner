// cli/helpers.cjs
/**
 * Хелперы для управления аккаунтами и их конфигами.
 * Умеют: перечислять профили, добавлять/удалять, проверять cookies,
 * редактировать config.json (boostIntervalMs, reloadSec, toggles).
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const inquirer = require('inquirer');
const chalk = require('chalk');

const profilesDir = path.resolve('profiles');

async function ensureProfilesDir() {
  await fsp.mkdir(profilesDir, { recursive: true });
}

async function listAccounts() {
  await ensureProfilesDir();
  const items = await fsp.readdir(profilesDir, { withFileTypes: true });
  return items.filter(i => i.isDirectory()).map(i => i.name);
}

async function addAccount() {
  const { name } = await inquirer.prompt([{
    type: 'input',
    name: 'name',
    message: 'Введите имя нового аккаунта (папка):'
  }]);

  const dir = path.join(profilesDir, name);
  if (fs.existsSync(dir)) {
    console.log(chalk.red(`⚠️ Папка уже существует: ${dir}`));
    return;
  }
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'config.json'), JSON.stringify({
    autoAC: true,
    autoSM: true,
    autoCB: true,
    autoRefine: true,
    boostIntervalMs: 300000,
    reloadSec: 900,
    showClientLogs: true
  }, null, 2));
  console.log(chalk.green(`✅ Аккаунт создан: ${name}`));
}

async function deleteAccount(accounts) {
  if (!accounts.length) {
    console.log(chalk.yellow('Нет аккаунтов для удаления'));
    return;
  }
  const { profile } = await inquirer.prompt([{
    type: 'list',
    name: 'profile',
    message: 'Выберите аккаунт для удаления:',
    choices: accounts
  }]);
  const dir = path.join(profilesDir, profile);
  await fsp.rm(dir, { recursive: true, force: true });
  console.log(chalk.red(`❌ Аккаунт удалён: ${profile}`));
}

async function checkCookies(accounts) {
  if (!accounts.length) {
    console.log(chalk.yellow('Нет аккаунтов'));
    return;
  }
  const { profile } = await inquirer.prompt([{
    type: 'list',
    name: 'profile',
    message: 'Выберите аккаунт:',
    choices: accounts
  }]);
  const file = path.join(profilesDir, profile, 'cookies.json');
  if (!fs.existsSync(file)) {
    console.log(chalk.red(`❌ cookies.json отсутствует для ${profile}`));
    return;
  }
  try {
    const cookies = JSON.parse(await fsp.readFile(file, 'utf8'));
    console.log(chalk.green(`✅ Найдено ${cookies.length} cookies для ${profile}`));
  } catch (e) {
    console.log(chalk.red(`Ошибка чтения cookies: ${e.message}`));
  }
}

async function editConfig(accounts) {
  if (!accounts.length) {
    console.log(chalk.yellow('Нет аккаунтов'));
    return;
  }
  const { profile } = await inquirer.prompt([{
    type: 'list',
    name: 'profile',
    message: 'Выберите аккаунт:',
    choices: accounts
  }]);
  const file = path.join(profilesDir, profile, 'config.json');
  let cfg = {};
  try {
    cfg = JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch { cfg = {}; }

  const answers = await inquirer.prompt([
    { type:'input', name:'boostIntervalMs', message:`boostIntervalMs (ms) [${cfg.boostIntervalMs||300000}]:` },
    { type:'input', name:'reloadSec', message:`reloadSec (sec) [${cfg.reloadSec||900}]:` },
    { type:'confirm', name:'autoAC', message:`autoAC (собирать Auto Collector?)`, default:cfg.autoAC??true },
    { type:'confirm', name:'autoSM', message:`autoSM (жать Shard Multiplier?)`, default:cfg.autoSM??true },
    { type:'confirm', name:'autoCB', message:`autoCB (жать Conveyor Booster?)`, default:cfg.autoCB??true },
    { type:'confirm', name:'autoRefine', message:`autoRefine (инициировать Refinery?)`, default:cfg.autoRefine??true },
    { type:'confirm', name:'showClientLogs', message:`showClientLogs (подробные логи?)`, default:cfg.showClientLogs??false }
  ]);

  const newCfg = {
    ...cfg,
    boostIntervalMs: Number(answers.boostIntervalMs||cfg.boostIntervalMs||300000),
    reloadSec: Number(answers.reloadSec||cfg.reloadSec||900),
    autoAC: answers.autoAC,
    autoSM: answers.autoSM,
    autoCB: answers.autoCB,
    autoRefine: answers.autoRefine,
    showClientLogs: answers.showClientLogs
  };

  await fsp.writeFile(file, JSON.stringify(newCfg, null, 2));
  console.log(chalk.green(`✅ Конфиг обновлён: ${file}`));
}

module.exports = { listAccounts, addAccount, deleteAccount, checkCookies, editConfig };
