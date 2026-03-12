#!/bin/sh

# Wrapper script for changing a user's password

if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <username> <new_password>"
    exit 1
fi

npm run change-password "$1" "$2"
