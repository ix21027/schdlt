const { connect } = require("puppeteer-real-browser");
const fs = require('fs');
const cron = require('node-cron');

// --- НАЛАШТУВАННЯ TELEGRAM ---
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Отримуємо ID чатів (масив)
const TG_CHAT_IDS = process.env.TELEGRAM_CHAT_ID 
    ? process.env.TELEGRAM_CHAT_ID.split(',').map(id => id.trim()).filter(id => id) 
    : [];

// --- ПАРСИНГ НАЗВ АКАУНТІВ З ENV ---
// Формат рядка: "ID:NAME,ID:NAME"
const ACCOUNT_NAMES = {};
if (process.env.ACCOUNT_NAMES_MAP) {
    const pairs = process.env.ACCOUNT_NAMES_MAP.split(',');
    pairs.forEach(pair => {
        const [id, name] = pair.split(':');
        if (id && name) {
            ACCOUNT_NAMES[Number(id.trim())] = name.trim();
        }
    });
}
const ACCOUNTS = Object.keys(ACCOUNT_NAMES);
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

async function run() {
    console.log("=== ЗАПУСК СКРИПТА (FINAL) ===");

    if (ACCOUNTS.length === 0) {
        console.error("❌ ПОМИЛКА: Не вказано жодного рахунку в змінній 'IDS'!");
        process.exit(1);
    }

    const { browser, page } = await connect({
        headless: false,
        turnstile: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--start-maximized"],
        connectOption: { defaultViewport: null }
    });

    try {
        const url = process.env.LINK;
        
        const radioLabelSelector = "div.form-item.form__item.form__item--radio.form__item--search-type.form__item--radio--2 > label";
        const inputSelector = 'input[data-drupal-selector="edit-personal-account"]'; 
        const tableSelector = ".disconnection-detailed-table-container";

        for (const account of ACCOUNTS) {
            console.log(`\n--- Обробка рахунку: ${account} ---`);

            try {
                // 1. Навігація (всередині циклу для надійності)
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
                await new Promise(r => setTimeout(r, 15000));

                // 2. Вибір типу пошуку
                await page.waitForSelector(radioLabelSelector, { timeout: 10000 });
                await page.click(radioLabelSelector);
                
                // 3. Введення рахунку
                await page.waitForSelector(inputSelector, { timeout: 10000 });
                await page.click(inputSelector);
                
                await page.keyboard.down('Control');
                await page.keyboard.press('A');
                await page.keyboard.up('Control');
                await page.keyboard.press('Backspace');
                
                await page.type(inputSelector, account); 
 
                await new Promise(r => setTimeout(r, 2000));
                // 4. Пошук
                await page.keyboard.press('Enter');

                // 5. Очікування таблиці
                await page.waitForSelector(tableSelector, { timeout: 20000 });
                await new Promise(r => setTimeout(r, 5000));

                await page.evaluate(() => {
                // Цей код виконується всередині браузера
                    const selector = "body > div.dialog-off-canvas-main-canvas > div > header > div.site-header-middle > button";
                    const element = document.querySelector(selector);
    
                    if (element) {
                        element.remove();
                    }
                });
            
                // === ПЕРЕВІРКА ЗМІН ===
                const rawHTML = await page.$eval(tableSelector, el => el.innerHTML);
                
                // 2. Видаляємо всі пробіли, переноси рядків (\n), табуляцію (\t)
                // Це перетворить "<div>  text  </div>" на "<div>text</div>"
                const currentText = rawHTML.replace(/\s+/g, '');
                
                
                const stateFile = `state_${account}.txt`;
                let previousText = "";

                if (fs.existsSync(stateFile)) {
                    previousText = fs.readFileSync(stateFile, 'utf8');
                }

                if (currentText !== previousText) {
                    console.log(`⚠️ УВАГА: РОЗКЛАД ЗМІНИВСЯ для ${account}!`);
                    
                    fs.writeFileSync(stateFile, currentText);
                    
                    const element = await page.$(tableSelector);
                    const filename = `schedule_${account}_CHANGED.png`;
                    await element.screenshot({ path: filename });
                    console.log(`📸 Скріншот збережено: ${filename}`);

                    // Формування підпису
                    const nameLabel = ACCOUNT_NAMES[account] ? ACCOUNT_NAMES[account] : account;
                   
                    await sendTelegramPhoto(nameLabel, filename);

                } else {
                    console.log(`✅ Розклад без змін для ${account}.`);
                }

            } catch (innerError) {
                console.error(`❌ Помилка для рахунку ${account}:`, innerError.message);
                await page.screenshot({ path: `error_${account}.png` });
            }
        }

    } catch (e) {
        console.error("КРИТИЧНА ПОМИЛКА:", e);
        process.exit(1);
    } finally {
        await browser.close();
    }
}

console.log("🚀");
run();

cron.schedule('*/14 5-19 * * *', async () => {
    console.log("⏰");
    await run();
});

const http = require('http');
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot is running!');
}).listen(process.env.PORT || 8000);
