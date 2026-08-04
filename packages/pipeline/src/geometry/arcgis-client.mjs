import { AcquisitionError } from "../acquisition/errors.mjs";
import { assertSafeTarget } from "../acquisition/network-policy.mjs";

const RETRYABLE_STATUSES = new Set([408, 425, 429]);

const defaultSleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function retryDelay(attempt) {
  return Math.min(500 * 2 ** (attempt - 1), 8000);
}

/**
 * A single ArcGIS FeatureServer query: SSRF-safe (host/protocol/port
 * allowlist + DNS-resolves-to-public-IP, same policy every other source
 * fetch in this pipeline goes through), POST'd form-encoded (ArcGIS's own
 * REST convention — GET with a long objectIds list hits URL-length limits),
 * with an explicit byte cap and timeout, retried on transient failures.
 */
export async function queryFeatureServer(source, path, parameters, options = {}) {
  const dependencies = {
    fetchImpl: options.fetchImpl ?? fetch,
    resolver: options.resolver,
    sleep: options.sleep ?? defaultSleep
  };
  const url = `${source.featureServerUrl}/${path}`;

  let lastError;
  for (let attempt = 1; attempt <= source.maxAttempts; attempt += 1) {
    try {
      const safeTarget = await assertSafeTarget(url, source, dependencies.resolver);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), source.timeoutMs);
      let response;
      try {
        response = await dependencies.fetchImpl(safeTarget.url, {
          method: "POST",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
            accept: "application/json",
            "user-agent": "teritoriu.digital-geometry-acquisition/1.0"
          },
          body: new URLSearchParams(parameters)
        });
      } finally {
        clearTimeout(timeout);
      }

      if (response.status < 200 || response.status >= 300) {
        const retryable = RETRYABLE_STATUSES.has(response.status) || response.status >= 500;
        throw new AcquisitionError("HTTP_STATUS", `ArcGIS returned HTTP ${response.status}`, {
          retryable,
          context: { status: response.status, path }
        });
      }

      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (Number.isFinite(contentLength) && contentLength > source.maxBytes) {
        await response.body?.cancel();
        throw new AcquisitionError("SIZE_LIMIT_EXCEEDED", `Response exceeds the ${source.maxBytes} byte limit`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > source.maxBytes) {
        throw new AcquisitionError("SIZE_LIMIT_EXCEEDED", `Response exceeds the ${source.maxBytes} byte limit`);
      }

      let json;
      try {
        json = JSON.parse(bytes.toString("utf8"));
      } catch (cause) {
        throw new AcquisitionError("INVALID_JSON", "ArcGIS response was not valid JSON", { cause });
      }
      if (json?.error) {
        throw new AcquisitionError(
          "ARCGIS_ERROR",
          json.error.message ?? "ArcGIS returned an error payload",
          { context: { code: json.error.code, path } }
        );
      }

      return { json, sizeBytes: bytes.length, requestedUrl: url, resolvedUrl: safeTarget.url.href };
    } catch (error) {
      const normalized =
        error instanceof AcquisitionError
          ? error
          : error?.name === "AbortError"
            ? new AcquisitionError("TIMEOUT", `Request exceeded ${source.timeoutMs} ms`, { retryable: true })
            : new AcquisitionError("NETWORK_FAILED", "Network request failed", { cause: error, retryable: true });
      lastError = normalized;
      if (!normalized.retryable || attempt === source.maxAttempts) throw normalized;
      await dependencies.sleep(retryDelay(attempt));
    }
  }
  throw lastError;
}

export async function fetchObjectIds(source, options = {}) {
  const result = await queryFeatureServer(
    source,
    "query",
    { where: "1=1", returnIdsOnly: "true", f: "json" },
    options
  );
  const ids = result.json?.objectIds ?? [];
  if (!Array.isArray(ids) || ids.length < source.minExpectedObjectCount) {
    throw new AcquisitionError(
      "OBJECT_COUNT_TOO_LOW",
      `ArcGIS returned only ${ids.length} object IDs, expected at least ${source.minExpectedObjectCount}`
    );
  }
  return { ids: [...ids].sort((a, b) => a - b), ...result };
}

export async function fetchFeatureBatch(source, ids, options = {}) {
  const result = await queryFeatureServer(
    source,
    "query",
    {
      objectIds: ids.join(","),
      outFields: "OBJECTID,featureId,name_1,name_2,name_3,nationalCode,nationalLevel,upperLevelUnit",
      returnGeometry: "true",
      outSR: "4326",
      geometryPrecision: "5",
      maxAllowableOffset: "0.00025",
      f: "geojson"
    },
    options
  );
  return { features: result.json?.features ?? [], ...result };
}

/**
 * Fetches every feature from the FeatureServer, batched by
 * source.queryBatchSize object IDs per request (a single query for all
 * ~3200 UAT+county polygons would exceed ArcGIS's own per-request limits).
 */
export async function fetchAllFeatures(source, options = {}) {
  const objectIdResult = await fetchObjectIds(source, options);
  const features = [];
  let attempts = 0;
  let lastResponse = objectIdResult;

  for (let index = 0; index < objectIdResult.ids.length; index += source.queryBatchSize) {
    const batch = objectIdResult.ids.slice(index, index + source.queryBatchSize);
    const batchResult = await fetchFeatureBatch(source, batch, options);
    features.push(...batchResult.features);
    attempts += 1;
    lastResponse = batchResult;
    options.onProgress?.(Math.min(index + batch.length, objectIdResult.ids.length), objectIdResult.ids.length);
  }

  return {
    features,
    objectCount: objectIdResult.ids.length,
    attempts,
    requestedUrl: lastResponse.requestedUrl,
    resolvedUrl: lastResponse.resolvedUrl
  };
}
