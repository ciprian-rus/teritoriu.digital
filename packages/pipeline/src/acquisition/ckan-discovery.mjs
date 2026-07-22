import { AcquisitionError } from "./errors.mjs";
import { downloadSnapshot } from "./downloader.mjs";

export async function discoverCkanResource(source, dependencies = {}) {
  const apiUrl = new URL(source.ckanApiUrl);
  apiUrl.searchParams.set("id", source.ckanPackageId);

  const response = await downloadSnapshot(
    {
      ...source,
      resourceUrl: apiUrl.href,
      expectedDetectedMediaTypes: ["application/json"],
      maxBytes: Math.min(source.maxBytes, 2 * 1024 * 1024),
      maxRedirects: Math.min(source.maxRedirects, 2)
    },
    dependencies
  );

  let document;
  try {
    document = JSON.parse(response.bytes.toString("utf8"));
  } catch (cause) {
    throw new AcquisitionError("CKAN_JSON_INVALID", "CKAN discovery returned invalid JSON", {
      cause
    });
  }
  if (document.success !== true || !Array.isArray(document.result?.resources)) {
    throw new AcquisitionError("CKAN_RESPONSE_INVALID", "CKAN discovery response has an invalid shape");
  }

  const resource = document.result.resources.find((item) => item.id === source.resourceId);
  if (!resource) {
    throw new AcquisitionError(
      "CKAN_RESOURCE_MISSING",
      `Configured CKAN resource ${source.resourceId} is no longer present`
    );
  }
  if (resource.state && resource.state !== "active") {
    throw new AcquisitionError("CKAN_RESOURCE_INACTIVE", "Configured CKAN resource is not active");
  }

  let discoveredUrl;
  try {
    discoveredUrl = new URL(resource.url).href;
  } catch (cause) {
    throw new AcquisitionError("CKAN_RESOURCE_URL_INVALID", "CKAN resource URL is invalid", {
      cause
    });
  }
  if (discoveredUrl !== new URL(source.resourceUrl).href) {
    throw new AcquisitionError(
      "CKAN_RESOURCE_URL_CHANGED",
      "CKAN resource URL changed and requires a reviewed source configuration update",
      { context: { discoveredUrl } }
    );
  }

  return {
    resourceUrl: discoveredUrl,
    discoverySha256: response.sha256,
    packageId: document.result.name ?? source.ckanPackageId,
    resource: {
      id: resource.id,
      name: resource.name ?? null,
      format: resource.format ?? null,
      mimetype: resource.mimetype ?? null,
      size: resource.size ?? null,
      lastModified: resource.last_modified ?? null,
      revisionId: resource.revision_id ?? null
    }
  };
}
