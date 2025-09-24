type LWSession = { token: string; host: string; fetchedAt: number };
let cache: LWSession | null = null;

export async function getLW(): Promise<LWSession> {
  const now = Date.now();
  if (cache && (now - cache.fetchedAt) < 1000 * 60 * 25) return cache; // reuse ~25m
  const res = await fetch('https://api.linnworks.net/api/Auth/AuthorizeByApplication', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      ApplicationId: process.env.LINNWORKS_APP_ID,
      ApplicationSecret: process.env.LINNWORKS_APP_SECRET,
      Token: process.env.LINNWORKS_INSTALL_TOKEN,
    }),
  });
  if (!res.ok) throw new Error('Linnworks auth failed');
  const data = await res.json(); // { Token, Server }
  cache = { token: data.Token, host: data.Server, fetchedAt: now };
  return cache!;
}
