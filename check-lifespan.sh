#!/bin/bash

# Load environment variables
set -o allexport; source .env; set +o allexport

# Define variables
KEYCLOAK_URL="https://${REACT_APP_HOST_IP}:9090"
REALM="zti-realm"

# Get the stored admin token
TOKEN="$REACT_APP_ADMIN_TOKEN"

# Check if token exists
if [ -z "$TOKEN" ]; then
  echo "Error: No admin token found in .env. Run get-admin-token.sh first."
  exit 1
fi

# Decode token to get expiration time
PAYLOAD=$(echo "$TOKEN" | cut -d "." -f2 | base64 -d 2>/dev/null | jq -r .)

if [ -z "$PAYLOAD" ]; then
  echo "Error: Invalid token format."
  exit 1
fi

EXPIRATION_TIME=$(echo "$PAYLOAD" | jq -r .exp)

# Get current timestamp
CURRENT_TIME=$(date +%s)

# Calculate remaining time
REMAINING_TIME=$((EXPIRATION_TIME - CURRENT_TIME))

if [ "$REMAINING_TIME" -le 0 ]; then
  echo "Admin token has expired!"
  exit 1
else
  echo "Admin token is valid. Remaining time: $REMAINING_TIME seconds ($(date -d @$EXPIRATION_TIME))"
fi
