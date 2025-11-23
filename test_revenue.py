#!/usr/bin/env python3
import json
import urllib.request

try:
    # Test overview endpoint
    response = urllib.request.urlopen('http://localhost:5000/api/overview')
    data = json.loads(response.read())
    
    # Extract key revenue metrics
    current = data.get('currentAnnualRevenue', 0)
    potential = data.get('potentialAnnualRevenue', 0)
    occupied = data.get('occupiedUnits', 0)
    total = data.get('totalUnits', 0)
    
    print('=== Revenue Calculation Test Results ===')
    print(f'Current Annual Revenue: ${current:,.2f}')
    print(f'Potential Annual Revenue: ${potential:,.2f}')
    print(f'Occupied Units: {occupied:,}')
    print(f'Total Units: {total:,}')
    print(f'Occupancy Rate: {occupied/total*100:.1f}%' if total > 0 else 'N/A')
    print(f'Revenue Gap: ${potential - current:,.2f}')
    print()
    print('Expected behavior verification:')
    print(f'✓ Current revenue only from occupied units' if current < potential else '✗ Current revenue calculation may be wrong')
    print(f'✓ Potential revenue shows 100% occupancy' if potential > current else '✗ Potential revenue should be higher')
    print(f'✓ Revenue gap ({(potential-current)/potential*100:.1f}%) shows vacancy impact' if potential > current else '✗ No revenue gap')
    
except Exception as e:
    print(f'Error: {e}')