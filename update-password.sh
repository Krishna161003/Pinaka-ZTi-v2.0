#!/bin/bash

# Accept inputs from command-line arguments
USERNAME="$1"
INPUT_USER_ID="$2"
OLD_PASSWORD="$3"
NEW_PASSWORD="$4"
REACT_APP_HOST_IP="$5"  # New argument for host IP

# Debugging: Print received arguments
echo "Received username: $USERNAME"
echo "Received user ID: $INPUT_USER_ID"
echo "Received old password: [HIDDEN]"
echo "Received new password: [HIDDEN]"
echo "Received host IP: $REACT_APP_HOST_IP"

# Ensure all required arguments are provided
if [[ -z "$USERNAME" || -z "$INPUT_USER_ID" || -z "$OLD_PASSWORD" || -z "$NEW_PASSWORD" || -z "$REACT_APP_HOST_IP" ]]; then
    echo "Usage: $0 <username> <user_id> <old_password> <new_password> <host_ip>"
    exit 1
fi

KEYCLOAK_HOST="${REACT_APP_HOST_IP}:9090"
REALM="zti-realm"
KEYCLOAK_ADMIN="admin"
KEYCLOAK_ADMIN_PASSWORD="admin"

echo "KEYCLOAK_HOST: $KEYCLOAK_HOST"
echo "REALM: $REALM"

# Step 1: Get the Keycloak access token
RAW_RESPONSE=$(curl -k -s -X POST "https://${KEYCLOAK_HOST}/realms/master/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=$KEYCLOAK_ADMIN" \
    -d "password=$KEYCLOAK_ADMIN_PASSWORD" \
    -d "grant_type=password" \
    -d "client_id=admin-cli")

ACCESS_TOKEN=$(echo "$RAW_RESPONSE" | jq -r .access_token)

# Check if ACCESS_TOKEN is retrieved
if [[ -z "$ACCESS_TOKEN" || "$ACCESS_TOKEN" == "null" ]]; then
    echo "Failed to retrieve access token. Exiting."
    exit 1
fi

# Step 2: Get the user ID based on the username
USER_ID=$(curl -k -s -X GET "https://${KEYCLOAK_HOST}/admin/realms/$REALM/users?username=$USERNAME" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    | jq -r '.[0].id')

# Check if USER_ID matches the input
if [[ -z "$USER_ID" || "$USER_ID" == "null" ]]; then
    echo "User with username $USERNAME not found. Exiting."
    exit 1
fi

echo "User ID for username $USERNAME: $USER_ID"

if [[ "$USER_ID" != "$INPUT_USER_ID" ]]; then
    echo "Error: Provided user ID does not match the username $USERNAME. Exiting."
    exit 1
fi

# Step 3: Verify the old password by attempting to get a token
echo "Verifying old password..."
OLD_PASSWORD_VERIFICATION=$(curl -k -s -X POST "https://${KEYCLOAK_HOST}/realms/$REALM/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=$USERNAME" \
    -d "password=$OLD_PASSWORD" \
    -d "grant_type=password" \
    -d "client_id=admin-cli")

OLD_PASSWORD_TOKEN=$(echo "$OLD_PASSWORD_VERIFICATION" | jq -r .access_token)

# Check if old password verification failed
if [[ -z "$OLD_PASSWORD_TOKEN" || "$OLD_PASSWORD_TOKEN" == "null" ]]; then
    echo "Error: Old password verification failed. The provided old password is incorrect."
    exit 1
fi

echo "Old password verification successful."

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
