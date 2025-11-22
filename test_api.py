import json
import urllib.request

url = 'http://localhost:5000/api/rate-card?location=Anderson%20-%20112'
with urllib.request.urlopen(url) as response:
    data = json.loads(response.read())
    
total = len(data['units'])
al_units = [u for u in data['units'] if u.get('serviceLine') == 'AL']
al_with_comp = [u for u in al_units if u.get('competitorName')]

print(f"Total units for Anderson-112: {total}")
print(f"AL units: {len(al_units)}")  
print(f"AL with competitor: {len(al_with_comp)}")
if al_with_comp:
    sample = al_with_comp[0]
    print(f"Sample: Unit {sample['roomNumber']} - {sample.get('competitorName')} (${sample.get('competitorBaseRate')})")
