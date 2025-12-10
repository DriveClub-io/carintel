#!/usr/bin/env python3
"""Monitor extraction progress and system health every 15 minutes"""
import os
import time
import subprocess
from datetime import datetime
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

supabase = create_client(
    os.getenv('SUPABASE_URL'),
    os.getenv('SUPABASE_SERVICE_KEY')
)

LOG_FILE = "extraction_monitor.log"

def log(msg):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{timestamp}] {msg}"
    print(line)
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")

def check_status():
    extracted = supabase.table('vehicle_manuals').select('id', count='exact').eq('content_status', 'extracted').execute()
    extracting = supabase.table('vehicle_manuals').select('id', count='exact').eq('content_status', 'extracting').execute()
    pending = supabase.table('vehicle_manuals').select('id', count='exact').eq('content_status', 'pending').execute()
    failed = supabase.table('vehicle_manuals').select('id', count='exact').eq('content_status', 'failed').execute()
    
    # Get system stats
    top_output = subprocess.run(['top', '-l', '1', '-n', '0'], capture_output=True, text=True)
    cpu_line = [l for l in top_output.stdout.split('\n') if 'CPU usage' in l]
    mem_line = [l for l in top_output.stdout.split('\n') if 'PhysMem' in l]
    
    cpu_idle = "N/A"
    if cpu_line:
        import re
        match = re.search(r'(\d+\.\d+)% idle', cpu_line[0])
        if match:
            cpu_idle = match.group(1)
    
    log(f"STATUS: extracted={extracted.count}, extracting={extracting.count}, pending={pending.count}, failed={failed.count}, cpu_idle={cpu_idle}%")
    
    # Check for stuck extractions (over 30 min)
    if extracting.count > 0:
        from datetime import timezone
        active = supabase.table('vehicle_manuals').select(
            'id, year, make, model, updated_at'
        ).eq('content_status', 'extracting').execute()
        
        now = datetime.now(timezone.utc)
        for m in active.data:
            updated = datetime.fromisoformat(m['updated_at'].replace('Z', '+00:00'))
            elapsed_min = (now - updated).total_seconds() / 60
            if elapsed_min > 30:
                log(f"WARNING: {m['year']} {m['make']} {m['model']} stuck for {elapsed_min:.0f} min - resetting to pending")
                supabase.table('vehicle_manuals').update(
                    {'content_status': 'pending'}
                ).eq('id', m['id']).execute()

def main():
    log("=== MONITOR STARTED ===")
    while True:
        try:
            check_status()
        except Exception as e:
            log(f"ERROR: {str(e)[:100]}")
        time.sleep(900)  # 15 minutes

if __name__ == "__main__":
    main()
