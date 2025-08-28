#!/bin/bash
set -euo pipefail
set -x  # Enable debug output

# ===============================================================
# STEP 0: Environment Setup
# ===============================================================
HOST_IP=$(hostname -I | awk '{print $1}')

# Save host IP into .env file for React
echo "REACT_APP_HOST_IP=$HOST_IP" > .env

# Export for use in Docker Compose
export HOST_IP=$HOST_IP
export $(grep -v '^#' .env | xargs)

# Replace placeholders in realm.json and keycloak.conf
sed -i "s|\${REACT_APP_HOST_IP}|$REACT_APP_HOST_IP|g" realm.json
sed -i "s|https://${HOST_IP}|https://${REACT_APP_HOST_IP}|" ./src/Components/keycloak.conf

# Update Nginx configuration
./update_nginx.sh

# ===============================================================
# STEP 1: SSL Certificates
# ===============================================================
SSL_DIR="ssl"
KEYSTORE_PASSWORD="yourpassword"

echo "Creating SSL directory if it doesn't exist..."
mkdir -p "$SSL_DIR"
cd "$SSL_DIR" || { echo "❌ Failed to navigate to SSL directory"; exit 1; }

# Generate private key
echo "Generating Keycloak private key..."
openssl genpkey -algorithm RSA -out keycloak.key || { echo "❌ Error generating private key"; exit 1; }

# Generate SAN config
cat > keycloak.ext <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage=digitalSignature,nonRepudiation,keyEncipherment,dataEncipherment
subjectAltName=@alt_names

[alt_names]
DNS.1=localhost
IP.1=${HOST_IP}
EOF

# CSR + Certificate
openssl req -new -key keycloak.key -out keycloak.csr \
    -subj "/C=IN/ST=Karnataka/L=Bangalore/O=Pinakastra Computing/OU=IT Department/CN=${HOST_IP}"

openssl x509 -req -in keycloak.csr -signkey keycloak.key -out keycloak.crt -days 365 -extfile keycloak.ext \
    || { echo "❌ Error generating certificate"; exit 1; }

# Keystore
echo "Creating PKCS#12 keystore..."
openssl pkcs12 -export -in keycloak.crt -inkey keycloak.key -out keystore.p12 \
    -name keycloak -passout pass:"$KEYSTORE_PASSWORD" \
    || { echo "❌ Error creating keystore"; exit 1; }

chmod 644 keystore.p12 keycloak.crt keycloak.key

# Copy certs to required directories
mkdir -p /home/pinaka/ssl
cp keycloak.crt keycloak.key keystore.p12 /home/pinaka/ssl/
cp keycloak.crt keycloak.key /home/pinaka/Pinaka-ZTi-v2.0/flask-back/
chmod 644 /home/pinaka/ssl/keycloak.* /home/pinaka/ssl/keystore.p12

echo "✅ SSL certificates ready"

cd - || { echo "❌ Failed to return to original directory"; exit 1; }

# ===============================================================
# STEP 2: Start Keycloak
# ===============================================================
if docker-compose -f docker-compose-keycloak.yml up --build -d; then
    echo "✅ Keycloak container started"

    echo "⏳ Waiting for Keycloak to be ready..."
    until [ "$(curl -s -o /dev/null -w "%{http_code}" -k https://$HOST_IP:9090/)" != "000" ]; do
        sleep 5
        echo "Keycloak not ready yet. Retrying..."
    done
    echo "✅ Keycloak is ready."

    # ===========================================================
    # STEP 3: Keycloak Setup Scripts
    # ===========================================================
    if ./get_client_secret.sh; then
        echo "✅ get_client_secret.sh executed"

        if ./get-admin-accesss-token.sh; then
            echo "✅ get-admin-access-token.sh executed"

            if ./role_assigned.sh; then
                echo "✅ role_assigned.sh executed"
                # Start the rest of the stack
                docker-compose up --build -d
            else
                echo "❌ Failed to execute role_assigned.sh."
                exit 1
            fi
        else
            echo "❌ Failed to execute get-admin-access-token.sh."
            exit 1
        fi
    else
        echo "❌ Failed to execute get_client_secret.sh."
        exit 1
    fi
else
    echo "❌ Failed to start Keycloak container."
    exit 1
fi
