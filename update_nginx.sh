#!/bin/bash
set -x  # Enables debug output

# Load environment variables from the .env file
export $(grep -v '^#' .env | xargs)

# Create the Nginx configuration in the same directory as the script
envsubst '$REACT_APP_HOST_IP' < nginx.conf.template > nginx.conf
envsubst '$REACT_APP_HOST_IP' < realm.json.template > realm.json

echo "Nginx configuration updated with REACT_APP_HOST_IP: $REACT_APP_HOST_IP"
echo "realm.json updated with REACT_APP_HOST_IP: $REACT_APP_HOST_IP"

