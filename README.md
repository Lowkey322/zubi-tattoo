# ZUBI Tattoo: сайт + запис + Telegram-бот

## Що в папці
- `index.html` і `img/`: сам сайт (PL / UA / EN / RU).
- `api/`: сервер (Vercel Functions):
  - `book`: новий запис;
  - `booking`: клієнт переносить або скасовує запис;
  - `admin`: панель студії;
  - `upload`: фото й відео;
  - `telegram`: бот;
  - `cron`: щоденні нагадування о 18:00.
- `vercel.json`: щоденний запуск нагадувань.

## Запуск (один раз, приблизно 15 хвилин)

1. **GitHub.** Створи приватний репозиторій `zubi-tattoo`. Натисни «uploading an existing file» і перетягни туди весь вміст цієї папки разом із папками `api` і `img`. Потім натисни Commit.
2. **Vercel.** Відкрий Add New → Project → Import і вибери `zubi-tattoo`. Framework Preset: **Other**. Натисни Deploy.
3. **База даних.** У проєкті відкрий Storage → Create → **Upstash for Redis** (план Free) і натисни Connect to project. Потім там само створи **Blob**: Create → Blob → Connect. Blob потрібен для фото, які завантажуватимуть майстри.
4. **Бот.** У Telegram відкрий @BotFather і надішли `/newbot`. Дай боту ім'я, наприклад «ZUBI Tattoo», і юзернейм, наприклад `zubi_tattoo_bot`. Скопіюй токен.
5. **Секрети.** Відкрий Settings → Environment Variables і додай:
   - `TELEGRAM_BOT_TOKEN`: токен від BotFather;
   - `ADMIN_PASSWORD`: пароль до панелі студії, який ти придумаєш сам;
   - `CRON_SECRET`: будь-який довгий випадковий рядок.

   Не надсилай ці значення нікому в чат.
6. **Redeploy.** Відкрий Deployments, натисни «⋯» біля останнього деплою і вибери Redeploy.
7. **Домен.** Відкрий Settings → Domains → Add і введи `zubi.alexknew.com`. Потім у Cloudflare відкрий DNS → Add record:
   - тип **CNAME**;
   - ім'я `zubi`;
   - значення `cname.vercel-dns.com`;
   - Proxy: **DNS only** (сіра хмаринка).
8. **Підключення бота.** Відкрий `https://zubi.alexknew.com/#panel` і введи пароль. На вкладці «Rezerwacje» натисни «Podłącz bota». Потім на вкладці «Tatuatorzy» в кожного майстра є «Otwórz w Telegramie»: майстер відкриває це посилання на своєму телефоні й натискає Start.

## Як перевірити самому
1. Підключи себе як «Artysta 2»: відкрий його посилання у своєму Telegram і натисни Start.
2. З іншого браузера (або інкогніто) запишись на сайті до «Artysta 2». Тобі прийде картка з кнопками Підтвердити / Інший час / Написати / Скасувати.
3. На екрані «Rezerwacja wysłana» натисни «Powiadomienia w Telegramie». Так ти підключаєшся як клієнт і бачиш, що отримує клієнт.
4. Запишись до «Artysta 1», якого ще ніхто не підключив. Твій Telegram мовчить: кожен майстер отримує тільки свої записи.

## Як прибрати з alexknew.com
Видали домен у Vercel → Settings → Domains і запис `zubi` у Cloudflare. Головний `alexknew.com` при цьому не зачіпається.
