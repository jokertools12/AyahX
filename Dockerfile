FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends chromium ffmpeg ca-certificates fonts-noto-core fonts-noto-extra && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package*.json ./
RUN npm ci
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
# Required by the Railway API service's pre-deploy schema migration.
COPY --from=build /app/database ./database
ENV CHROME_BIN=/usr/bin/chromium
CMD ["npm", "run", "server"]
