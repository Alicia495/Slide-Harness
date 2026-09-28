FROM node:24-bookworm-slim

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends libreoffice-impress poppler-utils fonts-noto-cjk fontconfig ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@11.19.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

ENV NODE_ENV=production DATA_DIR=/app/data PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "pnpm db:migrate && pnpm start"]
