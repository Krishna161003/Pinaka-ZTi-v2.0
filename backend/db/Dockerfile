# Use the official Node.js image as the base image
FROM node:14

# Patch for Debian Buster EOL: use archived sources and disable validity check
RUN sed -i 's|http://deb.debian.org/debian|http://archive.debian.org/debian|g' /etc/apt/sources.list && \
    sed -i 's|http://security.debian.org|http://archive.debian.org|g' /etc/apt/sources.list && \
    echo 'Acquire::Check-Valid-Until "false";' > /etc/apt/apt.conf.d/99no-check-valid-until && \
    apt-get update && apt-get install -y netcat default-mysql-client jq

# Create and set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json, then install app dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application source code
COPY . .

# Copy the wait-for-it script and make it executable
COPY wait-for-it-script.sh ./
RUN chmod +x wait-for-it-script.sh

# Expose port 5000
EXPOSE 5000

# Run the wait-for-it script, then start the Node.js server
CMD ["./wait-for-it-script.sh", "mysql-db", "node", "server.js"]
