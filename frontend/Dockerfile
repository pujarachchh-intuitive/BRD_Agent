# Next.js frontend. Build from the frontend/ folder:
#   az acr build --registry <acr-name> --image brd-frontend:v1 --build-arg BACKEND_URL=https://<backend-fqdn> .
# BACKEND_URL must be passed at build time: next.config.ts rewrites /api/* to it, and Next.js
# bakes rewrites into the build output.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Satoshi web fonts for the document preview, print view and diagrams (see globals.css). Downloaded
# from Fontshare here rather than committed: the font licence forbids redistributing it from our
# public repo. Same files as `python -m webapp.branding.fonts` puts in public/fonts for local dev.
RUN apk add --no-cache unzip \
    && wget -qO /tmp/satoshi.zip https://api.fontshare.com/v2/fonts/download/satoshi \
    && unzip -q /tmp/satoshi.zip -d /tmp/satoshi \
    && mkdir -p public/fonts \
    && for style in Regular Italic Medium Bold BoldItalic; do \
        cp /tmp/satoshi/*/Fonts/WEB/fonts/Satoshi-$style.woff2 public/fonts/ || exit 1; \
    done \
    && rm -rf /tmp/satoshi /tmp/satoshi.zip
ARG BACKEND_URL
ENV BACKEND_URL=$BACKEND_URL \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Runtime image carries only the standalone server output (see output: "standalone" in
# next.config.ts), not the full node_modules — a fraction of the size of the build stage.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
