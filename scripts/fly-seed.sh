#!/bin/bash
#
# fly-seed.sh - Populate Fly.io Postgres with demo data
#
# This script seeds your Fly.io Postgres database with the Bar Harbor demo
# region data. It runs database migrations and ingests Overture Maps data
# for roads and buildings.
#
# PREREQUISITES:
#   - flyctl CLI installed and authenticated
#   - Local proxy to Fly Postgres running (see step 1 below)
#   - dbmate installed (brew install dbmate)
#   - Node.js and pnpm installed
#
# USAGE:
#
#   Step 1: Start the Fly Postgres proxy in a separate terminal:
#
#       flyctl proxy 5433:5432 -a <your-postgres-app-name>
#
#   Step 2: Get your database password from the app's DATABASE_URL secret:
#
#       flyctl ssh console -a <your-app-name> -C "printenv DATABASE_URL"
#
#       The output will look like:
#         postgres://<user>:<password>@<host>:5432/<database>?sslmode=disable
#
#       Copy the password (the part between ':' after the username and '@')
#
#   Step 3: Run this script with the password:
#
#       ./scripts/fly-seed.sh <password>
#
# WHAT THIS SCRIPT DOES:
#   1. Tests the database connection via the local proxy
#   2. Runs dbmate migrations to create/update schema
#   3. Runs the ingest:demo script to populate Bar Harbor demo data
#      (downloads Overture Maps data if not cached locally)
#

set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <password> [username] [database]"
  echo ""
  echo "Arguments:"
  echo "  password   Required. The Postgres password from DATABASE_URL"
  echo "  username   Optional. Database username (default: nightfall)"
  echo "  database   Optional. Database name (default: nightfall)"
  echo ""
  echo "See the comments at the top of this script for detailed instructions."
  echo ""
  echo "Quick start:"
  echo "  1. In another terminal: flyctl proxy 5433:5432 -a <postgres-app>"
  echo "  2. Get password: flyctl ssh console -a <app> -C 'printenv DATABASE_URL'"
  echo "  3. Run: $0 <password>"
  exit 1
fi

PASSWORD="$1"
DB_USER="${2:-nightfall}"
DB_NAME="${3:-nightfall}"

export DATABASE_URL="postgres://${DB_USER}:${PASSWORD}@localhost:5433/${DB_NAME}?sslmode=disable"

echo "==> Testing connection..."
node -e "const{Pool}=require('pg');new Pool({connectionString:process.env.DATABASE_URL}).query('SELECT 1').then(()=>{console.log('Connection successful!');process.exit(0)}).catch(e=>{console.error('ERROR:',e.message);process.exit(1)})" || {
  echo "Make sure the proxy is running: flyctl proxy 5433:5432 -a nightfall-db"
  exit 1
}

echo ""
echo "==> Running dbmate migrations..."
dbmate up

echo ""
echo "==> Running ingest:demo..."
cd "$(dirname "$0")/.."
pnpm run ingest:demo

echo ""
echo "==> Done! Your Fly.io database is now seeded with demo data."
