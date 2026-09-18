import { useRef, useCallback, useState, useEffect } from 'react';

export interface AudioEffects {
  reverbEnabled: boolean;
  reverbLevel: number; // 0-1
  echoEnabled: boolean;
  echoDelay: number; // 0-1 seconds
  echoFeedback: number; // 0-0.8
  // Copyright protection effects
  pitchShift: number; // -0.1 to 0.1 (subtle pitch change)
  speedAdjust: number; // 0.95 to 1.05 (subtle speed change)
  copyrightProtectionEnabled: boolean;
  // Audio enhancement
  normalizeEnabled: boolean;
  eqEnabled: boolean;
  volume: number; // 0.5 to 2.0 (default 1.25)
}

const defaultEffects: AudioEffects = {
  reverbEnabled: false,
  reverbLevel: 0.5,
  echoEnabled: false,
  echoDelay: 0.3,
  echoFeedback: 0.4,
  pitchShift: 0,
  speedAdjust: 1.0,
  copyrightProtectionEnabled: false,
  normalizeEnabled: false,
  eqEnabled: false,
  volume: 1.25,
};

export function useAudioEffects() {
  const [effects, setEffects] = useState<AudioEffects>(defaultEffects);
  const [isInitialized, setIsInitialized] = useState(false);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const convolverRef = useRef<ConvolverNode | null>(null);
  const delayRef = useRef<DelayNode | null>(null);
  const feedbackRef = useRef<GainNode | null>(null);
  const reverbGainRef = useRef<GainNode | null>(null);
  const dryGainRef = useRef<GainNode | null>(null);
  const echoGainRef = useRef<GainNode | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const recordingDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const biquadFilterRef = useRef<BiquadFilterNode | null>(null);
  const highShelfRef = useRef<BiquadFilterNode | null>(null);
  const lowShelfRef = useRef<BiquadFilterNode | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  // Create impulse response for reverb (simulates mosque acoustics)
  const createImpulseResponse = useCallback((duration: number, decay: number, reverse: boolean = false) => {
    if (!audioContextRef.current) return null;
    
    const sampleRate = audioContextRef.current.sampleRate;
    const length = sampleRate * duration;
    const impulse = audioContextRef.current.createBuffer(2, length, sampleRate);
    
    for (let channel = 0; channel < 2; channel++) {
      const channelData = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const n = reverse ? length - i : i;
        channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - n / length, decay);
      }
    }
    
    return impulse;
  }, []);

  // Initialize audio context and nodes with copyright protection
  const initializeAudio = useCallback((audioElement: HTMLAudioElement, enableCopyrightProtection = false) => {
    if (isInitialized && sourceNodeRef.current) {
      return;
    }

    try {
      // Create or resume audio context
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }

      const ctx = audioContextRef.current;
      audioElementRef.current = audioElement;

      // Only create source node once
      if (!sourceNodeRef.current) {
        sourceNodeRef.current = ctx.createMediaElementSource(audioElement);
      }

      // Create nodes
      const convolver = ctx.createConvolver();
      const delay = ctx.createDelay(1.0);
      const feedback = ctx.createGain();
      const dryGain = ctx.createGain();
      const reverbGain = ctx.createGain();
      const echoGain = ctx.createGain();
      const masterGain = ctx.createGain();
      const recordingDest = ctx.createMediaStreamDestination();
      const biquadFilter = ctx.createBiquadFilter();
      const highShelf = ctx.createBiquadFilter();
      const lowShelf = ctx.createBiquadFilter();

      // Store refs
      convolverRef.current = convolver;
      delayRef.current = delay;
      feedbackRef.current = feedback;
      dryGainRef.current = dryGain;
      reverbGainRef.current = reverbGain;
      echoGainRef.current = echoGain;
      masterGainRef.current = masterGain;
      recordingDestRef.current = recordingDest;
      biquadFilterRef.current = biquadFilter;
      highShelfRef.current = highShelf;
      lowShelfRef.current = lowShelf;

      // Create mosque-like reverb impulse response
      const impulse = createImpulseResponse(3, 2);
      if (impulse) {
        convolver.buffer = impulse;
      }

      // Configure multi-band EQ for copyright fingerprint uniqueness
      // Mid-range subtle boost
      biquadFilter.type = 'peaking';
      biquadFilter.frequency.value = 1200;
      biquadFilter.Q.value = 0.7;
      biquadFilter.gain.value = enableCopyrightProtection ? 1.2 : 0;

      // High shelf - subtle warmth reduction
      highShelf.type = 'highshelf';
      highShelf.frequency.value = 8000;
      highShelf.gain.value = enableCopyrightProtection ? -0.8 : 0;

      // Low shelf - very subtle bass adjustment
      lowShelf.type = 'lowshelf';
      lowShelf.frequency.value = 200;
      lowShelf.gain.value = enableCopyrightProtection ? 0.6 : 0;

      // Set initial values
      dryGain.gain.value = 1;
      reverbGain.gain.value = effects.reverbEnabled ? effects.reverbLevel : 0;
      echoGain.gain.value = effects.echoEnabled ? 0.6 : 0;
      masterGain.gain.value = effects.volume ?? 1.25;
      delay.delayTime.value = effects.echoDelay;
      feedback.gain.value = effects.echoEnabled ? effects.echoFeedback : 0;

      // Mixdown: all paths -> master -> speakers + recording
      masterGain.connect(ctx.destination);
      masterGain.connect(recordingDest);

      // Dry path with multi-band fingerprint filter chain
      sourceNodeRef.current.connect(biquadFilter);
      biquadFilter.connect(highShelf);
      highShelf.connect(lowShelf);
      lowShelf.connect(dryGain);
      dryGain.connect(masterGain);

      // Reverb path
      sourceNodeRef.current.connect(convolver);
      convolver.connect(reverbGain);
      reverbGain.connect(masterGain);

      // Echo path
      sourceNodeRef.current.connect(delay);
      delay.connect(feedback);
      feedback.connect(delay);
      delay.connect(echoGain);
      echoGain.connect(masterGain);

      // Apply copyright protection if enabled
      if (enableCopyrightProtection) {
        setEffects(prev => ({ ...prev, copyrightProtectionEnabled: true }));
        // Apply subtle speed change via playbackRate
        audioElement.playbackRate = 1.02; // 2% faster - subtle enough to not notice
      }

      setIsInitialized(true);
    } catch (error) {
      console.error('Error initializing audio effects:', error);
    }
  }, [isInitialized, effects.echoDelay, effects.echoFeedback, effects.volume, createImpulseResponse]);

  // Update effects in real-time
  useEffect(() => {
    if (!isInitialized) return;

    // Update master volume
    if (masterGainRef.current) {
      masterGainRef.current.gain.value = effects.volume ?? 1.25;
    }

    // Update reverb
    if (reverbGainRef.current) {
      reverbGainRef.current.gain.value = effects.reverbEnabled ? effects.reverbLevel : 0;
    }

    // Update echo
    if (delayRef.current && feedbackRef.current && echoGainRef.current) {
      delayRef.current.delayTime.value = effects.echoDelay;
      feedbackRef.current.gain.value = effects.echoEnabled ? effects.echoFeedback : 0;
      echoGainRef.current.gain.value = effects.echoEnabled ? 0.6 : 0;
    }

    // Update EQ enhancement and copyright protection (multi-band fingerprint)
    const eqMid = effects.eqEnabled ? 2.5 : 0;
    const eqHigh = effects.eqEnabled ? -1.0 : 0;
    const eqLow = effects.eqEnabled ? 2.0 : 0;

    const cpMid = effects.copyrightProtectionEnabled ? 1.2 : 0;
    const cpHigh = effects.copyrightProtectionEnabled ? -0.8 : 0;
    const cpLow = effects.copyrightProtectionEnabled ? 0.6 : 0;

    if (biquadFilterRef.current) {
      biquadFilterRef.current.gain.value = cpMid + eqMid;
    }
    if (highShelfRef.current) {
      highShelfRef.current.gain.value = cpHigh + eqHigh;
    }
    if (lowShelfRef.current) {
      lowShelfRef.current.gain.value = cpLow + eqLow;
    }

    if (audioElementRef.current) {
      audioElementRef.current.playbackRate = effects.copyrightProtectionEnabled ? 1.02 : effects.speedAdjust;
    }
  }, [effects, isInitialized]);

  // Toggle copyright protection
  const toggleCopyrightProtection = useCallback((enabled: boolean) => {
    setEffects(prev => ({ 
      ...prev, 
      copyrightProtectionEnabled: enabled,
      speedAdjust: enabled ? 1.02 : 1.0,
    }));
    
    if (audioElementRef.current) {
      audioElementRef.current.playbackRate = enabled ? 1.02 : 1.0;
    }
  }, []);

  const getRecordingStream = useCallback((): MediaStream | null => {
    return recordingDestRef.current?.stream ?? null;
  }, []);

  // Resume audio context (needed for browsers that suspend it)
  const resumeContext = useCallback(async () => {
    if (audioContextRef.current?.state === 'suspended') {
      await audioContextRef.current.resume();
    }
  }, []);

  // Cleanup
  const cleanup = useCallback(() => {
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try {
        sourceNodeRef.current?.disconnect();
        convolverRef.current?.disconnect();
        delayRef.current?.disconnect();
        feedbackRef.current?.disconnect();
        dryGainRef.current?.disconnect();
        reverbGainRef.current?.disconnect();
        echoGainRef.current?.disconnect();
        masterGainRef.current?.disconnect();
        recordingDestRef.current?.disconnect();
        biquadFilterRef.current?.disconnect();
        highShelfRef.current?.disconnect();
        lowShelfRef.current?.disconnect();
      } catch (e) {
        // Ignore disconnect errors
      }
    }
    setIsInitialized(false);
  }, []);

  const updateEffect = useCallback(<K extends keyof AudioEffects>(
    key: K,
    value: AudioEffects[K]
  ) => {
    setEffects(prev => ({ ...prev, [key]: value }));
  }, []);

  const resetEffects = useCallback(() => {
    setEffects(defaultEffects);
  }, []);

  return {
    effects,
    setEffects,
    updateEffect,
    resetEffects,
    initializeAudio,
    resumeContext,
    cleanup,
    getRecordingStream,
    isInitialized,
    toggleCopyrightProtection,
  };
}
