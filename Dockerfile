FROM oven/bun:1.3.2-debian

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg nodejs python3 python3-venv \
    && python3 -m venv /opt/downloaders \
    && /opt/downloaders/bin/pip install --no-cache-dir yt-dlp gallery-dl \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/opt/downloaders/bin:${PATH}" \
    NODE_ENV=production \
    DOWNLOAD_DIR=/app/downloads

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json ./
COPY src ./src

# A newly created named volume is initialized with the ownership of the mount
# point from the image. The application runs as `bun`, so it must own the
# directory in order to create per-request temporary directories in it.
RUN install -d -o bun -g bun /app/downloads

USER bun

CMD ["bun", "run", "start"]
