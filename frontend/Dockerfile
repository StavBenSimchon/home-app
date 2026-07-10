FROM node:24-alpine AS base
WORKDIR /app
# COPY package.json package-lock.json ./
COPY package.json ./
# RUN npm ci
RUN --mount=type=cache,target=/root/.npm npm i

FROM base AS dev
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM base AS build
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:alpine AS prod
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/templates/default.conf.template
EXPOSE 8080
