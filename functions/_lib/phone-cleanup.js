// deploy-marker 1778520624
// Phone normalization using country-specific MOBILE-ONLY prefix patterns.

const MOBILE_PATTERNS = [
  // ============== DACH ==============
  { country: 'DE', cc: '49', pattern: /^0?15\d{8,9}$/, strip: 1, name: 'DE Mobile 015x' },
  { country: 'DE', cc: '49', pattern: /^0?16[023]\d{7,8}$/, strip: 1, name: 'DE Mobile 016x' },
  { country: 'DE', cc: '49', pattern: /^0?17\d{8,9}$/, strip: 1, name: 'DE Mobile 017x' },
  { country: 'AT', cc: '43', pattern: /^0?6(?:50|6[047]|7[67]|8[018]|99)\d{6,8}$/, strip: 1, name: 'AT Mobile' },
  { country: 'CH', cc: '41', pattern: /^0?7[4-9]\d{7}$/, strip: 1, name: 'CH Mobile' },

  // ============== Europe ==============
  { country: 'FR', cc: '33', pattern: /^0?[67]\d{8}$/, strip: 1, name: 'FR Mobile', tlds: ['fr'] },
  { country: 'GB', cc: '44', pattern: /^0?7[1-9]\d{8}$/, strip: 1, name: 'UK Mobile', tlds: ['uk', 'co.uk', 'gb'] },
  { country: 'IT', cc: '39', pattern: /^3\d{8,9}$/, strip: 0, name: 'IT Mobile', requireTld: true, tlds: ['it'] },
  { country: 'ES', cc: '34', pattern: /^[67]\d{8}$/, strip: 0, name: 'ES Mobile', requireTld: true, tlds: ['es'] },
  { country: 'NL', cc: '31', pattern: /^0?6\d{8}$/, strip: 1, name: 'NL Mobile', requireTld: true, tlds: ['nl'] },
  { country: 'BE', cc: '32', pattern: /^0?4[5-9]\d{7}$/, strip: 1, name: 'BE Mobile', requireTld: true, tlds: ['be'] },
  { country: 'PT', cc: '351', pattern: /^9[1236]\d{7}$/, strip: 0, name: 'PT Mobile', requireTld: true, tlds: ['pt'] },
  { country: 'IE', cc: '353', pattern: /^0?8[3-9]\d{7}$/, strip: 1, name: 'IE Mobile', requireTld: true, tlds: ['ie'] },
  { country: 'SE', cc: '46', pattern: /^0?7[02369]\d{7}$/, strip: 1, name: 'SE Mobile', requireTld: true, tlds: ['se'] },
  { country: 'NO', cc: '47', pattern: /^[49]\d{7}$/, strip: 0, name: 'NO Mobile', requireTld: true, tlds: ['no'] },
  { country: 'DK', cc: '45', pattern: /^[2-9]\d{7}$/, strip: 0, name: 'DK Mobile', requireTld: true, tlds: ['dk'] },
  { country: 'PL', cc: '48', pattern: /^[4-8]\d{8}$/, strip: 0, name: 'PL Mobile', requireTld: true, tlds: ['pl'] },
  { country: 'CZ', cc: '420', pattern: /^[67]\d{8}$/, strip: 0, name: 'CZ Mobile', requireTld: true, tlds: ['cz'] },
  { country: 'GR', cc: '30', pattern: /^69\d{8}$/, strip: 0, name: 'GR Mobile', requireTld: true, tlds: ['gr'] },

  // ============== Middle East ==============
  { country: 'AE', cc: '971', pattern: /^0?5[024568]\d{7}$/, strip: 1, name: 'UAE Mobile', tlds: ['ae'] },
  { country: 'SA', cc: '966', pattern: /^0?5\d{8}$/, strip: 1, name: 'SA Mobile', tlds: ['sa'] },
  { country: 'TR', cc: '90', pattern: /^0?5\d{9}$/, strip: 1, name: 'TR Mobile', tlds: ['tr'] },
  { country: 'IL', cc: '972', pattern: /^0?5[0-9]\d{7}$/, strip: 1, name: 'IL Mobile', tlds: ['il'] },

  // ============== North America ==============
  { country: 'US', cc: '1', pattern: /^[2-9]\d{2}[2-9]\d{6}$/, strip: 0, name: 'US/CA', tlds: ['us', 'ca'] },

  // ============== APAC ==============
  // NOTE: AU/NZ patterns are restrictive — they require .au/.nz TLD to match (avoid false-positives with DE 0211 etc.)
  { country: 'AU', cc: '61', pattern: /^0?4\d{8}$/, strip: 1, name: 'AU Mobile', tlds: ['au'], requireTld: true },
  { country: 'NZ', cc: '64', pattern: /^0?2[01278]\d{6,9}$/, strip: 1, name: 'NZ Mobile', tlds: ['nz'], requireTld: true },
  { country: 'JP', cc: '81', pattern: /^0?[789]0\d{8}$/, strip: 1, name: 'JP Mobile', tlds: ['jp'] },
  { country: 'CN', cc: '86', pattern: /^1[3-9]\d{9}$/, strip: 0, name: 'CN Mobile', tlds: ['cn'] },

  // ============== With country code (no +) ==============
  { country: 'DE', cc: '49', pattern: /^491[567]\d{8,9}$/, strip: 0, name: 'DE Mobile (no +)', skipCcPrefix: true },
  { country: 'AT', cc: '43', pattern: /^436(?:50|6[047]|7[67]|8[018]|99)\d{6,7}$/, strip: 0, name: 'AT Mobile (no +)', skipCcPrefix: true },
  { country: 'CH', cc: '41', pattern: /^417[4-9]\d{7}$/, strip: 0, name: 'CH Mobile (no +)', skipCcPrefix: true },
  { country: 'FR', cc: '33', pattern: /^33[67]\d{8}$/, strip: 0, name: 'FR Mobile (no +)', skipCcPrefix: true },
  { country: 'GB', cc: '44', pattern: /^447[1-9]\d{8}$/, strip: 0, name: 'UK Mobile (no +)', skipCcPrefix: true },
  { country: 'AE', cc: '971', pattern: /^9715[024568]\d{7}$/, strip: 0, name: 'UAE Mobile (no +)', skipCcPrefix: true },
];

