# Stage 1: Build the React application
FROM node:18-alpine AS build

WORKDIR /app

# Copy only package files first (better caching)
COPY package*.json ./

# Install dependencies with cache
RUN --mount=type=cache,target=/root/.npm \
    npm ci --legacy-peer-deps

# Copy source code
COPY . .

# Build React app (disable eslint in CI)
RUN DISABLE_ESLINT_PLUGIN=true npm run build

# Stage 2: Nginx server
FROM nginx:alpine

# Copy build output
COPY --from=build /app/build /usr/share/nginx/html

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80 443

# Entrypoint handles env injection + starts nginx
ENTRYPOINT ["/entrypoint.sh"]

