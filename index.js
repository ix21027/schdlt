const { connect } = require("puppeteer-real-browser");
const fs = require('fs');
const cron = require('node-cron');
const http = require('http');

// --- НАЛАШТУВАННЯ TELEGRAM ---
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const TG_CHAT_IDS = process.env.TELEGRAM_CHAT_ID 
    ? process.env.TELEGRAM_CHAT_ID.split(',').map(id => id.trim()).filter(id => id) 
    : [];

// --- ПАРСИНГ АКАУНТІВ ТА НАЗВ ---
const ACCOUNTS = [];
const ACCOUNT_NAMES = {};

if (process.env.ACCOUNT_NAMES_MAP) {
    const pairs = process.env.ACCOUNT_NAMES_MAP.split(',');
    pairs.forEach(pair => {
        const [id, name] = pair.split(':');
        if (id && id.trim()) {
            const cleanId = id.trim();
            const cleanName = name ? name.trim() : cleanId;
            ACCOUNTS.push(cleanId);
            ACCOUNT_NAMES[cleanId] = cleanName;
        }
    });
}

// --- ФУНКЦІЯ ВІДПРАВКИ В TELEGRAM ---
async function sendTelegramPhoto(caption, filePath) {
    if (!TG_TOKEN || TG_CHAT_IDS.length === 0) {
        console.log("⚠️ Telegram налаштування відсутні. Пропускаємо.");
        return;
    }

    try {
        const fileBuffer = fs.readFileSync(filePath);

        const sendPromises = TG_CHAT_IDS.map(async (chatId) => {
            try {
                const formData = new FormData();
                formData.append('chat_id', chatId);
                formData.append('caption', caption);
                formData.append('parse_mode', 'Markdown');
                
                const blob = new Blob([fileBuffer], { type: 'image/png' });
                formData.append('photo', blob, 'screenshot.png');

                const response = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendPhoto`, {
                    method: 'POST',
                    body: formData
                });

                const data = await response.json();
                if (data.ok) {
                    console.log(`✅ [Telegram] Фото відправлено для ID: ${chatId}`);
                } else {
                    console.error(`❌ [Telegram] Помилка для ID ${chatId}:`, data.description);
                }
            } catch (err) {
                console.error(`❌ [Telegram] Збій відправки для ID ${chatId}:`, err.message);
            }
        });

        await Promise.all(sendPromises);

    } catch (error) {
        console.error("❌ Загальна помилка при підготовці до відправки:", error.message);
    }
}

// --- ОСНОВНА ФУНКЦІЯ ПЕРЕВІРКИ ---
async function run() {
    console.log(`\n=== ЗАПУСК ПЕРЕВІРКИ: ${new Date().toLocaleString('uk-UA')} ===`);

    if (ACCOUNTS.length === 0) {
        console.error("❌ ПОМИЛКА: Змінна 'ACCOUNT_NAMES_MAP' пуста!");
        return; // Виходимо з функції, але не вбиваємо процес (бо це сервер)
    }

    let browser;
    let page;

    try {
        console.log("Відкриваємо браузер...");
        const connection = await connect({
            headless: false,
            turnstile: true,
            // Явний шлях до Chrome (для Docker)
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
            // Оптимізація пам'яті та процесора
            args: [
                "--no-sandbox", 
                "--disable-setuid-sandbox", 
                "--start-maximized",
                "--disable-dev-shm-usage", // Важливо для Docker!
                "--disable-gpu",
                "--no-zygote",
                "--disable-extensions",
                "--disable-accelerated-2d-canvas"
            ],
            connectOption: { defaultViewport: null }
        });
        browser = connection.browser;
        page = connection.page;

        // --- БЛОКУВАННЯ ЗАЙВОГО ТРАФІКУ ---
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const resourceType = request.resourceType();
            const url = request.url();

            // Блокуємо шрифти, відео, картинки (окрім капчі, якщо є) і аналітику
            if (
                resourceType === 'font' || 
                resourceType === 'media' || 
                url.includes('google-analytics') || 
                url.includes('doubleclick') ||
                url.includes('facebook')
            ) {
                request.abort();
            } else {
                request.continue();
            }
        });

    } catch (err) {
        console.error("❌ Помилка запуску браузера:", err);
        return;
    }

    try {
        const url = process.env.LINK || 'https://voe.com.ua/disconnection/detailed';
        
        const radioLabelSelector = "div.form-item.form__item.form__item--radio.form__item--search-type.form__item--radio--2 > label";
        const inputSelector = 'input[data-drupal-selector="edit-personal-account"]'; 
        const submitButtonSelector = '#edit-submit-detailed-search';
        const tableSelector = ".disconnection-detailed-table-container";

        for (const account of ACCOUNTS) {
            console.log(`\n--- Обробка рахунку: ${account} ---`);

            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
                await new Promise(r => setTimeout(r, 8000));

                await page.waitForSelector(radioLabelSelector, { timeout: 50000 });
                await page.click(radioLabelSelector);
                
                await page.waitForSelector(inputSelector, { timeout: 50000 });
                await page.click(inputSelector);
                
                await page.keyboard.down('Control');
                await page.keyboard.press('A');
                await page.keyboard.up('Control');
                await page.keyboard.press('Backspace');
                
                await page.type(inputSelector, account, { delay: 50 }); 

                try {
                    await page.waitForSelector(submitButtonSelector, { timeout: 3000 });
                    await page.click(submitButtonSelector);
                } catch (btnErr) {
                    console.log("Кнопку не знайдено, пробуємо Enter...");
                    await page.keyboard.press('Enter');
                }

                await page.waitForSelector(tableSelector, { timeout: 25000 });
                await new Promise(r => setTimeout(r, 2000));

                // === ОТРИМАННЯ ТА ОЧИЩЕННЯ HTML ===
                const rawHTML = await page.$eval(tableSelector, el => el.innerHTML);
                const currentContent = rawHTML.replace(/\s+/g, '');
                
                const stateFile = `state_${account}.txt`;
                let previousContent = "";

                if (fs.existsSync(stateFile)) {
                    previousContent = fs.readFileSync(stateFile, 'utf8').replace(/\s+/g, '');
                }

                if (currentContent !== previousContent) {
                    console.log(`⚠️ УВАГА: РОЗКЛАД ЗМІНИВСЯ для ${account}!`);
                    
                    fs.writeFileSync(stateFile, currentContent);
                    
                    const element = await page.$(tableSelector);
                    const filename = `schedule_${account}_CHANGED.png`;
                    await element.screenshot({ path: filename });
                    console.log(`📸 Скріншот збережено: ${filename}`);

                    const nameLabel = ACCOUNT_NAMES[account];
                   
                    await sendTelegramPhoto(nameLabel, filename);

                } else {
                    console.log(`✅ Розклад без змін для ${account}.`);
                }

                // Звільнення пам'яті сторінки після обробки рахунку
                await page.goto('about:blank');

            } catch (innerError) {
                console.error(`❌ Помилка для рахунку ${account}:`, innerError.message);
                if (page) await page.screenshot({ path: `error_${account}.png` }).catch(() => {});
            }
        }

    } catch (e) {
        console.error("КРИТИЧНА ПОМИЛКА ПІД ЧАС ОБРОБКИ:", e);
    } finally {
        // Завжди закриваємо браузер, щоб звільнити ОЗП повністю
        if (browser) {
            console.log("Закриваємо браузер і звільняємо пам'ять...");
            await browser.close();
        }
    }
}

// ==========================================
// ІНІЦІАЛІЗАЦІЯ СЕРВЕРА ТА ПЛАНУВАЛЬНИКА
// ==========================================

console.log("🚀 Стартуємо бота для Koyeb...");

// 1. Запускаємо перший раз відразу при старті контейнера
run();

// 2. Налаштовуємо розклад (UTC час).
// Працює о 00, 20, 40 хвилині з 05:00 до 19:00 (за Гринвічем)
cron.schedule('*/14 5-19 * * *', async () => {
    await run();
});

// 3. Піднімаємо веб-сервер (обов'язково для Koyeb)
// Koyeb пінгує цей порт, щоб знати, що ваш бот не "завис"
const PORT = process.env.PORT || 8000;
http.createServer((req, res) => {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('Vinnitsia Light Schedule Bot is Running OK!\n');
}).listen(PORT, () => {
    console.log(`✅ Внутрішній сервер слухає порт ${PORT}`);
});
