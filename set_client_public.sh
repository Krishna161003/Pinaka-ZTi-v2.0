#!/bin/bash
# set_client_public.sh

KEYCLOAK_URL="https://$HOST_IP:9090"
REALM="zti-realm"
CLIENT_ID="zti-client"

# Login to Keycloak admin (using existing get-admin-access-token.sh)
ADMIN_TOKEN=$(./get-admin-accesss-token.sh --print-token)

if [ -z "$ADMIN_TOKEN" ]; then
  echo "Failed to get admin token"
  exit 1
fi

# Get client UUID
CLIENT_UUID=$(curl -s -k -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$KEYCLOAK_URL/admin/realms/$REALM/clients?clientId=$CLIENT_ID" | jq -r '.[0].id')

if [ -z "$CLIENT_UUID" ] || [ "$CLIENT_UUID" == "null" ]; then
  echo "Client $CLIENT_ID not found in realm $REALM"
  exit 1
fi

# Update client to PUBLIC (disable secret)
curl -s -k -X PUT "$KEYCLOAK_URL/admin/realms/$REALM/clients/$CLIENT_UUID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "publicClient": true,
    "serviceAccountsEnabled": false,
    "authorizationServicesEnabled": false,
    "bearerOnly": false
  }'

echo "Client $CLIENT_ID in realm $REALM set to PUBLIC successfully."