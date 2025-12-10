#!/usr/bin/env python3
"""
Live extraction status monitor.

Usage:
    python status.py          # Live updating display
    python status.py --once   # Single check
"""

import sys
import time
from supabase import create_client
from pathlib import Path
from datetime import datetime

# Load credentials
env_file = Path(__file__).parent / '.env'
env_content = env_file.read_text()
service_key = env_content.split('SUPABASE_SERVICE_KEY=')[1].split('\n')[0].strip()

supabase = create_client('https://jxpbnnmefwtazfvoxvge.supabase.co', service_key)

# Track history for speed calculation
history = []

def get_status():
    counts = {}
    total = 0
    for status in ['pending', 'extracting', 'extracted', 'failed']:
        result = supabase.table('vehicle_manuals').select('id', count='exact').eq('content_status', status).execute()
        count = result.count or 0
        counts[status] = count
        total += count
    
    # Get docling count
    docling = supabase.table('manual_content').select('id', count='exact').eq('extraction_method', 'docling-modal-gpu').execute()
    counts['docling'] = docling.count or 0
    counts['total'] = total
    
    return counts

def display(counts, speed_per_hour=None, eta_hours=None):
    # Clear screen
    print("\033[2J\033[H", end="")
    
    total = counts['total']
    
    print("=" * 60)
    print("  MANUAL EXTRACTION STATUS - LIVE")
    print("=" * 60)
    print(f"  Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    
    # Progress bar for extracted
    extracted = counts['extracted']
    pct = (extracted / total * 100) if total > 0 else 0
    bar_len = int(pct / 2)
    bar = "█" * bar_len + "░" * (50 - bar_len)
    print(f"  [{bar}] {pct:.1f}%")
    print()
    
    # Status counts
    print(f"  {'Status':<12} {'Count':>6}")
    print(f"  {'-'*20}")
    for status in ['extracted', 'extracting', 'pending', 'failed']:
        count = counts[status]
        emoji = {'extracted': '✅', 'extracting': '🔄', 'pending': '⏳', 'failed': '❌'}[status]
        print(f"  {emoji} {status:<10} {count:>6}")
    
    print()
    print(f"  Docling GPU:  {counts['docling']}")
    
    # Speed and ETA
    if speed_per_hour is not None and speed_per_hour > 0:
        print()
        print(f"  {'-'*40}")
        print(f"  ⚡ Speed:     {speed_per_hour:.0f} manuals/hour")
        if eta_hours is not None:
            if eta_hours < 1:
                print(f"  ⏱️  ETA:       {eta_hours * 60:.0f} minutes")
            else:
                print(f"  ⏱️  ETA:       {eta_hours:.1f} hours")
    
    print()
    print("=" * 60)
    print("  Press Ctrl+C to exit")
    print("=" * 60)

def main():
    global history
    
    once = '--once' in sys.argv
    
    if once:
        counts = get_status()
        display(counts)
        return
    
    print("Starting live monitor... (updating every 30 seconds)")
    time.sleep(1)
    
    while True:
        try:
            counts = get_status()
            now = time.time()
            
            # Track history
            history.append((now, counts['extracted']))
            
            # Keep last 10 minutes of history
            history = [(t, c) for t, c in history if now - t < 600]
            
            # Calculate speed
            speed_per_hour = None
            eta_hours = None
            
            if len(history) >= 2:
                oldest_time, oldest_count = history[0]
                newest_time, newest_count = history[-1]
                
                time_diff = newest_time - oldest_time
                count_diff = newest_count - oldest_count
                
                if time_diff > 0 and count_diff > 0:
                    speed_per_hour = (count_diff / time_diff) * 3600
                    remaining = counts['pending']
                    if speed_per_hour > 0:
                        eta_hours = remaining / speed_per_hour
            
            display(counts, speed_per_hour, eta_hours)
            
            time.sleep(30)
            
        except KeyboardInterrupt:
            print("\n\nStopped.")
            break
        except Exception as e:
            print(f"Error: {e}")
            time.sleep(5)

if __name__ == "__main__":
    main()
