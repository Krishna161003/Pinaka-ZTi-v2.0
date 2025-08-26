#!/bin/bash
set -x  # Enables debug output

# Get the host's IP and save it into a shell variable
HOST_IP=$(hostname -I | awk '{print $1}')

# Write the host IP to the .env file for React
echo "REACT_APP_HOST_IP=$HOST_IP" > .env

# Export the variable so it's available to Docker Compose
export HOST_IP=$HOST_IP

# Export environment variables from .env
export $(grep -v '^#' .env | xargs)

# Use sed to replace placeholders with the actual REACT_APP_HOST_IP
sed -i "s|\${REACT_APP_HOST_IP}|$REACT_APP_HOST_IP|g" realm.json
sed -i "s|https://${HOST_IP}|https://${REACT_APP_HOST_IP}|" ./src/Components/keycloak.conf

# Step 1: Update the Nginx configuration
./update_nginx.sh  # This will replace the placeholders in the Nginx config

# --- SSL Certificate Setup ---
SSL_DIR="ssl"
KEYSTORE_PASSWORD="yourpassword"

echo "Creating SSL directory if it doesn't exist..."
mkdir -p "$SSL_DIR"
cd "$SSL_DIR" || { echo "Failed to navigate to SSL directory"; exit 1; }

echo "Generating Keycloak private key and self-signed certificate..."
openssl genpkey -algorithm RSA -out keycloak.key
cat > keycloak.ext <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
IP.1 = ${HOST_IP}
EOF
openssl req -new -key keycloak.key -out keycloak.csr -subj "/C=IN/ST=Karnataka/L=Bangalore/O=Pinakastra Computing/OU=IT Department/CN=${HOST_IP}"
openssl x509 -req -in keycloak.csr -signkey keycloak.key -out keycloak.crt -days 365 -extfile keycloak.ext
openssl pkcs12 -export -in keycloak.crt -inkey keycloak.key -out keystore.p12 -name keycloak -passout pass:"$KEYSTORE_PASSWORD"
chmod 644 keystore.p12 keycloak.crt keycloak.key

mkdir -p /home/pinaka/ssl
cp keycloak.crt keycloak.key keystore.p12 /home/pinaka/ssl/
cp keycloak.crt keycloak.key /home/pinaka/Documents/GitHub/Pinaka-ZTi-v2.0/flask-back/
chmod 644 /home/pinaka/ssl/keycloak.crt /home/pinaka/ssl/keycloak.key /home/pinaka/ssl/keystore.p12
cd -

echo "SSL files have been successfully generated and stored in the '$SSL_DIR' directory."

# --- Start Keycloak container ---
if docker-compose -f docker-compose-keycloak.yml up --build -d; then
    echo "Keycloak container started successfully."
    echo "Waiting for Keycloak to be ready..."
    until [ "$(curl -s -o /dev/null -w "%{http_code}" -k https://$HOST_IP:9090/)" != "000" ]; do
        sleep 5
        echo "Keycloak is not ready yet. Retrying..."
    done
    echo "Keycloak is ready."

    # ⚡ NEW: Configure Keycloak client to PUBLIC (disable client_secret)
    ./set_client_public.sh || { echo "Failed to set client as public"; exit 1; }

    # Skip get_client_secret.sh (not needed anymore for public clients)

    # Step: Execute the get-admin-access-token script
    if ./get-admin-accesss-token.sh; then
        echo "get-admin-access-token.sh executed successfully."

        # Step: Execute the role_assigned script
        if ./role_assigned.sh; then
            echo "role_assigned.sh executed successfully."

            # Step: Start the remaining containers
            docker-compose up --build -d
        else
            echo "Failed to execute role_assigned.sh."
            exit 1
        fi
    else
        echo "Failed to execute get-admin-access-token.sh."
        exit 1
    fi
else
    echo "Failed to start Keycloak container."
    exit 1
fi
