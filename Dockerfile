# # Використовуємо офіційний легкий образ Bun
# FROM oven/bun:1-slim

# # Встановлюємо Xvfb та завантажуємо Chrome
# RUN apt-get update && apt-get install -y wget xvfb

# RUN wget -q -O google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
#     && apt-get install -y ./google-chrome.deb \
#     && rm google-chrome.deb \
#     && apt-get install -y fonts-liberation \
#     && rm -rf /var/lib/apt/lists/*

# ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
#     PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# WORKDIR /app

# # Копіюємо файли
# COPY package.json ./
# COPY . .

# # Встановлюємо залежності через bun (це буде в 10 разів швидше за npm)
# RUN bun install

# # Запускаємо через bun (без прапорців V8)
# CMD ["xvfb-run", "--auto-servernum", "--server-args='-screen 0 1080x600x16'", "bun", "run", "index.js"]

# Використовуємо полегшений образ Node.js для економії ОЗП
FROM node:20-slim

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

# CMD ["node", "index.js"]
CMD ["xvfb-run", "--auto-servernum", "--server-args='-screen 0 600x1080x16'", "node", "index.js"]