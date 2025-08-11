# Stage 1: Build the React application
FROM node:18 AS build

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Clean npm cache and install dependencies, adding the flag to disable ESLint if necessary
RUN npm cache clean --force && npm install --legacy-peer-deps

# Copy the rest of the application code
COPY . .

# Disable ESLint in the build process to avoid linting issues
RUN DISABLE_ESLINT_PLUGIN=true npm run build

# Stage 2: Serve the React app using Nginx
FROM nginx:alpine

# Copy the build files from the previous stage
COPY --from=build /app/build /usr/share/nginx/html

# Copy custom Nginx configuration (make sure the `nginx.conf` file is present in the context)
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY ssl /etc/nginx/ssl
# Expose port 80 (default for Nginx)
EXPOSE  80 443

# Start Nginx server
CMD ["nginx", "-g", "daemon off;"]

