class AudioManager {
  constructor() {
    this.ctx = null;
    this.mainGain = null;

    // SSH hum references
    this.humOsc1 = null;
    this.humOsc2 = null;
    this.humLfo = null;
    this.humGain = null;
    this.humStopTimeout = null;
    this.isHumming = false;
    this.humVolume = 0.04; // Track hum level (booting vs active)

    // Load initial preference (default to true)
    this.enabled = localStorage.getItem('sound_enabled') !== 'false';

    // Auto-resume AudioContext on first user interaction
    const resumeOnGesture = () => {
      this.ensureContext();
      if (this.ctx && this.ctx.state === 'running') {
        document.removeEventListener('click', resumeOnGesture, true);
        document.removeEventListener('keydown', resumeOnGesture, true);
      }
    };
    document.addEventListener('click', resumeOnGesture, { capture: true, passive: true });
    document.addEventListener('keydown', resumeOnGesture, { capture: true, passive: true });
  }

  init() {
    if (this.ctx) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    this.ctx = new AudioContextClass();
    this.mainGain = this.ctx.createGain();
    this.mainGain.gain.value = this.enabled ? 1.0 : 0.0;
    this.mainGain.connect(this.ctx.destination);
  }

  setEnabled(enabled) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    localStorage.setItem('sound_enabled', enabled ? 'true' : 'false');

    if (this.mainGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.mainGain.gain.setValueAtTime(this.mainGain.gain.value, now);
      this.mainGain.gain.linearRampToValueAtTime(enabled ? 1.0 : 0.0, now + 0.05);
    }

