// deploy-marker 1778502875
// POST /api/refresh
// Body: { recordIds?: string[], onlyMissing?: boolean }
// Triggers Apify scrape for all (or selected) profiles, writes follower count + avatar URL back to Airtable

export async function onRequestPost(context) {
  const { request, env } = context;

  const required = ['AIRTABLE_TOKEN', 'AIRTABLE_BASE_ID', 'AIRTABLE_TABLE_NAME', 'APIFY_TOKEN'];
  for (const k of required) {
    if (!env[k]) return jsonError(`Missing env: ${k}`, 500);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {}

  // 1) Fetch records from Airtable
  let records;
  try {
    records = await fetchRecords(env);
  } catch (err) {
    return jsonError('Airtable fetch failed: ' + err.message, 500);
  }

  // 2) Filter to relevant subset
  let targets = records.filter(r => {
    const handle = normalizeHandle(r.fields?.['Instagram']);
    return !!handle;
  });

  if (Array.isArray(body.recordIds) && body.recordIds.length > 0) {
    const wanted = new Set(body.recordIds);
    targets = targets.filter(r => wanted.has(r.id));
  }

  if (body.onlyMissing) {
    // "Not yet scraped" = no IG Last Refresh timestamp.
    // Fallback: missing avatar URL also counts (older records before refresh tracking).
    targets = targets.filter(r => !r.fields?.['IG Last Refresh'] && !r.fields?.['IG Avatar URL']);
  }

  if (targets.length === 0) {
    return new Response(JSON.stringify({ ok: true, scraped: 0, updated: 0, message: 'No targets' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 3) Trigger Apify (synchronous run, max 5min)
  const usernames = targets.map(r => normalizeHandle(r.fields['Instagram']));
  let apifyResults;
  try {
    apifyResults = await runApify(env.APIFY_TOKEN, usernames);
  } catch (err) {
    return jsonError('Apify scrape failed: ' + err.message, 500);
  }

  // 4) Build username -> data map
  const dataByHandle = {};
  for (const item of apifyResults) {
    const h = (item.username || '').toLowerCase();
    if (!h) continue;
    dataByHandle[h] = {
      followers: item.followersCount ?? null,
      avatarUrl: item.profilePicUrlHD || item.profilePicUrl || '',
      isPrivate: item.private === true || item.isPrivate === true  // Apify returns "private" or "isPrivate"
    };
  }

  // 5) Build update payloads matched by record
  const updates = [];
  const now = new Date().toISOString();
  for (const r of targets) {
    const handle = normalizeHandle(r.fields['Instagram']).toLowerCase();
    const d = dataByHandle[handle];
    if (!d) continue;

    updates.push({
      id: r.id,
      fields: {
        'IG Followers': d.followers,
        'IG Avatar URL': d.avatarUrl,
        'IG Private': d.isPrivate,
        'IG Last Refresh': now
      }
    });
  }

  // 6) Update Airtable in chunks of 10 (API limit)
  let updatedCount = 0;
  try {
    for (let i = 0; i < updates.length; i += 10) {
      const chunk = updates.slice(i, i + 10);
      const res = await fetch(
        `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_NAME}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ records: chunk, typecast: true })
        }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Airtable ${res.status}: ${text.substring(0, 200)}`);
      }
      updatedCount += chunk.length;
    }
  } catch (err) {
    return jsonError('Airtable update failed: ' + err.message, 500);
  }

  return new Response(JSON.stringify({
    ok: true,
    targets: targets.length,
    scraped: apifyResults.length,
    updated: updatedCount,
    notFound: targets.length - updatedCount
  }), { headers: { 'Content-Type': 'application/json' } });
}

async function fetchRecords(env) {
  const records = [];
  let offset = null;
  const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_NAME}`;
  do {
    const params = new URLSearchParams({ pageSize: '100' });
    if (offset) params.set('offset', offset);
    const res = await fetch(`${url}?${params}`, {
      headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` }
    });
    if (!res.ok) throw new Error(`Airtable ${res.status}`);
    const data = await res.json();
    records.push(...data.records);
    offset = data.offset || null;
  } while (offset);
  return records;
}

function normalizeHandle(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(/^@/, '')
    .replace(/^https?:\/\/(www\.)?instagram\.com\//, '')
    .replace(/\/$/, '')
    .replace(/\?.*$/, '')
    .trim();
}

async function runApify(token, usernames) {
  // Uses official "apify/instagram-profile-scraper" Actor
  // run-sync returns full results in one HTTP call (timeout: 5 min)
  const actorId = 'apify~instagram-profile-scraper';
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${token}&timeout=300`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernames })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apify ${res.status}: ${text.substring(0, 200)}`);
  }

  return await res.json();
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
