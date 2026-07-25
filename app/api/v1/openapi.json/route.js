import spec from "@/openapi/v1.json";

export async function GET() {
  return Response.json(spec, {
    headers: { "Cache-Control": "public, max-age=3600" }
  });
}