    if (enabled) {
      if (this.isHumming && !this.humOsc1) {
        this.startHum(this.humVolume);
      }
    } else {
      const wasHumming = this.isHumming;
      this.stopHum(true); // Stop immediately to free CPU
      this.isHumming = wasHumming; // Retain intent to hum
    }
  }

  toggle() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  ensureContext() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().then(() => {
        // If hum was requested before interaction, start it now
        if (this.isHumming && !this.humOsc1) {
          this.startHum(this.humVolume);
        }
      });
    }
  }

  // Keyboard clicks
  playKeyclick(key) {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx || this.ctx.state === 'suspended') return;

    const now = this.ctx.currentTime;

    let pitch = 150; // base thock frequency
    let clickPitch = 1200; // transient frequency
    let clickDuration = 0.015;
    let thockDuration = 0.07;
    let volume = 0.015;

    if (key === ' ') {
      pitch = 110;
      clickPitch = 900;
      clickDuration = 0.02;
      thockDuration = 0.12;
      volume = 0.02;
    } else if (key === 'Enter') {
      pitch = 130;
      clickPitch = 1000;
      clickDuration = 0.025;
      thockDuration = 0.1;
      volume = 0.018;
    } else if (key === 'Backspace') {
      pitch = 170;
      clickPitch = 1400;
      clickDuration = 0.012;
      thockDuration = 0.05;
      volume = 0.012;
    }

    const offset = (Math.random() - 0.5) * 15;
    const finalPitch = pitch + offset * 0.1;
    const finalClickPitch = clickPitch + offset;

    // Transient click
    const osc1 = this.ctx.createOscillator();
    const gain1 = this.ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(finalClickPitch, now);
    osc1.frequency.exponentialRampToValueAtTime(finalClickPitch / 3, now + clickDuration);

    gain1.gain.setValueAtTime(volume * 0.7, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + clickDuration);

    osc1.connect(gain1);
    gain1.connect(this.mainGain);

    osc1.onended = () => {
      osc1.disconnect();
      gain1.disconnect();
    };

    osc1.start(now);
    osc1.stop(now + clickDuration + 0.01);

    // Thock body
    const osc2 = this.ctx.createOscillator();
    const gain2 = this.ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(finalPitch, now);
    osc2.frequency.exponentialRampToValueAtTime(finalPitch / 2, now + thockDuration);

    gain2.gain.setValueAtTime(volume, now);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + thockDuration);

    osc2.connect(gain2);
    gain2.connect(this.mainGain);

    osc2.onended = () => {
      osc2.disconnect();
      gain2.disconnect();
    };

    osc2.start(now);
    osc2.stop(now + thockDuration + 0.01);
  }

  // SSH server / CRT transformer background hum
  startHum(vol = null) {
    this.isHumming = true;
    if (vol !== null) {
      this.humVolume = vol;
    }
    if (this.humStopTimeout) {
      clearTimeout(this.humStopTimeout);
      this.humStopTimeout = null;
    }
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx || this.ctx.state === 'suspended') return;

    if (this.humOsc1) return;

    const now = this.ctx.currentTime;

    this.humGain = this.ctx.createGain();
    this.humGain.gain.setValueAtTime(0, now);
    this.humGain.gain.linearRampToValueAtTime(this.humVolume, now + 0.5); // Fade in over 0.5s

    this.humOsc1 = this.ctx.createOscillator();
    this.humOsc1.type = 'triangle';
    this.humOsc1.frequency.setValueAtTime(55, now); // 55Hz (A1)

    this.humOsc2 = this.ctx.createOscillator();
    this.humOsc2.type = 'sine';
    this.humOsc2.frequency.setValueAtTime(110, now); // 110Hz (A2)

    // Tremolo LFO to add warm fluctuation
    this.humLfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    this.humLfo.frequency.value = 8; // 8Hz modulation
    lfoGain.gain.value = 0.008;

    this.humLfo.connect(lfoGain);
    lfoGain.connect(this.humGain.gain);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(150, now);

    this.humOsc1.connect(filter);
    this.humOsc2.connect(filter);
    filter.connect(this.humGain);
    this.humGain.connect(this.mainGain);

    this.humOsc1.start(now);
    this.humOsc2.start(now);
    this.humLfo.start(now);
  }

  fadeHumQuiet() {
    this.humVolume = 0.012; // Quiet background hum
    if (!this.ctx || !this.humGain) return;
    const now = this.ctx.currentTime;
    this.humGain.gain.setValueAtTime(this.humGain.gain.value, now);
    this.humGain.gain.linearRampToValueAtTime(this.humVolume, now + 1.5);
  }

  stopHum(immediate = false) {
    this.isHumming = false;
    if (this.humStopTimeout) {
      clearTimeout(this.humStopTimeout);
      this.humStopTimeout = null;
    }
    if (!this.ctx || !this.humOsc1) return;

    const now = this.ctx.currentTime;
    const fadeOutTime = immediate ? 0 : 1.0;

    const gainNode = this.humGain;
    if (fadeOutTime > 0 && gainNode) {
      gainNode.gain.setValueAtTime(gainNode.gain.value, now);
      gainNode.gain.linearRampToValueAtTime(0, now + fadeOutTime);
    }

    const osc1 = this.humOsc1;
    const osc2 = this.humOsc2;
    const lfo = this.humLfo;

    const doStop = () => {
      try {
        osc1.stop();
        osc2.stop();
        lfo.stop();

        osc1.disconnect();
        osc2.disconnect();
        lfo.disconnect();
        if (gainNode) {
          gainNode.disconnect();
        }
      } catch (e) {
        // Safe check in case context closed or already stopped
      }
    };

    if (immediate) {
      doStop();
    } else {
      this.humStopTimeout = setTimeout(() => {
        doStop();
        this.humStopTimeout = null;
      }, fadeOutTime * 1000 + 100);
    }

    this.humOsc1 = null;
    this.humOsc2 = null;
    this.humLfo = null;
    this.humGain = null;
  }

  // Retro Boot Chime
  playBootChime() {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx || this.ctx.state === 'suspended') return;

    const now = this.ctx.currentTime;

    const notes = [
      { f: 329.63, start: 0.0, dur: 0.1 },  // E4
      { f: 440.00, start: 0.1, dur: 0.1 },  // A4
      { f: 493.88, start: 0.2, dur: 0.1 },  // B4
      { f: 659.25, start: 0.3, dur: 1.2 },  // E5
      { f: 880.00, start: 0.3, dur: 1.2 }   // A5
    ];

    notes.forEach(note => {
      const osc = this.ctx.createOscillator();
      const gainNode = this.ctx.createGain();

      osc.type = note.dur > 0.2 ? 'square' : 'triangle';
      osc.frequency.setValueAtTime(note.f, now + note.start);

      gainNode.gain.setValueAtTime(0.0, now + note.start);
      gainNode.gain.linearRampToValueAtTime(0.12, now + note.start + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + note.start + note.dur);

      if (note.dur > 0.2) {
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1500, now + note.start);
        filter.frequency.exponentialRampToValueAtTime(600, now + note.start + note.dur);

        const lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();
        lfo.frequency.value = 6;
        lfoGain.gain.value = 8;

        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);

        osc.connect(filter);
        filter.connect(gainNode);

        lfo.start(now + note.start);
        lfo.stop(now + note.start + note.dur);

        lfo.onended = () => {
          lfo.disconnect();
          lfoGain.disconnect();
        };

        osc.onended = () => {
          osc.disconnect();
          filter.disconnect();
          gainNode.disconnect();
        };
      } else {
        osc.connect(gainNode);
        osc.onended = () => {
          osc.disconnect();
          gainNode.disconnect();
        };
      }

      gainNode.connect(this.mainGain);

      osc.start(now + note.start);
      osc.stop(now + note.start + note.dur + 0.05);
    });
  }
  // Link / Button click sound
  playLinkClick() {
    this.playBeep(220, 330, 0.06, 'triangle', 0.15);
  }

  // Helper for quick pitch sweep playbacks
  playBeep(startFreq, endFreq, duration, type = 'sine', volume = 0.1) {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx || this.ctx.state === 'suspended') return;
    const now = this.ctx.currentTime;
    this.playBeepAt(startFreq, endFreq, duration, type, volume, now);
  }

  playBeepAt(startFreq, endFreq, duration, type = 'sine', volume = 0.1, time) {
    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, time);
    if (startFreq !== endFreq) {
      osc.frequency.exponentialRampToValueAtTime(endFreq, time + duration);
    }

    gainNode.gain.setValueAtTime(volume, time);
    gainNode.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.connect(gainNode);
    gainNode.connect(this.mainGain);

    osc.onended = () => {
      osc.disconnect();
      gainNode.disconnect();
    };

    osc.start(time);
    osc.stop(time + duration + 0.01);
  }

  playMelody(notes, type = 'sine', volume = 0.1) {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx || this.ctx.state === 'suspended') return;
    const now = this.ctx.currentTime;
    notes.forEach(note => {
      const startF = note.f;
      const endF = note.endF !== undefined ? note.endF : startF;
      const dur = note.dur !== undefined ? note.dur : 0.08;
      const delay = note.delay !== undefined ? note.delay : 0;
      this.playBeepAt(startF, endF, dur, type, volume, now + delay);
    });
  }
}

export const audio = new AudioManager();
