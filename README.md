# Uranium Miner — Node CLI Bot

Интерактивный CLI-бот для **geturanium.io**: менеджер аккаунтов и прокси, инициализация сессий, автоклики бустов на вкладке **Mine**, периодический запуск **INITIATE URANIUM REFINING** (раз в 8 часов), мультизапуск нескольких ботов (в т.ч. headless).

> ⚠️ Для исследовательских целей. Используйте на свой страх и риск и соблюдайте правила сервиса.

---

## Требования

* **Node.js 18–22**
* Windows / macOS / Linux
* Chrome не обязателен (Puppeteer идёт со своим Chromium)

Установка зависимостей:

```bash
npm i inquirer@8 chalk@4 figlet puppeteer puppeteer-extra puppeteer-extra-plugin-stealth
```

---

## Установка

```bash
git clone https://github.com/k2wGG/Uranium-Miner.git
cd Uranium-Miner
npm i
```

---

## Самый быстрый старт (через меню)

Запустите меню:

```bash
node cli/menu.cjs
```

### Как пользоваться меню

* Стрелки ↑/↓ — выбор пункта
* **Enter** — подтвердить
* **Space** — отметить/снять галочку в списке (checkbox)
* **Esc / Ctrl+C** — выход/отмена

### Шаг 1. Добавьте аккаунты

**Аккаунты → Добавить аккаунт** → введите имя (например, `main1`).
CLI создаст `profiles/main1/` и всё нужное внутри (папки руками делать не нужно).

### Шаг 2. Добавьте прокси

**Прокси → Добавить прокси** → вставьте список, **каждая прокси с новой строки**.
Поддерживаются форматы:

```
http://user:pass@host:port
user:pass@host:port
```

Файл `data/proxies.txt` создастся автоматически.

### Шаг 3. Инициализируйте сессии (логин)

**Инициализировать сессии (логин)** → отметьте нужные профили → откроется браузер.
Войдите в аккаунт на сайте. По завершении скрипт сохранит cookies в `profiles/<имя>/cookies.json`.

> Совет: первый вход лучше делать **не headless**, чтобы руками залогиниться.

### Шаг 4. Запустите ботов

**Боты → Запустить все аккаунты** →

* выберите профили,
* ответьте «Запуск без окон (headless)?» — Yes/No,
* задайте **параллельность** (сколько профилей стартовать одновременно).

Логи каждого процесса будут печататься с префиксом `[имя_профиля]`.

### Как остановить

* В меню **Боты** есть остановка отдельных процессов.
* **Выход** из главного меню корректно завершит все дочерние процессы.
* В крайнем случае — `Ctrl+C` в терминале.

---

## Что делает бот

* **Mine/Boosters**: устойчиво находит и жмёт
  **Auto Collector**, **Shard Multiplier**, **Conveyor Booster**
  c физическим кликом и **жёстким подтверждением** (disabled/remaining/таймер).
* **/refinery**: раз в `refineHours` часов (по умолчанию 8) переходит на страницу,
  нажимает **INITIATE URANIUM REFINING**, ждёт состояние/кулдаун и возвращается на главную.
* **Перезагрузка**: мягкий reload и плановая жёсткая перезагрузка при зависаниях.
* **Прокси**: поддержка auth-прокси, ротация на перезагрузке (если включена).
* **Headless** и **обычный** режим, опционально системный Chrome.

---

## Альтернативный запуск (без меню)

Один профиль:

```bash
node bin/start.cjs \
  --profile ./profiles/main1 \
  --headless=true \
  --proxy "http://user:pass@host:port" \
  --reloadSec 900 \
  --acceptLanguage "en-US,en;q=0.9" \
  --timezone "Europe/Berlin"
```

Те же параметры можно через ENV:

```bash
HEADLESS=true node bin/start.cjs --profile ./profiles/main1
```

Ключи `bin/start.cjs`:

| Параметр                | Тип    | По умолчанию                 | Описание                                 |
| ----------------------- | ------ | ---------------------------- | ---------------------------------------- |
| `--profile`             | string | `./run/default`              | Папка профиля                            |
| `--proxy`               | string | `''`                         | Прокси (`http(s)://user:pass@host:port`) |
| `--headless`            | bool   | из `HEADLESS` env            | Запуск без окон                          |
| `--chromePath`          | string | `''`                         | Путь к системному Chrome                 |
| `--startUrl`            | string | `https://www.geturanium.io/` | Стартовая страница                       |
| `--reloadSec`           | number | `900`                        | Период автоперезагрузки (сек)            |
| `--acceptLanguage`      | string | `en-US,en;q=0.9`             | Заголовок языка                          |
| `--timezone`            | string | `Europe/Berlin`              | Эмулируемый часовой пояс                 |
| `--showClientLogs`      | bool   | `false`                      | Подробные логи со стороны страницы       |
| `--rotateProxyOnReload` | bool   | `false`                      | Ротация прокси на перезагрузке           |

---

## Где что лежит

```
cli/menu.cjs               # интерактивное меню
bin/start.cjs              # запуск одного бота (использует и меню)
data/proxies.txt           # список прокси (одна строка — одна прокси)
profiles/
  <name>/
    cookies.json           # сохраняется после логина
    config.json            # настройки профиля (см. ниже)
    stats.json             # статистика и lastClick (редактировать не нужно)
src/
  core/actions.cjs         # клики бустов (жёсткое подтверждение)
  core/refinery.cjs        # логика 8-часового Refinery
  core/puppeteer.cjs       # запуск/патчи браузера, stealth
  core/navigation.cjs      # переходы и ожидания UI
  core/reload.cjs          # плановые/жёсткие перезагрузки
  config/def.cjs           # merge config+stats
  utils/logger.cjs         # единый логгер
```

### Конфиг профиля (`profiles/<имя>/config.json`)

```json
{
  "autoAC": true,
  "autoSM": true,
  "autoCB": true,
  "autoRefine": true,

  "boostIntervalMs": 300000,
  "boostJitterMs": 15000,

  "refineHours": 8,
  "refineMinMinutes": 30,

  "keepAlive": true,
  "autoReload": true,
  "reloadMinutes": 50,

  "showClientLogs": false,

  "proxies": [],
  "proxyRotation": "perLaunch",
  "rotateProxyOnReload": true
}
```

> `stats.json` хранит `clickCount` и `lastClick` (включая `autoRefine`). Менять вручную не нужно.

---

## Советы

* **Headless** удобно включать прямо в меню при запуске всех аккаунтов.
* Хотите **системный Chrome** — передайте `--chromePath "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"`.
* **Параллельность**: если прокси/ПК слабые — ставьте 1–2, иначе страница может дольше грузиться.
* **Бэкап**: для переноса профиля достаточно скопировать папку `profiles/<имя>/`.

---

## Троблшутинг

* `inquirer.prompt is not a function` → `npm i inquirer@8`
* «Список прокси пуст» → проверьте `data/proxies.txt` и формат (одна строка — одна прокси).
* Окна всё равно открываются → запускали с `--headless=true` или `HEADLESS=true`?
* `Protocol error (Page.navigate)` → проверьте `--startUrl` (должен быть `https://www.geturanium.io/`).
* Медленно рисуется **Boosters** → уменьшите параллельность, проверьте прокси, дайте странице 20–40 сек на прогрев (бот делает мягкий reload и «подталкивает» рендер).

---

## Лицензия

MIT — см. `LICENSE`.
