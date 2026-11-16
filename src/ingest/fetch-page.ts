export async function fetchPage(url: string, timeout: number = 10_000) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}. HTTP: ${response.status}.`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    throw new Error(
      `Unexpected content type for ${url}: ${response.headers.get("content-type")}`,
    );
  }

  return await response.text();
}
