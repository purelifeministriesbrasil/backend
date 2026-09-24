export function handleHealth(): Response {
  return new Response(
    JSON.stringify({
      status: "healthy",
      service: "purelife-api",
      timestamp: new Date().toISOString(),
      version: "5.0.0",
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    }
  );
}
