# Використовуємо офіційний образ Node.js 20
FROM node:25

# 1. Встановлюємо Xvfb (віртуальний екран) та wget
RUN apt-get update && apt-get install -y wget xvfb

# 2. Завантажуємо та встановлюємо ОФІЦІЙНИЙ Google Chrome
# Ця команда також автоматично встановить всі потрібні Linux-бібліотеки
RUN wget -q -O google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get install -y ./google-chrome.deb \
    && rm google-chrome.deb \
    && apt-get install -y fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# 3. Кажемо Puppeteer не качати свій непотрібний Chromium, а використовувати наш Chrome
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["xvfb-run", "--auto-servernum", "--server-args='-screen 0 1280x960x24'", "node", "--max-old-space-size=256", "index.js"]

