#!/bin/bash
set -x

docker build -t pinaka-zti-v2.0-react-app:1.1 .
docker build -t pinaka-zti-v2.0-node-backend:1.1 ./backend/db

docker tag pinaka-zti-v2.0-react-app:1.1 localhost:4000/pinaka-zti-v2.0-react-app:1.1
docker tag pinaka-zti-v2.0-node-backend:1.1 localhost:4000/pinaka-zti-v2.0-node-backend:1.1

# docker push localhost:4000/pinaka-zti-v2.0-react-app:1.1
# docker push localhost:4000/pinaka-zti-v2.0-node-backend:1.1

docker pull quay.io/keycloak/keycloak:12.0.4
docker pull postgres:15
docker pull mysql:8.0
