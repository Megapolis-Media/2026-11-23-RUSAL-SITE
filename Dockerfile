FROM node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530

WORKDIR /app
COPY public/ public/
COPY server/ server/
COPY drizzle/ drizzle/
COPY scripts/dev.mjs scripts/dev.mjs

USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATABASE_PATH=/data/rusal.sqlite
EXPOSE 3000
CMD ["node", "scripts/dev.mjs"]
