#!/bin/bash

# Step 1: Set up variables
KEYCLOAK_ADMIN="admin"
KEYCLOAK_ADMIN_PASSWORD="admin"
REALM="zti-realm"
ENV_FILE=".env"

# Prompt user for username, user ID, and new password
read -p "Enter the username: " USERNAME
read -p "Enter the user ID: " INPUT_USER_ID
read -sp "Enter the new password: " NEW_PASSWORD
echo

# Extract the IP address from the .env file
REACT_APP_HOST_IP=$(grep 'REACT_APP_HOST_IP' $ENV_FILE | cut -d '=' -f2)
KEYCLOAK_HOST="${REACT_APP_HOST_IP}:9090"

# Step 2: Get the Keycloak access token
RAW_RESPONSE=$(curl -k -s -X POST "https://${KEYCLOAK_HOST}/realms/master/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=$KEYCLOAK_ADMIN" \
    -d "password=$KEYCLOAK_ADMIN_PASSWORD" \
    -d "grant_type=password" \
    -d "client_id=admin-cli")

# Extract the admin access token
ACCESS_TOKEN=$(echo $RAW_RESPONSE | jq -r .access_token)

# Check if ACCESS_TOKEN is retrieved
if [[ -z "$ACCESS_TOKEN" || "$ACCESS_TOKEN" == "null" ]]; then
    echo "Failed to retrieve access token. Exiting."
    exit 1
fi

# Step 3: Get the user ID based on the username
USER_ID=$(curl -k -s -X GET "https://${KEYCLOAK_HOST}/admin/realms/$REALM/users?username=$USERNAME" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    | jq -r '.[0].id')

# Check if USER_ID matches the input
if [[ -z "$USER_ID" || "$USER_ID" == "null" ]]; then
    echo "User with username $USERNAME not found. Exiting."
    exit 1
fi

if [[ "$USER_ID" != "$INPUT_USER_ID" ]]; then
    echo "Error: Provided user ID does not match the username $USERNAME. Exiting."
    exit 1
fi

# Step 4: Update the user's password
UPDATE_PASSWORD_RESPONSE=$(curl -k -s -X PUT "https://${KEYCLOAK_HOST}/admin/realms/$REALM/users/$USER_ID/reset-password" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "type": "password",
        "value": "'"$NEW_PASSWORD"'",
        "temporary": false
    }')

# Check if the password was updated successfully
if [[ -z "$UPDATE_PASSWORD_RESPONSE" ]]; then
    echo "Password updated successfully for user $USERNAME."
else
    echo "Failed to update password for user $USERNAME: $UPDATE_PASSWORD_RESPONSE"
    exit 1
fi
