# Next.js frontend. Build from the frontend/ folder:
#   az acr build --registry <acr-name> --image brd-frontend:v1 --build-arg BACKEND_URL=https://<backend-fqdn> .
# BACKEND_URL must be passed at build time: next.config.ts rewrites /api/* to it, and Next.js
# bakes rewrites into the build output.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG BACKEND_URL
ENV BACKEND_URL=$BACKEND_URL
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ARG BACKEND_URL
ENV BACKEND_URL=$BACKEND_URL
COPY --from=build /app ./
EXPOSE 3000
CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
