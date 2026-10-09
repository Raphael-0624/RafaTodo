FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY server.js ./
ENV DATA_DIR=/data HOST=0.0.0.0 PORT=3001
EXPOSE 3001
CMD ["npm","start"]
