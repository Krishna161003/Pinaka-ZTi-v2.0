#!/bin/sh

set -e

host="$1"
shift
cmd="$@"

echo "Host: $host"
echo "Command: $cmd"

until mysqladmin ping -h "$host" --silent; do
  >&2 echo "MySQL is setting up, please wait... This may take some time."
  sleep 1
done

>&2 echo "MySQL is up - executing command"
exec $cmd
