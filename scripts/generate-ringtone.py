#!/usr/bin/env python3
"""Generate HomePing's original melodic marimba/chime ringtone, using no recordings."""
import math
import struct
import wave
from pathlib import Path

RATE = 32000
DURATION = 8.0
root = Path(__file__).resolve().parents[1]
output = root / 'apps/tv/app/src/main/res/raw/homeping_ring.wav'
output.parent.mkdir(parents=True, exist_ok=True)
samples = [0.0] * int(RATE * DURATION)

# Two answering phrases followed by a gentle resolution. MIDI notes are an
# original G-major melody, with low, quiet support rather than repeating beeps.
notes = [
    (0.00, 79, .72), (0.23, 83, .62), (0.46, 86, .62),
    (0.83, 81, .68), (1.10, 86, .56), (1.37, 83, .62), (1.72, 79, .74),
    (2.50, 76, .65), (2.73, 79, .60), (2.96, 83, .62),
    (3.33, 86, .68), (3.60, 83, .58), (3.87, 81, .62), (4.22, 79, .75),
    (5.05, 74, .50), (5.28, 79, .60), (5.51, 83, .58),
    (5.88, 81, .62), (6.15, 79, .72),
    (0.00, 55, .19), (2.50, 52, .17),
    (6.15, 55, .16), (6.15, 59, .12), (6.15, 62, .12),
]
for start, midi, gain in notes:
    frequency = 440 * 2 ** ((midi - 69) / 12)
    first = round(start * RATE)
    for n in range(min(round(1.6 * RATE), len(samples) - first)):
        t = n / RATE
        attack = min(t / .006, 1.0)
        # Rounded wooden attack, short upper partials and a soft bell tail.
        wood = math.sin(2 * math.pi * frequency * t) * math.exp(-t / .30)
        wood += .27 * math.sin(2 * math.pi * frequency * 3.99 * t) * math.exp(-t / .065)
        bell = .22 * math.sin(2 * math.pi * frequency * 2 * t) * math.exp(-t / .44)
        bell += .065 * math.sin(2 * math.pi * frequency * 3 * t) * math.exp(-t / .25)
        tail = .15 * math.sin(2 * math.pi * frequency * t) * math.exp(-t / .56)
        samples[first + n] += gain * attack * (wood + bell + tail)

# Short early reflections give the notes space without a long, muddy echo.
dry = samples[:]
for delay, gain in ((.047, .12), (.089, .08), (.139, .045)):
    offset = round(delay * RATE)
    for i in range(offset, len(samples)):
        samples[i] += gain * dry[i - offset]
peak = max(abs(value) for value in samples)
frames = bytearray()
for i, value in enumerate(samples):
    fade = min(1.0, (len(samples) - 1 - i) / (RATE * .16))
    frames.extend(struct.pack('<h', round(value / peak * .70 * fade * 32767)))
with wave.open(str(output), 'wb') as audio:
    audio.setnchannels(1)
    audio.setsampwidth(2)
    audio.setframerate(RATE)
    audio.writeframes(frames)
print('Generated original melodic ringtone:', output.relative_to(root))
