# Stage 1: Build the React application
FROM localhost:4000/node:18-alpine AS build

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
FROM localhost:4000/nginx:alpine

# Copy build output
COPY --from=build /app/build /usr/share/nginx/html

# Copy configs
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY ssl /etc/nginx/ssl

EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]
