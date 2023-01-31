#!/bin/bash

check_result() {
    ___RESULT=$?
    if [ $___RESULT -ne 0 ]; then
        echo $1
        docker-compose -f docker-compose.test.yml rm -s -f
        docker-compose -f docker-compose.test.yml down
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

if [ -z "$COMPOSE_PROJECT_NAME" ]; then
    export COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME}
fi

export CONTAINER_USER_ID=$(id -u)
export CONTAINER_GROUP_ID=$(id -g)
export EVENTSTORE_NETWORK_NAME=$(whoami)_eventstore_eventstore

docker-compose -f docker-compose.test.yml pull
check_result "failed to run docker-compose pull"

docker-compose -f docker-compose.test.yml build
check_result "failed to run docker-compose build"

docker-compose -f docker-compose.test.yml up -d
check_result "failed to run docker-compose up -d"

docker-compose -f docker-compose.test.yml exec -T prometheus-proxy bash -c "npm ci"
check_result "failed to run npm ci"

docker-compose -f docker-compose.test.yml exec -T prometheus-proxy bash -c "npm run test"
check_result "failed to run tests"

docker-compose -f docker-compose.test.yml rm -s -f
docker-compose -f docker-compose.test.yml down
