FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54

WORKDIR /app
COPY public/ public/
COPY server/ server/
COPY drizzle/ drizzle/
COPY scripts/dev.mjs scripts/dev.mjs

USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATABASE_PATH=/data/rusal.sqlite
EXPOSE 3000
CMD ["node", "scripts/dev.mjs"]
