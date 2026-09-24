# syntax=docker/dockerfile:1
#
# Auth Service (NestJS + Prisma + Passport + JWT). Build from the REPO ROOT:
#   docker build -f infrastructure/docker/auth-service.Dockerfile -t ticketing/auth-service:local .
#
# Port: 5001 (docs/CONTRACTS.md §1).
#
# NOTE: as of writing, services/auth-service has no prisma/schema.prisma yet (it's mid-build by
# another parallel workstream — see ARCHITECTURE.md §4 / the prompt's Auth Service requirements).
# `npx prisma generate` below is conditional on that file existing so this Dockerfile is buildable
# both today (schema absent) and once Prisma lands, with no edits required here. `npm ci` requires
# a package-lock.json to be committed alongside package.json — also expected to land with that work.

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

EXPOSE 5001

ENTRYPOINT ["node", "dist/main.js"]
