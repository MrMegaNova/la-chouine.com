// Codes d'invitation (#295, #306) : format court, ou ancien format toujours accepté.
const INVITE_CODE_RE = /^([2-9a-hjkmnp-z]{6}|[0-9a-f]{32})$/i;

export function isInviteCode(value: string): boolean {
  return INVITE_CODE_RE.test(value);
}

export function invitePath(code: string): string {
  return `/i/${code}`;
}

/** Lien affiché, sans le protocole : plus court à lire et à recopier. */
export function displayInviteUrl(url: string): string {
  return url.replace(/^https?:\/\//, '');
}