function tldFromEmail(email) {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  if (at < 0) return null;
  const domain = email.slice(at + 1).toLowerCase().trim();
  if (!domain) return null;
  if (domain.endsWith('.co.uk')) return 'co.uk';
  const lastDot = domain.lastIndexOf('.');
  if (lastDot < 0) return null;
  return domain.slice(lastDot + 1);
}

export function cleanupPhone(rawPhone, emailHint) {
  const original = (rawPhone || '').trim();
  if (!original) {
    return { original: '', cleaned: '', status: 'empty', action: 'No phone', country: null, valid: false };
  }

  let stripped = original.replace(/[^\d+]/g, '');
  if (!stripped) {
    return { original, cleaned: '', status: 'invalid', action: 'No digits', country: null, valid: false };
  }

  if (stripped.startsWith('00')) stripped = '+' + stripped.slice(2);

  if (stripped.startsWith('+')) {
    const digits = stripped.slice(1);
    if (!/^\d{8,15}$/.test(digits)) {
      return { original, cleaned: stripped, status: 'needs_review', action: 'Has + but invalid format', country: null, valid: false };
    }
    const detected = detectCountryFromE164(digits);
    // If original has ANY formatting (whitespace, dashes, parens, etc.), report as 'ok' so user sees it in preview
    const hadFormatting = original !== stripped;
    if (!hadFormatting) {
      return { original, cleaned: stripped, status: 'unchanged', action: 'Already E.164', country: detected, valid: true };
    }
    return { original, cleaned: stripped, status: 'ok', action: 'Removed spaces/formatting', country: detected, valid: true };
  }

  const tld = tldFromEmail(emailHint);
  const matches = MOBILE_PATTERNS.filter(p => {
    if (!p.pattern.test(stripped)) return false;
    // Skip TLD-only patterns when no matching TLD
    if (p.requireTld && (!tld || !p.tlds || !p.tlds.includes(tld))) return false;
    return true;
  });

  if (matches.length === 0) {
    return {
      original, cleaned: stripped, status: 'needs_review',
      action: 'No country mobile pattern matches', country: null, valid: false
    };
  }

  if (matches.length === 1) {
    const m = matches[0];
    const local = m.skipCcPrefix ? stripped : stripped.slice(m.strip);
    const cleaned = m.skipCcPrefix ? '+' + stripped : '+' + m.cc + local;
    return { original, cleaned, status: 'detected', action: m.name, country: m.country, valid: true };
  }

  if (tld) {
    const tldMatch = matches.find(m => m.tlds && m.tlds.includes(tld));
    if (tldMatch) {
      const local = tldMatch.skipCcPrefix ? stripped : stripped.slice(tldMatch.strip);
      const cleaned = tldMatch.skipCcPrefix ? '+' + stripped : '+' + tldMatch.cc + local;
      return {
        original, cleaned, status: 'detected',
        action: `${tldMatch.name} (.${tld} email)`, country: tldMatch.country, valid: true
      };
    }
  }

  const m = matches[0];
  const local = m.skipCcPrefix ? stripped : stripped.slice(m.strip);
  const cleaned = m.skipCcPrefix ? '+' + stripped : '+' + m.cc + local;
  return {
    original, cleaned, status: 'likely',
    action: `${m.name} (ambiguous: ${matches.slice(1, 3).map(x => x.country).join('/')})`,
    country: m.country, valid: true
  };
}

function detectCountryFromE164(digits) {
  const codes = [
    ['971', 'AE'], ['966', 'SA'], ['972', 'IL'], ['420', 'CZ'], ['351', 'PT'], ['353', 'IE'],
    ['49', 'DE'], ['43', 'AT'], ['41', 'CH'], ['33', 'FR'], ['44', 'GB'], ['39', 'IT'], ['34', 'ES'],
    ['31', 'NL'], ['32', 'BE'], ['46', 'SE'], ['47', 'NO'], ['45', 'DK'], ['48', 'PL'], ['30', 'GR'],
    ['90', 'TR'], ['61', 'AU'], ['64', 'NZ'], ['81', 'JP'], ['86', 'CN'], ['1', 'US/CA']
  ];
  for (const [code, country] of codes) {
    if (digits.startsWith(code)) return country;
  }
  return null;
}

export function validateCleaned(cleaned) {
  if (!cleaned) return { valid: false, reason: 'empty' };
  if (!cleaned.startsWith('+')) return { valid: false, reason: 'missing country code' };
  const digits = cleaned.slice(1);
  if (!/^\d{8,15}$/.test(digits)) return { valid: false, reason: 'invalid format' };
  return { valid: true, reason: '' };
}
