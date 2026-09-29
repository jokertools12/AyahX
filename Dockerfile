FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg chromium ca-certificates fonts-noto-core fonts-noto-extra fonts-hosny-amiri fontconfig libass9 libharfbuzz0b && rm -rf /var/lib/apt/lists/*
COPY scripts/verify-render-runtime.sh /usr/local/bin/verify-render-runtime
# Windows checkouts can store this script with CRLF; normalize it before Linux executes it.
RUN sed -i 's/\r$//' /usr/local/bin/verify-render-runtime \
    && chmod +x /usr/local/bin/verify-render-runtime \
    && /usr/local/bin/verify-render-runtime
COPY --from=build /app/package*.json ./
# The runtime entrypoints use tsx. Keep the locked dev toolchain in the
# runtime image; NODE_ENV is set only after npm ci so npm does not omit it.
RUN npm ci --include=dev
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
# The API runtime imports the canonical timing-map contract for verified
# alignment maps. Keep the source module available alongside the tsx server
# entrypoint (the frontend build output does not contain this server import).
COPY --from=build /app/src ./src
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
# Required by the Railway API service's pre-deploy schema migration.
COPY --from=build /app/database ./database
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe
ENV CHROME_BIN=/usr/bin/chromium
CMD ["node", "node_modules/tsx/dist/cli.mjs", "server/index.ts"]
