export function handleHealth(): Response {
  return new Response(
    JSON.stringify({
      status: "healthy",
      service: "purelife-api",
      timestamp: new Date().toISOString(),
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
