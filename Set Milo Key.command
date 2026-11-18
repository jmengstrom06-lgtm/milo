#!/bin/bash
# Double-click this after copying your Anthropic key. It saves the key into .env.
cd "$(dirname "$0")"
node scripts/setkey.js
echo
read -n 1 -s -r -p "Press any key to close."
