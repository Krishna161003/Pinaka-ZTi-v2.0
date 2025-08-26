#!/bin/sh
set -e

# Inject runtime environment variables into config.js
if [ -f /usr/share/nginx/html/config.template.js ]; then
  envsubst < /usr/share/nginx/html/config.template.js > /usr/share/nginx/html/config.js
  echo "Generated config.js with runtime values"
fi

# Start Nginx
exec nginx -g "daemon off;"

