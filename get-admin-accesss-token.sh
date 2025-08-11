#!/bin/bash

# Load environment variables from the .env file
set -o allexport; source .env; set +o allexport

# Define constants
CLIENT_ID="zti-client"
CLIENT_SECRET="$REACT_APP_CLIENT_SECRET"  # Fetch client secret from .env
KEYCLOAK_URL="https://${REACT_APP_HOST_IP}:9090/realms/zti-realm/protocol/openid-connect/token"

# Fetch the token
response=$(curl -k -s --request POST \
  --url "$KEYCLOAK_URL" \
  --header 'Content-Type: application/x-www-form-urlencoded' \
  --data "grant_type=client_credentials&client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET")

echo "Raw response: $response"

TOKEN=$(echo "$response" | jq -r .access_token)

# Check if the token was fetched successfully
if [ -z "$TOKEN" ]; then
  echo "Error: Failed to fetch the token."
  exit 1
fi

echo "Successfully fetched the token: $TOKEN"

# Define .env file path
ENV_FILE="./.env"

# Check if the token already exists in the .env file
if grep -q "REACT_APP_ADMIN_TOKEN" "$ENV_FILE"; then
  # Replace the existing token if found
  sed -i "s/^REACT_APP_ADMIN_TOKEN=.*/REACT_APP_ADMIN_TOKEN=$TOKEN/" "$ENV_FILE"
  echo "Token updated in .env file."
else
  # Append the token if not found
  echo "REACT_APP_ADMIN_TOKEN=$TOKEN" >> "$ENV_FILE"
  echo "Token appended to .env file."
fi
