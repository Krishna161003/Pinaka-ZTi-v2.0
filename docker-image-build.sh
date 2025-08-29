#!/bin/bash
set -x

sudo docker stop registry
sudo docker rm registry
sudo docker volume rm registry-data

sudo docker run -d -p 4000:5000 --name registry registry:2


docker build -t pinaka-zti-v2.0-react-app:1.1 .
docker build -t pinaka-zti-v2.0-node-backend:1.1 ./backend/db

docker tag pinaka-zti-v2.0-react-app:1.1 localhost:4000/pinaka-zti-v2.0-react-app:1.1
docker tag pinaka-zti-v2.0-node-backend:1.1 localhost:4000/pinaka-zti-v2.0-node-backend:1.1

docker push localhost:4000/pinaka-zti-v2.0-react-app:1.1
docker push localhost:4000/pinaka-zti-v2.0-node-backend:1.1

docker pull quay.io/keycloak/keycloak:latest
docker pull postgres:15
docker pull mysql:8.0

bash docker-run.sh
