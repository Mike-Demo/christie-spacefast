FROM oven/bun:1.3-alpine

WORKDIR /app

# Harper ships its own WebAssembly model; no native build steps are required.
COPY package.json ./
RUN bun add harper.js@2.10.0

COPY services/harper-service/server.ts ./server.ts

ENV PORT=8787
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD wget -qO- http://127.0.0.1:8787/health || exit 1

RUN chown -R 1000:1000 /app
USER 1000

CMD ["bun", "run", "server.ts"]
