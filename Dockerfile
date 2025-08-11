FROM node:20-slim

WORKDIR /app

COPY package*.json ./
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm install --production

# Install curl for healthchecks 
RUN npm ci --only=production \
    && apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY . .
COPY entrypoint.sh /app/

# Making sure entrypoint script is executable
RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]

# Default command to start app
CMD ["node", "main.js"]