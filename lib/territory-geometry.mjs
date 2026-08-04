/**
 * Renders GeoJSON Polygon/MultiPolygon geometry as SVG paths, with a plain
 * linear fit-to-viewBox projection — no map tiles, no external library, no
 * runtime network request. Good enough at the scale of a single country:
 * Romania spans a small enough angular range that a proper cartographic
 * projection wouldn't visibly change the shapes at this size, and every
 * geometry on the page already shares the same projection, so relative
 * shape/position between counties or UAT-uri stays correct either way.
 */

export function parseGeometry(value) {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return parseGeometry(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (typeof value !== "object") return null;
  if (value.type === "Polygon" || value.type === "MultiPolygon") {
    if (Array.isArray(value.coordinates)) return value;
  }
  return null;
}

function exteriorRings(geometry) {
  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates;
    return rings[0] ? [rings[0]] : [];
  }
  return geometry.coordinates.map((polygon) => polygon[0]).filter((ring) => Array.isArray(ring));
}

function exteriorPoints(geometry) {
  return exteriorRings(geometry).flat();
}

export function getBounds(geometries) {
  const points = geometries.flatMap((geometry) => exteriorPoints(geometry));
  if (!points.length) return null;
  return points.reduce(
    (bounds, [x, y]) => ({
      minX: Math.min(bounds.minX, x),
      minY: Math.min(bounds.minY, y),
      maxX: Math.max(bounds.maxX, x),
      maxY: Math.max(bounds.maxY, y)
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );
}

function projection(bounds, width, height, padding) {
  const spanX = Math.max(bounds.maxX - bounds.minX, 0.000001);
  const spanY = Math.max(bounds.maxY - bounds.minY, 0.000001);
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  return (x, y) => [offsetX + (x - bounds.minX) * scale, height - (offsetY + (y - bounds.minY) * scale)];
}

export function geometryPath(geometry, bounds, width, height, padding = 18) {
  const project = projection(bounds, width, height, padding);
  return exteriorRings(geometry)
    .map(
      (ring) =>
        ring
          .map(([x, y], index) => {
            const [px, py] = project(x, y);
            return `${index === 0 ? "M" : "L"}${px.toFixed(2)},${py.toFixed(2)}`;
          })
          .join(" ") + " Z"
    )
    .join(" ");
}

/**
 * Approximate label/hover anchor: the average of a shape's exterior-ring
 * vertices, projected into the same pixel space as geometryPath. Good
 * enough to place a compact tooltip inside a shape on a small map; not a
 * true polygon centroid (which would need per-ring signed-area weighting).
 */
export function geometryLabelPoint(geometry, bounds, width, height, padding = 18) {
  const project = projection(bounds, width, height, padding);
  const points = exteriorPoints(geometry);
  if (points.length === 0) return [width / 2, height / 2];
  const [sumX, sumY] = points.reduce(([ax, ay], [x, y]) => [ax + x, ay + y], [0, 0]);
  return project(sumX / points.length, sumY / points.length);
}
