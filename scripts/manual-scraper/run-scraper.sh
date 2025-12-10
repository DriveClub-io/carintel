#!/bin/bash
# Long-running scraper script
# Run with: nohup ./run-scraper.sh > scraper.log 2>&1 &

cd /Users/shaunberkley/dev/auto/carintel/scripts/manual-scraper

echo "Starting manual scraper at $(date)"
echo "This will download and sync all manuals to Supabase"
echo ""

npx tsx scrape-manuals.ts --download --sync

echo ""
echo "Scraping complete at $(date)"
