#!/bin/bash

# Load environment variables from the .env file
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
else
    echo ".env file not found. Please create it with the required variables."
    exit 1
fi

# Define Keycloak server URL and admin credentials
KEYCLOAK_URL="https://${REACT_APP_HOST_IP}:9090"
REALM="zti-realm"
CLIENT_ID="zti-client"
CLIENT_SECRET="${REACT_APP_CLIENT_SECRET}"  # Confidential client secret
ROLE_NAME="manage-users"


# Obtain an admin token from Keycloak
ADMIN_TOKEN=$(curl -k -s -X POST "$KEYCLOAK_URL/realms/master/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "client_id=admin-cli" \
    -d "username=admin" \
    -d "password=admin" \
    -d "grant_type=password" | jq -r '.access_token')

# Obtain a client token for the confidential client
CLIENT_TOKEN=$(curl -k -s -X POST "$KEYCLOAK_URL/realms/$REALM/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "client_id=$CLIENT_ID" \
    -d "client_secret=$CLIENT_SECRET" \
    -d "grant_type=client_credentials" | jq -r '.access_token')

# Fetch the realm-management client ID
REALM_MGMT_CLIENT_ID=$(curl -k -s -X GET "$KEYCLOAK_URL/admin/realms/$REALM/clients?clientId=realm-management" \
    -H "Authorization: Bearer $ADMIN_TOKEN" | jq -r '.[0].id')

# Fetch the roles associated with the realm-management client
ROLE_ID=$(curl -k -s -X GET "$KEYCLOAK_URL/admin/realms/$REALM/clients/$REALM_MGMT_CLIENT_ID/roles" \
    -H "Authorization: Bearer $ADMIN_TOKEN" | jq -r ".[] | select(.name == \"$ROLE_NAME\") | .id")

if [ -z "$ROLE_ID" ]; then
    echo "Error: Role '$ROLE_NAME' not found."
    exit 1
fi

# Fetch the service account user ID for the client
CLIENT_UUID=$(curl -k -s -X GET "$KEYCLOAK_URL/admin/realms/$REALM/clients?clientId=$CLIENT_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN" | jq -r '.[0].id')

SERVICE_ACCOUNT_UUID=$(curl -k -s -X GET "$KEYCLOAK_URL/admin/realms/$REALM/clients/$CLIENT_UUID/service-account-user" \
    -H "Authorization: Bearer $ADMIN_TOKEN" | jq -r '.id')

if [ -z "$SERVICE_ACCOUNT_UUID" ]; then
    echo "Error: Service account for client '$CLIENT_ID' not found."
    exit 1
fi

# Assign the 'manage-users' role to the service account
ASSIGNMENT_RESPONSE=$(curl -k -s -X POST "$KEYCLOAK_URL/admin/realms/$REALM/users/$SERVICE_ACCOUNT_UUID/role-mappings/clients/$REALM_MGMT_CLIENT_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "[ { \"id\": \"$ROLE_ID\", \"name\": \"$ROLE_NAME\" } ]")

if [[ "$ASSIGNMENT_RESPONSE" == *"error"* ]]; then
    echo "Error: Failed to assign role '$ROLE_NAME' to the service account."
    echo "Response: $ASSIGNMENT_RESPONSE"
    exit 1
fi

echo "Role '$ROLE_NAME' successfully assigned to the service account of client '$CLIENT_ID'."

