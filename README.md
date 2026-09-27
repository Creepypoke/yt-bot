# Telegram Video Downloader

MVP Telegram-бота на GramIO, Bun и TypeScript. Бот принимает ссылки на
YouTube Shorts и Instagram Reels, скачивает видео внешними CLI-процессами и
отправляет его в Telegram.

Для YouTube используется `yt-dlp`, для Instagram — `gallery-dl`. Каждый запрос
обрабатывается в отдельном временном каталоге, который удаляется после отправки
или ошибки. Один пользователь не может запустить две загрузки одновременно.

## Настройки

Скопируйте пример окружения:

```bash
cp .env.example .env
```

Переменные:

| Переменная          | Обязательна | Описание                                                                  |
| ------------------- | ----------- | ------------------------------------------------------------------------- |
| `BOT_TOKEN`         | да          | Токен Telegram-бота от BotFather                                          |
| `LOG_LEVEL`         | нет         | Уровень логов: `debug`, `info`, `warn` или `error`; по умолчанию `info`   |
| `DOWNLOAD_DIR`      | нет         | Родительский каталог временных загрузок, по умолчанию `./downloads`       |
| `MAX_FILE_SIZE`     | нет         | Максимальный размер отправляемого файла в байтах, по умолчанию `50000000` |
| `COMPRESS_TO_480P`  | нет         | Сжимать все видео до ширины не более 480 px; по умолчанию `true`          |
| `INSTAGRAM_COOKIES` | нет         | Путь к cookies в Netscape-формате для Instagram                           |
| `INSTAGRAM_PROXY`   | нет         | URL прокси для `gallery-dl`, включая `socks5://` и `socks5h://`           |
| `YOUTUBE_COOKIES`   | нет         | Путь к cookies в Netscape-формате для YouTube                             |
| `YOUTUBE_PROXY`     | нет         | URL прокси для `yt-dlp`, включая `socks5://` и `socks5h://`               |

YouTube cookies могут повысить стабильность при `HTTP 403`, проверках аккаунта
или ограничениях по возрасту. Экспортируйте cookies в Netscape-формате из
отдельного YouTube-аккаунта и передайте путь через `YOUTUBE_COOKIES`. Один файл
может содержать cookies для обоих сервисов. Не добавляйте cookies и `.env` в
репозиторий.

Прокси настраивается независимо для каждого загрузчика и не используется для
подключения бота к Telegram API. Чтобы DNS-запросы также выполнялись через
прокси, используйте схему `socks5h://`:

```env
YOUTUBE_PROXY=socks5h://user:password@proxy.example.com:1080
INSTAGRAM_PROXY=socks5h://user:password@proxy.example.com:1080
```

Если логин или пароль содержит специальные символы, закодируйте их как URL
components. Не добавляйте адреса прокси с учетными данными в репозиторий.

## Локальный запуск

Требования: [Bun](https://bun.sh/), `yt-dlp`, `gallery-dl` и `ffmpeg`; все
четыре команды должны быть доступны через `PATH`.

```bash
bun install
bun run dev
```

Запуск без watch-режима:

```bash
bun run start
```

Проверки:

```bash
bun run typecheck
bun test
```

## Docker

Запуск через Docker Compose:

```bash
docker compose up -d --build
```

`docker-compose.yaml` монтирует локальный `cookies.txt` в контейнер только для
чтения и передает его обоим загрузчикам. Перед запуском `yt-dlp` бот копирует
YouTube cookies во временный каталог запроса: это позволяет `yt-dlp` обновлять
их, не пытаясь записать в read-only mount. После первой сборки файл можно
обновлять без пересборки: новые cookies будут прочитаны при следующем запросе.

Сборка образа:

```bash
docker build -t telegram-video-bot .
```

Запуск с постоянным каталогом загрузок:

```bash
docker run --rm --env-file .env \
  -v video-downloads:/app/downloads \
  telegram-video-bot
```

Если используются cookies, смонтируйте файл только для чтения и передайте
контейнерный путь нужному загрузчику:

```bash
docker run --rm --env-file .env \
  -e YOUTUBE_COOKIES=/run/secrets/cookies.txt \
  -v /absolute/path/cookies.txt:/run/secrets/cookies.txt:ro \
  -v video-downloads:/app/downloads \
  telegram-video-bot
```

Для одного файла с cookies YouTube и Instagram добавьте также
`-e INSTAGRAM_COOKIES=/run/secrets/cookies.txt`.

### Разработка в Docker

`Dockerfile.dev` запускает `bun --watch`. Соберите его один раз, затем
смонтируйте текущий каталог проекта: изменения в `src` будут автоматически
подхватываться без пересборки образа. Зависимости хранятся в именованном Docker
томе, поэтому локальный `node_modules` не используется контейнером.

```bash
docker build -f Dockerfile.dev -t telegram-video-bot-dev .

docker run --rm --env-file .env \
  -v "${PWD}:/app" \
  -v telegram-video-bot-node-modules:/app/node_modules \
  -v video-downloads:/app/downloads \
  telegram-video-bot-dev
```

В PowerShell используйте `$($PWD.Path)`:

```powershell
docker run --rm --env-file .env `
  -v "$($PWD.Path):/app" `
  -v telegram-video-bot-node-modules:/app/node_modules `
  -v video-downloads:/app/downloads `
  telegram-video-bot-dev
```

Контейнер запускается от непривилегированного пользователя `bun`. Если том
`video-downloads` был создан старой версией образа, его корневой каталог может
принадлежать `root`, из-за чего создание временного каталога завершится ошибкой
`EACCES`. Исправьте владельца уже существующего тома один раз:

```powershell
docker run --rm --user root `
  -v video-downloads:/app/downloads `
  telegram-video-bot-dev `
  chown -R bun:bun /app/downloads
```

Новые тома получают правильного владельца из образа автоматически.

## Структура

```text
src/
├── handlers/                   # Telegram-команды и обработка ссылок
├── downloaders/
│   ├── downloader.ts           # Интерфейс и типы ошибок
│   ├── youtube-downloader.ts   # yt-dlp
│   ├── instagram-downloader.ts # gallery-dl
│   └── cli.ts                  # Безопасный запуск CLI и поиск видео
├── url-parser.ts               # Определение источника по URL
├── config.ts                   # Проверенная конфигурация из .env
├── bot.ts                      # Сборка GramIO-бота
└── index.ts                    # Запуск и graceful shutdown
```

База данных, Redis и внешняя очередь не используются. Блокировка пользователя
хранится в памяти процесса и сбрасывается при перезапуске.
