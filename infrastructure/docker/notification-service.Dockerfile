# syntax=docker/dockerfile:1
#
# Notification Service (NestJS + AWS SDK + OTel — consumes domain events, publishes to SNS,
# idempotent). Build from the REPO ROOT:
#   docker build -f infrastructure/docker/notification-service.Dockerfile -t ticketing/notification-service:local .
#
# Port: 5007 (docs/CONTRACTS.md §1). Owns its own Postgres (the inbox pattern's
# ProcessedMessage table, ADR-0009-equivalent) via Prisma — `prisma` (the CLI, not just
# @prisma/client) is a runtime dependency here on purpose, since the entrypoint runs
# `prisma migrate deploy` before starting the app, same as the AppHost's start:dev script
# does for local Aspire dev.

FROM node:22-alpine AS build
WORKDIR /app

COPY services/notification-service/package*.json ./
RUN npm ci

COPY services/notification-service/ .

RUN mkdir -p prisma
RUN if [ -f prisma/schema.prisma ]; then npx prisma generate; fi

RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY services/notification-service/package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
# See auth-service.Dockerfile for why this is needed: @prisma/client's postinstall (triggered by
# `npm ci --omit=dev` above) runs before prisma/schema.prisma is copied into this stage, so it has
# nothing to generate against — copy the client already generated in the build stage instead.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

EXPOSE 5007

ENTRYPOINT ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
