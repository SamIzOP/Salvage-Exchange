// Optional sound cues, synthesised in the browser: no audio files, nothing to license. Off until
// the player turns them on from the menu, and nothing ever plays before that choice.
let ctx = null, on = false;

export const soundOn = () => on;

export function setSound(value) {
  on = !!value;
  if (on && !ctx) {
    try { ctx = new AudioContext(); } catch { on = false; }
  }
  ctx?.resume?.().catch(() => {});
  return on;
}

function tone(freq, {at = 0, dur = .12, type = 'sine', gain = .06, to = null} = {}) {
  const t = ctx.currentTime + at, osc = ctx.createOscillator(), amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(gain, t + .01);
  amp.gain.exponentialRampToValueAtTime(.0001, t + dur);
  osc.connect(amp).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + .02);
}

const CUES = {
  dispatch: () => tone(330, {to: 660, dur: .14, type: 'triangle'}),
  scan: () => { tone(880, {dur: .08}); tone(1320, {at: .09, dur: .1}); },
  lock: () => { tone(220, {dur: .07, type: 'square', gain: .03}); tone(165, {at: .08, dur: .12, type: 'square', gain: .03}); },
  hazard: () => tone(180, {to: 90, dur: .32, type: 'sawtooth', gain: .025}),
  dock: () => tone(120, {to: 70, dur: .2, type: 'triangle', gain: .08}),
  settle: () => { tone(392, {dur: .4, gain: .04}); tone(523.25, {at: .04, dur: .4, gain: .035}); },
};

export function cue(name) {
  if (!on || !ctx || ctx.state !== 'running') return;
  try { CUES[name]?.(); } catch {}
}
