#!/bin/bash

# Step 1: Set up variables
KEYCLOAK_ADMIN="admin"
KEYCLOAK_ADMIN_PASSWORD="admin"
REALM="zti-realm"
CLIENT_ID="zti-client"
ENV_FILE=".env"

# Extract the IP address from the .env file
REACT_APP_HOST_IP=$(grep 'REACT_APP_HOST_IP' $ENV_FILE | cut -d '=' -f2)
KEYCLOAK_HOST="${REACT_APP_HOST_IP}:9090"

# Step 2: Get the Keycloak access token and print the raw response for debugging
RAW_RESPONSE=$(curl -k -s -X POST "https://${KEYCLOAK_HOST}/realms/master/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=$KEYCLOAK_ADMIN" \
    -d "password=$KEYCLOAK_ADMIN_PASSWORD" \
    -d "grant_type=password" \
    -d "client_id=admin-cli")

# Print raw response to see if Keycloak returned an error message
echo "Raw response from Keycloak: $RAW_RESPONSE"

# Check if the response contains an error message
if echo "$RAW_RESPONSE" | grep -q "error"; then
    echo "Error response from Keycloak: $RAW_RESPONSE"
    exit 1
fi

# Extract the access token
ACCESS_TOKEN=$(echo $RAW_RESPONSE | jq -r .access_token)

# Check if ACCESS_TOKEN is not empty
if [[ -z "$ACCESS_TOKEN" || "$ACCESS_TOKEN" == "null" ]]; then
    echo "Failed to retrieve access token. Exiting."
    exit 1
fi

# Step 3: Get the client UUID
CLIENTS_RESPONSE=$(curl -k -s -X GET "https://${KEYCLOAK_HOST}/admin/realms/$REALM/clients?clientId=$CLIENT_ID" \
    -H "Authorization: Bearer $ACCESS_TOKEN")

echo "Client list response: $CLIENTS_RESPONSE"

CLIENT_UUID=$(echo "$CLIENTS_RESPONSE" | jq -r '.[0].id')

# Step 4: Get the secret from the UUID
CLIENT_SECRET=$(curl -k -s -X GET "https://${KEYCLOAK_HOST}/admin/realms/$REALM/clients/$CLIENT_UUID/client-secret" \
    -H "Authorization: Bearer $ACCESS_TOKEN" | jq -r .value)


# Step 4: Append required values to the .env file
echo "REACT_APP_CLIENT_SECRET=\"$CLIENT_SECRET\"" >> $ENV_FILE
echo "REACT_APP_KEYCLOAK_ADMIN_USERNAME=\"$KEYCLOAK_ADMIN\"" >> $ENV_FILE
echo "REACT_APP_KEYCLOAK_ADMIN_PASSWORD=\"$KEYCLOAK_ADMIN_PASSWORD\"" >> $ENV_FILE

echo "Client secret and admin credentials have been appended to $ENV_FILE"

