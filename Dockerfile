
FROM node:25-slim

# Встановлюємо необхідні утиліти та віртуальний екран
RUN apt-get update && apt-get install -y wget xvfb

# Завантажуємо та встановлюємо офіційний Google Chrome (підтягне всі залежності)
RUN wget -q -O google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get install -y ./google-chrome.deb \
    && rm google-chrome.deb \
    && apt-get install -y fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Вказуємо Puppeteer використовувати встановлений Chrome
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

# Запускаємо з мінімальною роздільною здатністю (800x600) та дозволяємо ручне очищення пам'яті (--expose-gc)
CMD ["xvfb-run", "--auto-servernum", "--server-args='-screen 0 768x1080x16'", "node", "--expose-gc", "index.js"]

