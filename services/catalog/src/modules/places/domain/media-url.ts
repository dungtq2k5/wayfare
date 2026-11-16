/** A stored object's public URL: the media base, then the path (api-endpoints-plan §0.7). */
export function mediaUrl(publicBaseUrl: string, objectPath: string): string {
  const path = objectPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${publicBaseUrl}/${path}`;
}
