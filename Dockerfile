FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg chromium ca-certificates fonts-noto-core fonts-noto-extra fonts-hosny-amiri && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package*.json ./
# The runtime entrypoints use tsx. Keep the locked dev toolchain in the
# runtime image; NODE_ENV is set only after npm ci so npm does not omit it.
RUN npm ci --include=dev
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
# Required by the Railway API service's pre-deploy schema migration.
COPY --from=build /app/database ./database
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe
ENV CHROME_BIN=/usr/bin/chromium
CMD ["npm", "run", "railway:start"]
