#!/bin/bash

# Stop and remove Keycloak container using its specific Docker Compose file
if docker-compose -f docker-compose-keycloak.yml down; then
    echo "Keycloak container stopped successfully."
else
    echo "Failed to stop Keycloak container."
fi

# Stop and remove all other containers and networks
if docker-compose down; then
    echo "Docker containers stopped successfully."
else
    echo "Failed to stop Docker containers."
fi

# Remove all Docker images
if docker rmi $(docker images -aq); then
    echo "Docker images removed successfully."
else
    echo "Failed to remove Docker images."
fi

# Remove specific Docker volumes
if docker volume remove pinaka-zti-v15_mysql-data; then
    echo "Volume pinaka-zti_05_mysql-data removed successfully."
else
    echo "Failed to remove volume pinaka-zti_v15_mysql-data."
fi

if docker volume remove pinaka-zti-v15_mongodb_data; then
    echo "Volume pinaka-zti_05_mongodb_data removed successfully."
else
    echo "Failed to remove volume pinaka-zti_v15_mongodb_data."
fi

if docker volume remove pinaka-zti-v15_shared-data; then
    echo "Volume pinaka-zti_v15_shared-data removed successfully."
else
    echo "Failed to remove volume pinaka-zti_v15_shared-data."
fi

if docker volume prune -f; then
    echo "Volume Pruned Successfully."
else
    echo "Volume Prune Failed."
fi
