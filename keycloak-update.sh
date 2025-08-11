#!/bin/bash
set -x  # Enables debug output

# Get the host's IP and save it into a shell variable
HOST_IP=$(hostname -I | awk '{print $1}')

# After Keycloak is ready
echo "Updating Keycloak client redirect URIs dynamically..."

# Get access token for Keycloak Admin API
ADMIN_TOKEN=$(curl -k -s -X POST "https://${HOST_IP}:9090/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin" \
  -d "password=admin" \
  -d "grant_type=password" \
  -d "client_id=admin-cli" | jq -r .access_token)

REALM="zti-realm"
CLIENT_ID="zti-client"

# Get client UUID
CLIENT_UUID=$(curl -k -s -X GET "https://${HOST_IP}:9090/admin/realms/${REALM}/clients?clientId=${CLIENT_ID}" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq -r '.[0].id')

# Build new redirect URI
NEW_REDIRECT="https://${HOST_IP}:3000/*"

# Update client in Keycloak
curl -k -s -X PUT "https://${HOST_IP}:9090/admin/realms/${REALM}/clients/${CLIENT_UUID}" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"redirectUris\":[\"${NEW_REDIRECT}\"],\"webOrigins\":[\"*\"]}"

echo "Updated Keycloak redirect URI to ${NEW_REDIRECT}"
