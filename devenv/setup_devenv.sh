#!/bin/bash

check_result () {
    ___RESULT=$?
    if [ $___RESULT -ne 0 ]; then
        echo $1
        exit 1
    fi
}

if [ -f ".env" ]; then
    echo "detected .env loading it"
    source .env
    check_result "failed to load .env file"
    echo "success"
else
    echo "no .env found, using default"
fi

export COMPOSE_PROJECT_NAME=$(whoami)_prometheus-proxy

COMPOSE_PROJECT_NAME=$(whoami)_prometheus-proxy CONTAINER_USER_ID=$(id -u) CONTAINER_GROUP_ID=$(id -g) docker-compose pull
check_result "failed to run docker-compose build"

COMPOSE_PROJECT_NAME=$(whoami)_prometheus-proxy CONTAINER_USER_ID=$(id -u) CONTAINER_GROUP_ID=$(id -g) docker-compose build
check_result "failed to run docker-compose build"

COMPOSE_PROJECT_NAME=$(whoami)_prometheus-proxy CONTAINER_USER_ID=$(id -u) CONTAINER_GROUP_ID=$(id -g) docker-compose up -d
check_result "failed to run docker-compose up -d"
