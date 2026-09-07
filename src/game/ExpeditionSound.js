import { OceanSound } from '../underwater/OceanSound.js';
import { distance } from './Simulation.js';
import { breathEnvelope } from './DiverBreath.js';
import { CrewFootsteps } from './CrewFootsteps.js';
import { Vector3 } from 'three';
import { RADIO_STATION } from './RadioStation.js';
import { anchorDeployment, WINDLASS_POSITION } from './Anchoring.js';

const ENGINE_POSITION = [0, .3, -3.6];

export function engineSpatialMix(source, listener, right) {
  const x = source.x - listener.x, y = source.y - listener.y, z = source.z - listener.z, range = Math.hypot(x, y, z);
  return { pan: Math.max(-.75, Math.min(.75, (x * right.x + y * right.y + z * right.z) / Math.max(4, range))),
    proximity: 1 / (1 + (range / 25) ** 2) };
}

export function vesselSoundMix(w, p, engineSpace, anchorSpace) {
  const submerged = p.mode === 'diver' && p.y < -.4;
  const range = p.mode === 'diver' ? Math.hypot(p.x - w.ship.x, p.y, p.z - w.ship.z) : 0;
  const proximity = 1 / (1 + (range / 25) ** 2);
  const speed = Math.min(1, Math.abs(w.ship.speed) / 10);
  return {
    engine: (.035 + speed * .09) * (engineSpace?.proximity ?? proximity) * (submerged ? .5 : 1),
    enginePan: engineSpace?.pan ?? 0,
    engineHz: 30 + speed * 32,
    cutoff: submerged ? 160 : 420 + speed * 350,
    winch: w.winch && w.ship.anchor && w.cargo.attached && !w.cargo.recovered && distance(w.ship, w.cargo) < 34 ? .05 * proximity : 0,
    anchor: Math.abs(anchorDeployment(w.ship) - Number(w.ship.anchor)) > 1e-6 ? .075 * (anchorSpace?.proximity ?? proximity) * (submerged ? .45 : 1) : 0,
    anchorPan: anchorSpace?.pan ?? 0,
    anchorHz: w.ship.anchor ? 85 : 115,
    anchorCutoff: submerged ? 220 : 1400,
    anchorRattle: .16 + .48 * (.5 + .5 * Math.cos(anchorDeployment(w.ship) * 192)) ** 6,
    breath: submerged ? .16 : 0,
    rain: submerged ? .008 * w.storm : .1 * w.storm,
  };
}

