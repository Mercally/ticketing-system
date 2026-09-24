# syntax=docker/dockerfile:1
#
# Notification Service (NestJS + AWS SDK + OTel — consumes domain events, publishes to SNS,
# idempotent). Build from the REPO ROOT:
#   docker build -f infrastructure/docker/notification-service.Dockerfile -t ticketing/notification-service:local .
#
# Port: 5007 (docs/CONTRACTS.md §1). No database (see ARCHITECTURE.md §4) — no Prisma step needed,
# but the conditional is kept anyway for consistency/safety in case that changes.

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

EXPOSE 5007

ENTRYPOINT ["node", "dist/main.js"]
