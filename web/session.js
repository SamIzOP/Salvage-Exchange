// Transport-independent guards used by the live client and its regression tests.
export function isCurrentResponse(current, incoming, requested, active) {
  if (!active || !requested || requested.code !== active.code || requested.key !== active.key ||
      requested.generation !== active.generation || incoming.code !== active.code) return false;
  return !current || current.code !== incoming.code || current.you.seat !== incoming.you.seat ||
    incoming.version >= current.version;
}

export function snapshotCommand(value) {
  return structuredClone(value);
}
