FROM node:20-slim

WORKDIR /app

COPY package*.json ./
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm install --production

# Install curl for healthchecks 
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

COPY . .

# Making sure entrypoint script is executable
RUN chmod +x entrypoint.sh

ENTRYPOINT ["entrypoint.sh"]

# Default command to start app
CMD ["node", "main.js"]