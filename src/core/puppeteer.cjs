// src/core/puppeteer.cjs
/**
 * Обёртка над puppeteer-extra + stealth.
 * Запускает браузер с нужными параметрами, прокси, user-agent и профилем.
 */

const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const randomUA = require('random-useragent');
const { normalizeProxy } = require('../utils/proxy.cjs');
const { log } = require('../utils/logger.cjs');

puppeteer.use(StealthPlugin());

let _browser = null;
let _page    = null;

async function launch(config) {
  if (_browser) {
    try { await _browser.close(); } catch {}
    _browser = null;
    _page = null;
  }

  const PROFILE_DIR = path.join(config.profile, 'browser_profile');
  const finalHeadlessMode = config.headless ? 'new' : false;

  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--window-size=1920,1080',
    '--disable-blink-features=AutomationControlled',
    '--disable-notifications',
    '--disable-popup-blocking',
    '--ignore-certificate-errors'
  ];

  const parsedProxy = normalizeProxy(config.proxy);
  if (parsedProxy) {
    launchArgs.push(`--proxy-server=${parsedProxy.serverArg}`);
    log(`🌐 Proxy: ${parsedProxy.serverArg} ${parsedProxy.auth ? '(with auth)' : ''}`, 'info');
  } else if (config.proxy) {
    log(`⚠️ Некорректная строка прокси: "${config.proxy}"`, 'warn');
  }

  _browser = await puppeteer.launch({
    headless: finalHeadlessMode,
    slowMo: config.slowMo,
    userDataDir: PROFILE_DIR,
    executablePath: (config.useSystemChrome && (config.chromePath || process.env.CHROME_PATH)) || undefined,
    args: launchArgs
  });

  const pages = await _browser.pages();
  _page = pages[0] || await _browser.newPage();

  // аутентификация прокси
  if (parsedProxy && parsedProxy.auth) {
    try { await _page.authenticate(parsedProxy.auth); }
    catch (e) { log(`proxy-auth: ${e.message}`,'warn'); }
  }

  // UA/Headers/TZ
  const ua = randomUA.getRandom() || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36';
  await _page.setUserAgent(ua);
  if (config.acceptLanguage) await _page.setExtraHTTPHeaders({ 'Accept-Language': config.acceptLanguage });
  if (config.timezone) { try { await _page.emulateTimezone(config.timezone); } catch {} }

  await _page.goto(config.startUrl, { waitUntil: 'networkidle2', timeout: 60000 });

  return { browser: _browser, page: _page };
}

function bindPageSafety(page) {
  page.on('dialog', async d => { try { await d.dismiss(); } catch {} });
  page.on('error', e => log(`Page error: ${e.message}`, 'error'));
  page.on('pageerror', e => log(`Page JS error: ${e.message}`, 'error'));
}

async function closeBrowser() {
  if (_browser) { try { await _browser.close(); } catch {} }
  _browser = null;
  _page = null;
}

module.exports = { launch, closeBrowser, bindPageSafety };
