import { geometryPath, getBounds, parseGeometry } from "@/lib/territory-geometry.mjs";

const WIDTH = 640;
const HEIGHT = 420;

// A rough, hand-simplified outline — decorative fallback only, not derived
// from any ANCPI source, shown only when no real county geometry is
// available yet.
const ROMANIA_SILHOUETTE =
  "M91 178 128 119l83-37 67 22 56-55 68 25 45 62 84 30 31 70-41 64-84 8-44 50-80-24-67 33-56-37-69-7-37-61z";

export function NationalMap({ counties }) {
  const items = counties
    .map((county) => ({ county, geometry: parseGeometry(county.geometry) }))
    .filter((item) => item.geometry);

  if (items.length === 0) {
    return (
      <div className="nationalMapFallback" role="note">
        <svg viewBox="0 0 640 420" aria-hidden="true" className="nationalMapSilhouette">
          <path d={ROMANIA_SILHOUETTE} />
        </svg>
        <p>Contururile teritoriale ale județelor nu sunt încă disponibile.</p>
      </div>
    );
  }

  const bounds = getBounds(items.map((item) => item.geometry));

  return (
    <figure className="nationalMap" aria-label="Harta interactivă a județelor României">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" focusable="false">
        <title>Județele României</title>
        {items.map(({ county, geometry }) => (
          <a key={county.territoryId} href={county.path} aria-label={county.officialName}>
            <path
              className="nationalMapShape"
              d={geometryPath(geometry, bounds, WIDTH, HEIGHT, 24)}
              fillRule="nonzero"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            >
              <title>{county.officialName}</title>
            </path>
          </a>
        ))}
      </svg>
    </figure>
  );
}
