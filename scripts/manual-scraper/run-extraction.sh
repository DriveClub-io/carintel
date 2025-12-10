#!/bin/bash
# Long-running extraction script
# Run with: nohup ./run-extraction.sh > extraction.log 2>&1 &

cd /Users/shaunberkley/dev/auto/carintel/scripts/manual-scraper
source .venv/bin/activate

echo "Starting marker-pdf extraction at $(date)"
echo "Using 4 parallel workers"
echo "This will run until all pending manuals are processed"
echo ""

# Run extraction in batches of 40, with 4 workers
# Each batch will take ~2.5 hours with 4 workers (40 PDFs / 4 workers * 15 min/PDF)
while true; do
    echo ""
    echo "=========================================="
    echo "Starting batch at $(date)"
    echo "=========================================="

    # Run extraction for a batch - 4 workers for speed
    python extract-marker.py --workers 4 --limit 40

    # Check if there are more pending
    PENDING=$(python -c "
from supabase import create_client
import os
from dotenv import load_dotenv
load_dotenv()
supabase = create_client(
    os.getenv('SUPABASE_URL', 'https://jxpbnnmefwtazfvoxvge.supabase.co'),
    os.getenv('SUPABASE_SERVICE_KEY')
)
result = supabase.table('vehicle_manuals').select('id', count='exact').eq('content_status', 'pending').execute()
print(result.count)
")

    echo "Remaining pending: $PENDING"

    if [ "$PENDING" -eq 0 ]; then
        echo "All manuals processed!"
        break
    fi

    echo "Continuing to next batch..."
    sleep 5
done

echo ""
echo "Extraction complete at $(date)"
