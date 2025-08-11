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

# Define variables for directory and keystore password
SSL_DIR="ssl"
KEYSTORE_PASSWORD="yourpassword"

# Step 1: Create the SSL directory if it doesn't exist
echo "Creating SSL directory if it doesn't exist..."
mkdir -p "$SSL_DIR"

# Navigate to the SSL directory
cd "$SSL_DIR" || { echo "Failed to navigate to SSL directory"; exit 1; }

# Step 2: Generate Keycloak key and self-signed certificate
echo "Generating Keycloak private key and self-signed certificate..."
openssl genpkey -algorithm RSA -out keycloak.key
if [[ $? -ne 0 ]]; then echo "Error generating Keycloak private key"; exit 1; fi

# Create a SAN config file dynamically
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
if [[ $? -ne 0 ]]; then echo "Error generating Keycloak certificate"; exit 1; fi

# Step 3: Create a PKCS#12 keystore from Keycloak certificate and key
echo "Creating PKCS#12 keystore for Keycloak..."
openssl pkcs12 -export -in keycloak.crt -inkey keycloak.key -out keystore.p12 -name keycloak -passout pass:"$KEYSTORE_PASSWORD"
if [[ $? -ne 0 ]]; then echo "Error creating PKCS#12 keystore"; exit 1; fi

chmod 644 keystore.p12 keycloak.crt keycloak.key

# Ensure target directory exists
mkdir -p /home/pinaka/ssl

# Copy SSL files to /home/pinaka/ssl
cp keycloak.crt keycloak.key keystore.p12 /home/pinaka/ssl/
cp keycloak.crt keycloak.key /home/pinaka/Documents/GitHub/Pinaka-ZTi-v1.5/flask-back/

# Set correct permissions
chmod 644 /home/pinaka/ssl/keycloak.crt /home/pinaka/ssl/keycloak.key /home/pinaka/ssl/keystore.p12

echo "SSL certificates copied to /home/pinaka/ssl"

# Step 5: Return to the original directory
cd - || { echo "Failed to return to the original directory"; exit 1; }

# Completion message
echo "SSL files have been successfully generated and stored in the '$SSL_DIR' directory."

# Start the SSL watch script in the background
#sudo systemctl restart zti-daemon.service

# Step 2: Start Keycloak container
if docker-compose -f docker-compose-keycloak.yml up --build -d; then
    echo "Keycloak container started successfully."

    # Wait for Keycloak to be fully running
    echo "Waiting for Keycloak to be ready..."
    until [ "$(curl -s -o /dev/null -w "%{http_code}" -k https://$HOST_IP:9090/)" != "000" ]; do
        sleep 5
        echo "Keycloak is not ready yet. Retrying..."
    done
    echo "Keycloak is ready."

    # Step 3: Execute the get_client_secret script
    if ./get_client_secret.sh; then
        echo "get_client_secret.sh executed successfully."

        # Step 4: Execute the get-admin-access-token script
        if ./get-admin-accesss-token.sh; then
            echo "get-admin-access-token.sh executed successfully."

            # Step 5: Execute the role_assigned script
            if ./role_assigned.sh; then
                echo "role_assigned.sh executed successfully."

                # Step 6: Start the remaining containers
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
        echo "Failed to execute get_client_secret.sh."
        exit 1
    fi
else
    echo "Failed to start Keycloak container."
    exit 1
fi

