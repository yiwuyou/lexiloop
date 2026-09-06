"""Render standalone word audio locally. Build-only dependencies live in work/."""
import argparse
import json
import subprocess
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'scripts' / 'work'
sys.path.insert(0, str(WORK / 'piper-tools'))
sys.path.insert(0, str(WORK / 'tools'))
import onnxruntime
from piper import PiperVoice
from piper.config import PiperConfig, SynthesisConfig
import imageio_ffmpeg

parser = argparse.ArgumentParser()
parser.add_argument('--limit', type=int, default=10000)
args = parser.parse_args()
config = json.loads((WORK / 'en_US-ljspeech-medium.onnx.json').read_text('utf-8'))
options = onnxruntime.SessionOptions()
options.intra_op_num_threads = 2
options.inter_op_num_threads = 1
voice = PiperVoice(
    session=onnxruntime.InferenceSession(str(WORK / 'en_US-ljspeech-medium.onnx'), sess_options=options, providers=['CPUExecutionProvider']),
    config=PiperConfig.from_dict(config),
)
synthesis = SynthesisConfig(length_scale=1.1)
manifest = json.loads((WORK / 'audio-manifest.json').read_text('utf-8'))
encoder = imageio_ffmpeg.get_ffmpeg_exe()
for index, entry in enumerate(manifest[:args.limit]):
    output = ROOT / entry['path'].lstrip('/')
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists() and output.stat().st_size > 500:
        continue
    wav = WORK / 'piper-word.wav'
    with wave.open(str(wav), 'wb') as stream:
        voice.synthesize_wav(entry['word'] + '.', stream, syn_config=synthesis)
    subprocess.run([encoder, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(wav),
                    '-ac', '1', '-ar', '24000', '-codec:a', 'libmp3lame', '-b:a', '32k', str(output)], check=True)
    if index % 100 == 0:
        print(f'generated {index + 1}/{len(manifest)}', flush=True)
print('Audio generation complete.', flush=True)
