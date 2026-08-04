import { geometryLabelPoint, geometryPath, getBounds, parseGeometry } from "@/lib/territory-geometry.mjs";

const WIDTH = 640;
const HEIGHT = 460;

export function UatMap({ countyGeometry, label, units }) {
  const county = parseGeometry(countyGeometry);
  const shapes = units
    .map((unit) => ({ unit, geometry: parseGeometry(unit.geometry) }))
    .filter((item) => item.geometry);

  if (shapes.length === 0) {
    return (
      <div className="uatMapFallback" role="note">
        <p>Harta interactivă nu este încă disponibilă pentru {label}.</p>
        <p>Lista completă a UAT-urilor rămâne accesibilă mai jos.</p>
      </div>
    );
  }

  const allGeometries = [county, ...shapes.map((item) => item.geometry)].filter(Boolean);
  const bounds = getBounds(allGeometries);
  const countyPath = county ? geometryPath(county, bounds, WIDTH, HEIGHT, 20) : null;
  const missingCount = units.length - shapes.length;

  return (
    <figure className="uatMap" aria-label={`Harta UAT-urilor din ${label}`}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        {countyPath ? (
          <path
            className="uatMapCountyOutline"
            d={countyPath}
            fillRule="nonzero"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {shapes.map(({ unit, geometry }) => {
          const [labelX, labelY] = geometryLabelPoint(geometry, bounds, WIDTH, HEIGHT, 20);
          return (
            <a key={unit.territoryId} href={unit.path} className="uatMapShapeLink" aria-label={unit.officialName}>
              <title>{unit.officialName}</title>
              <path
                className="uatMapShape"
                d={geometryPath(geometry, bounds, WIDTH, HEIGHT, 20)}
                fillRule="nonzero"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              <g className="uatMapShapeLabel" transform={`translate(${labelX.toFixed(2)},${labelY.toFixed(2)})`}>
                <rect x="-2" y="-13" width={unit.officialName.length * 5.2 + 12} height="18" rx="4" />
                <text x="4" y="1" dominantBaseline="middle">
                  {unit.officialName}
                </text>
              </g>
            </a>
          );
        })}
      </svg>
      {missingCount > 0 ? (
        <p className="uatMapNote">
          {missingCount === 1
            ? "1 UAT nu are încă un contur disponibil și apare doar în lista de mai jos."
            : `${missingCount} UAT-uri nu au încă un contur disponibil și apar doar în lista de mai jos.`}
        </p>
      ) : null}
    </figure>
  );
}
