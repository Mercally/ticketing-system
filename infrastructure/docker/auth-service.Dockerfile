# syntax=docker/dockerfile:1
#
# Auth Service (NestJS + Prisma + Passport + JWT). Build from the REPO ROOT:
#   docker build -f infrastructure/docker/auth-service.Dockerfile -t ticketing/auth-service:local .
#
# Port: 5001 (docs/CONTRACTS.md §1).
#
# `npx prisma generate` is conditional on prisma/schema.prisma existing so this Dockerfile stays
# buildable even without a schema. `prisma` (the CLI, not just @prisma/client) is a runtime
# dependency here on purpose — the entrypoint runs `prisma migrate deploy` before starting the
# app, same as the AppHost's start:dev script does for local Aspire dev.

FROM node:22-alpine AS build
WORKDIR /app

COPY services/auth-service/package*.json ./
RUN npm ci

COPY services/auth-service/ .

# mkdir first so the runtime stage's `COPY --from=build /app/prisma ./prisma` never fails,
# whether or not a Prisma schema exists yet.
RUN mkdir -p prisma
RUN if [ -f prisma/schema.prisma ]; then npx prisma generate; fi

RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY services/auth-service/package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
# @prisma/client's postinstall (triggered above by `npm ci --omit=dev`) runs before
# prisma/schema.prisma is even copied into this stage, so it has nothing to generate against —
# copy the client already generated in the build stage (against the same alpine/musl base image)
# instead of relying on that postinstall step.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

EXPOSE 5001

ENTRYPOINT ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
