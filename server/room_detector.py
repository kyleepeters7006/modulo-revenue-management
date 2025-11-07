import cv2
import numpy as np
import json
import sys
from shapely.geometry import Polygon

# room size thresholds as fraction of image size
MIN_ROOM_AREA_FRAC = 0.0003
MAX_ROOM_AREA_FRAC = 0.02

def remove_green_and_dark(img_bgr):
    """Roughly drop trees/grass/parking/background using HSV + brightness."""
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[:,:,0], hsv[:,:,1], hsv[:,:,2]

    # green mask (trees/grass)
    green_mask = ((h > 35) & (h < 90) & (s > 40))

    # very dark/low-sat mask (asphalt etc)
    dark_mask = (v < 80) | (s < 25)

    # we keep pixels that are NOT green and NOT very dark
    keep_mask = ~(green_mask | dark_mask)

    cleaned = img_bgr.copy()
    cleaned[~keep_mask] = (0, 0, 0)
    return cleaned

def get_building_mask(cleaned):
    """Get a coarse mask of the main building block."""
    gray = cv2.cvtColor(cleaned, cv2.COLOR_BGR2GRAY)
    _, th = cv2.threshold(gray, 0, 255, cv2.THRESH_OTSU)
    # Morphologically close gaps
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7,7))
    th = cv2.morphologyEx(th, cv2.MORPH_CLOSE, kernel, iterations=2)

    # Keep largest connected component (assume that's the building)
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(th, connectivity=8)
    if num_labels <= 1:
        return th

    largest_label = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
    building_mask = np.uint8(labels == largest_label) * 255
    return building_mask

def find_room_polygons(img_bgr, building_mask):
    h, w, _ = img_bgr.shape
    img_area = h * w

    # focus only on building region
    masked = cv2.bitwise_and(img_bgr, img_bgr, mask=building_mask)
    gray = cv2.cvtColor(masked, cv2.COLOR_BGR2GRAY)

    # emphasize edges & regions
    blur = cv2.GaussianBlur(gray, (5,5), 0)
    edges = cv2.Canny(blur, 40, 120)

    # close edges to form closed shapes
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3,3))
    closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)
    filled = cv2.morphologyEx(closed, cv2.MORPH_DILATE, kernel, iterations=1)

    # find contours on filled shapes
    contours, _ = cv2.findContours(filled, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    room_polys = []
    for c in contours:
        area = cv2.contourArea(c)
        if area <= 0:
            continue

        # area filter
        if area < MIN_ROOM_AREA_FRAC * img_area or area > MAX_ROOM_AREA_FRAC * img_area:
            continue

        # bounding box shape filter
        x, y, bw, bh = cv2.boundingRect(c)
        aspect = max(bw, bh) / max(1.0, min(bw, bh))
        if aspect > 6:  # too skinny/long = likely corridor/label
            continue

        # rectangularity filter
        rect_area = bw * bh
        rect_score = area / rect_area if rect_area > 0 else 0
        if rect_score < 0.4:  # very irregular, probably junk
            continue

        # must be inside building mask
        mask_patch = building_mask[y:y+bh, x:x+bw]
        if np.mean(mask_patch > 0) < 0.5:
            continue

        # polygon approximation
        epsilon = 0.02 * cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, epsilon, True)

        # shapely sanity check (valid polygon)
        pts = [(int(p[0][0]), int(p[0][1])) for p in approx]
        if len(pts) < 3:
            continue

        poly = Polygon(pts)
        if not poly.is_valid or poly.area <= 0:
            continue

        room_polys.append(pts)

    return room_polys

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No image path provided"}))
        sys.exit(1)
    
    image_path = sys.argv[1]
    
    try:
        img = cv2.imread(image_path)
        if img is None:
            print(json.dumps({"error": f"Could not read image: {image_path}"}))
            sys.exit(1)

        cleaned = remove_green_and_dark(img)
        building_mask = get_building_mask(cleaned)
        rooms = find_room_polygons(img, building_mask)

        data = {
            "image_width": img.shape[1],
            "image_height": img.shape[0],
            "rooms": [
                {"id": i + 1, "points": pts}
                for i, pts in enumerate(rooms)
            ]
        }

        print(json.dumps(data))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
