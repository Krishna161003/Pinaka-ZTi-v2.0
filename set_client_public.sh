#!/bin/bash
set -euo pipefail
set -x  # Debug mode

# ===============================================================
#  CONFIG
# ===============================================================
HOST_IP=${HOST_IP:-$(hostname -I | awk '{print $1}')}
KEYCLOAK_URL="https://$HOST_IP:9090"
REALM="zti-realm"
CLIENT_ID="zti-client"

# --- CHANGE THESE (your Keycloak admin login from master realm) ---
ADMIN_USER="admin"
ADMIN_PASS="admin"
# -------------------------------------------------

# ===============================================================
#  STEP 1: Get admin token from master realm
# ===============================================================
RESPONSE=$(curl -s -k \
  -d "client_id=admin-cli" \
  -d "username=$ADMIN_USER" \
  -d "password=$ADMIN_PASS" \
  -d "grant_type=password" \
  "$KEYCLOAK_URL/realms/master/protocol/openid-connect/token")

ADMIN_TOKEN=$(echo "$RESPONSE" | jq -r .access_token)

if [[ -z "$ADMIN_TOKEN" || "$ADMIN_TOKEN" == "null" ]]; then
  echo "❌ Failed to fetch admin token"
  echo "Response: $RESPONSE"
  exit 1
fi
echo "✅ Got admin token from master realm"

# ===============================================================
#  STEP 2: Get client UUID from zti-realm
# ===============================================================
CLIENTS_JSON=$(curl -s -k -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$KEYCLOAK_URL/admin/realms/$REALM/clients?clientId=$CLIENT_ID")

echo "Client lookup response: $CLIENTS_JSON"

CLIENT_UUID=$(echo "$CLIENTS_JSON" | jq -r '.[0].id // empty')

if [[ -z "$CLIENT_UUID" ]]; then
  echo "❌ Client $CLIENT_ID not found in realm $REALM"
  echo "👉 Available clients:"
  echo "$CLIENTS_JSON" | jq '.[].clientId'
  exit 1
fi
echo "✅ Found client UUID: $CLIENT_UUID"

# ===============================================================
#  STEP 3: Update client to PUBLIC
# ===============================================================
UPDATE_PAYLOAD=$(cat <<EOF
{
  "publicClient": true,
  "serviceAccountsEnabled": false,
  "authorizationServicesEnabled": false,
  "bearerOnly": false
}
EOF
)

curl -s -k -X PUT "$KEYCLOAK_URL/admin/realms/$REALM/clients/$CLIENT_UUID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$UPDATE_PAYLOAD"

echo "✅ Client $CLIENT_ID in realm $REALM set to PUBLIC successfully."