// Reuse the original ocean's surf, reef and distant wildlife soundscape. The
// vessel and diver layers share its context, mute gate and output limiter.
export class ExpeditionSound {
  constructor(app) {
    this.ambient = new OceanSound(app); this.ambient.volume = .5;
    this.last = null; this.footsteps = new CrewFootsteps(); this.radioPosition = new Vector3();
    this.enginePosition = new Vector3(); this.engineRight = new Vector3(); this.anchorPosition = new Vector3();
  }
  get enabled() { return this.ambient.enabled; }
  async setEnabled(on) {
    await this.ambient.setEnabled(on);
    if (on && this.context !== this.ambient.context) this.create();
    this.last = null; this.footsteps.reset();
  }
  create() {
    const c = this.context = this.ambient.context, master = this.ambient.master;
    const oscillator = (type, frequency, destination) => {
      const o = c.createOscillator(); o.type = type; o.frequency.value = frequency; o.connect(destination); o.start(); return o;
    };
    const gain = destination => { const g = c.createGain(); g.gain.value = 0; g.connect(destination); return g; };
    this.engineFilter = c.createBiquadFilter(); this.engineFilter.type = 'lowpass'; this.engineFilter.frequency.value = 500;
    this.enginePanner = c.createStereoPanner(); this.enginePanner.connect(master);
    this.engineGain = gain(this.enginePanner); this.engineFilter.connect(this.engineGain);
    this.engine = oscillator('triangle', 35, this.engineFilter);
    this.harmonicGain = gain(this.engineFilter); this.harmonicGain.gain.value = .32;
    this.harmonic = oscillator('sine', 71, this.harmonicGain);
    this.winchGain = gain(master); this.winch = oscillator('triangle', 145, this.winchGain);
    this.anchorPanner = c.createStereoPanner(); this.anchorPanner.connect(master);
    this.anchorGain = gain(this.anchorPanner);
    this.anchorFilter = c.createBiquadFilter(); this.anchorFilter.type = 'lowpass'; this.anchorFilter.Q.value = -3; this.anchorFilter.channelCount = 1; this.anchorFilter.channelCountMode = 'explicit'; this.anchorFilter.connect(this.anchorGain);
    const motorGain = gain(this.anchorFilter); motorGain.gain.value = .45;
    this.anchorMotor = oscillator('triangle', 115, motorGain);
    const chainFilter = c.createBiquadFilter(); chainFilter.type = 'bandpass'; chainFilter.frequency.value = 1800; chainFilter.Q.value = .8;
    this.anchorRattleGain = gain(this.anchorFilter); this.ambient.noise.connect(chainFilter); chainFilter.connect(this.anchorRattleGain);
    this.breathGain = gain(master); const breathFilter = c.createBiquadFilter(); breathFilter.type = 'bandpass'; breathFilter.frequency.value = 850; breathFilter.Q.value = .6;
    this.ambient.noise.connect(breathFilter); breathFilter.connect(this.breathGain);
    this.rainGain = gain(master); const rainFilter = c.createBiquadFilter(); rainFilter.type = 'highpass'; rainFilter.frequency.value = 1900;
    this.ambient.noise.connect(rainFilter); rainFilter.connect(this.rainGain);
  }
  update(w, id, ship) {
    const p = w.players[id]; if (!p) return;
    const current = { time: w.time, mode: p.mode, anchor: w.ship.anchor, attached: w.cargo.attached, recovered: w.cargo.recovered, mission: w.mission, signal: w.signalSequence ?? 0,
      calls: w.callSequence || 0, acknowledgements: w.ackSequence || 0, surveys: Object.values(w.surveys || {}).filter(s => s.completedAt != null).length, x: p.deckX, z: p.deckZ };
    const previous = this.last; this.last = current;
    const now = performance.now(); if (!previous || w.time !== previous.time) this.worldAudioAt = now;
    const right = this.ambient.app.camera.matrixWorld.elements;
    const footsteps = this.footsteps.update(w, id, { x: right[0], z: right[2] });
    if (!this.enabled || !this.context) return;
    this.ambient.update();
    const camera = this.ambient.app.camera;
    const engineSpace = ship ? engineSpatialMix(ship.localToWorld(this.enginePosition.fromArray(ENGINE_POSITION)), camera.position, this.engineRight.set(right[0], right[1], right[2])) : undefined;
    const anchorSpace = ship ? engineSpatialMix(ship.localToWorld(this.anchorPosition.fromArray(WINDLASS_POSITION)), camera.position, this.engineRight) : undefined;
    const t = this.context.currentTime, mix = this.mix = vesselSoundMix(w, p, engineSpace, anchorSpace);
    // A stalled snapshot must not leave the windlass running indefinitely.
    if (now - this.worldAudioAt > 300) mix.anchor = 0;
    const target = (param, value, rate = .15) => param.setTargetAtTime(value, t, rate);
    const pulse = .92 + .08 * Math.sin(t * mix.engineHz * Math.PI);
    target(this.engine.frequency, mix.engineHz); target(this.harmonic.frequency, mix.engineHz * 2.015);
    target(this.engineFilter.frequency, mix.cutoff, .3); target(this.engineGain.gain, mix.engine * pulse);
    target(this.enginePanner.pan, mix.enginePan, .12);
    target(this.winchGain.gain, mix.winch); target(this.winch.frequency, 145 + Math.sin(t * 7) * 3);
    target(this.anchorGain.gain, mix.anchor, .06); target(this.anchorPanner.pan, mix.anchorPan, .12);
    target(this.anchorMotor.frequency, mix.anchorHz, .12); target(this.anchorFilter.frequency, mix.anchorCutoff, .15);
    target(this.anchorRattleGain.gain, mix.anchorRattle, .015);
    // A soft inhale/exhale envelope makes depth tangible without a repeating
    // click or a constant hiss competing with the ocean.
    const breathing = breathEnvelope(w.time, id);
    target(this.breathGain.gain, mix.breath * breathing, .08); target(this.rainGain.gain, mix.rain, .4);
    if (!previous || document.hidden || w.time < previous.time || w.time - previous.time > 1) return;
    for (const cue of footsteps) this.noiseCue(.075, cue.strength, 240, cue.pan);
    if (current.anchor !== previous.anchor && w.ship.anchorDrop === undefined) this.noiseCue(.75, .18, 1300);
    if (current.signal > previous.signal) this.tone([720, 540], .1, .065);
    if (current.calls > previous.calls || current.acknowledgements > previous.acknowledgements) {
      let pan = 0, level = 1;
      if (p.mode !== 'diver' && ship) {
        const camera = this.ambient.app.camera;
        const offset = ship.localToWorld(this.radioPosition.set(RADIO_STATION.x, RADIO_STATION.y, RADIO_STATION.z)).sub(camera.position);
        const range = offset.length();
        pan = Math.max(-.8, Math.min(.8, (offset.x * right[0] + offset.y * right[1] + offset.z * right[2]) / Math.max(1, range)));
        // Keep calls intelligible from the bow and in the follow camera.
        level = .55 + .45 / (1 + (range / 6) ** 2);
      }
      if (current.calls > previous.calls) this.tone([480, 640], .13, .065 * level, pan);
      if (current.acknowledgements > previous.acknowledgements) this.tone([640, 800], .09, .05 * level, pan);
    }
    if (current.surveys > previous.surveys) this.tone([523.25, 659.25, 783.99], .22, .07);
    if (current.attached && !previous.attached) this.tone([640, 960], .15, .1);
    if (current.recovered && !previous.recovered) this.tone([330, 440], .3, .12);
    if (current.mission === 'complete' && previous.mission !== 'complete') this.tone([330, 440, 660], .5, .16);
    if (current.mode !== previous.mode) {
      if (current.mode === 'diver' || previous.mode === 'diver') this.noiseCue(.5, .22, 650);
    }
  }
  noiseCue(duration, strength, cutoff, pan = null) {
    const c = this.context, source = c.createBufferSource(), filter = c.createBiquadFilter(), gain = c.createGain();
    source.buffer = this.ambient.noise.buffer; filter.type = 'lowpass'; filter.frequency.value = cutoff;
    // A relative decay floor keeps distant footfalls the same sound at a
    // lower level, instead of stretching their decay as strength decreases.
    const floor = pan === null ? .0001 : Math.max(1e-8, strength * .001);
    gain.gain.setValueAtTime(0, c.currentTime); gain.gain.linearRampToValueAtTime(strength, c.currentTime + .015); gain.gain.exponentialRampToValueAtTime(floor, c.currentTime + duration);
    source.connect(filter).connect(gain);
    const panner = pan === null ? null : c.createStereoPanner();
    if (panner) { filter.channelCount = 1; filter.channelCountMode = 'explicit'; panner.pan.value = pan; gain.connect(panner).connect(this.ambient.master); }
    else gain.connect(this.ambient.master);
    source.start(c.currentTime, .25); source.stop(c.currentTime + duration + .02);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); panner?.disconnect(); };
  }
  tone(notes, duration, strength, pan = null) {
    const c = this.context;
    notes.forEach((frequency, i) => {
      const o = c.createOscillator(), gain = c.createGain(), t = c.currentTime + i * duration * .6;
      o.type = 'sine'; o.frequency.value = frequency; gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(strength, t + .015); gain.gain.exponentialRampToValueAtTime(pan === null ? .0001 : Math.max(1e-8, strength * .001), t + duration);
      const panner = pan === null ? null : c.createStereoPanner();
      o.connect(gain);
      if (panner) { panner.pan.value = pan; gain.connect(panner).connect(this.ambient.master); }
      else gain.connect(this.ambient.master);
      o.start(t); o.stop(t + duration + .02);
      o.onended = () => { o.disconnect(); gain.disconnect(); panner?.disconnect(); };
    });
  }
}
