#!/bin/sh
set -e

# Load from .env file if it exists (for local dev)
if [ -f .env ]; then
  echo "Loading environment from .env"
  set -o allexport
  . .env
  set +o allexport
fi

### Load API TOKEN
if [ -f /run/secrets/makler_parser_api_token ]; then
  API_TOKEN="$(cat /run/secrets/makler_parser_api_token)"
  export API_TOKEN
  echo "Loaded API_TOKEN from /run/secrets"
elif [ -n "$API_TOKEN" ]; then
  echo "Using API_TOKEN from environment"
else
  echo "ERROR: API_TOKEN not found in /run/secrets or environment"
  exit 1
fi


# Write to temporary file for tools like SSH
echo "$API_TOKEN" > /tmp/makler_parser_api_token
chmod 600 /tmp/makler_parser_api_token


# Run the actual command
exec "$@"
