# syntax=docker/dockerfile:1
#
# Frontend (React + TS + Vite). Build from the REPO ROOT:
#   docker build -f infrastructure/docker/frontend.Dockerfile -t ticketing/frontend:local .
#
# VITE_API_BASE_URL is baked in at BUILD time (Vite inlines import.meta.env.* at build, it cannot
# be swapped at container-start like a server-side app's env var). It must be a URL the BROWSER
# can reach — never a cluster-internal DNS name like http://gateway:5000, which only resolves
# inside the k8s pod network. The default below matches the Gateway's NodePort as configured in
# infrastructure/k8s/base/gateway/service.yaml (see infrastructure/k8s/README.md for the
# ingress-vs-NodePort trade-off and how to override this for kind/minikube/a real cluster):
#
#   docker build -f infrastructure/docker/frontend.Dockerfile \
#     --build-arg VITE_API_BASE_URL=http://<your-cluster-host>:30500 \
#     -t ticketing/frontend:local .

FROM node:22-alpine AS build
WORKDIR /app

COPY apps/frontend/package*.json ./
RUN npm ci

COPY apps/frontend/ .

ARG VITE_API_BASE_URL=http://localhost:30500
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build

FROM nginx:alpine AS runtime

COPY infrastructure/docker/frontend-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

ENTRYPOINT ["nginx", "-g", "daemon off;"]
