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

# Wait for browserless to be healthy before starting
echo "Waiting for browserless to be ready..."
MAX_WAIT=60  # seconds
WAITED=0

until curl -sf http://browserless:3000 > /dev/null; do
  sleep 2
  WAITED=$((WAITED + 2))
  if [ "$WAITED" -ge "$MAX_WAIT" ]; then
    echo "ERROR: Browserless not ready after $MAX_WAIT seconds"
    exit 1
  fi
done
echo "Browserless is up!"

# Write to temporary file for tools like SSH
echo "$API_TOKEN" > /tmp/makler_parser_api_token
chmod 600 /tmp/makler_parser_api_token


# Run the actual command
exec "$@"
