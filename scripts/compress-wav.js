const fs = require('fs');
const path = require('path');

const directory = path.join(__dirname, '..', 'assets', 'audio');

fs.readdirSync(directory).filter((name) => name.endsWith('.wav')).forEach((name) => {
  const file = path.join(directory, name);
  const source = fs.readFileSync(file);
  const inputRate = source.readUInt32LE(24);
  const channels = source.readUInt16LE(22);
  const bits = source.readUInt16LE(34);
  if (channels !== 1 || ![8, 16].includes(bits)) throw new Error(`Unsupported source format: ${name}`);

  let offset = 12;
  let dataStart = -1;
  let dataLength = 0;
  while (offset + 8 <= source.length) {
    const chunk = source.toString('ascii', offset, offset + 4);
    const length = source.readUInt32LE(offset + 4);
    if (chunk === 'data') {
      dataStart = offset + 8;
      dataLength = length;
      break;
    }
    offset += 8 + length + (length % 2);
  }
  if (dataStart < 0) throw new Error(`No audio data: ${name}`);

  const targetRate = 8000;
  const ratio = inputRate / targetRate;
  const bytesPerInputSample = bits / 8;
  const sampleCount = Math.floor((dataLength / bytesPerInputSample) / ratio);
  const outputDataLength = sampleCount * 2;
  const output = Buffer.alloc(44 + outputDataLength);
  output.write('RIFF', 0);
  output.writeUInt32LE(36 + outputDataLength, 4);
  output.write('WAVEfmt ', 8);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(targetRate, 24);
  output.writeUInt32LE(targetRate * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write('data', 36);
  output.writeUInt32LE(outputDataLength, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const sourceIndex = Math.floor(index * ratio);
    const inputOffset = dataStart + sourceIndex * bytesPerInputSample;
    const sample = bits === 16
      ? source.readInt16LE(inputOffset)
      : (source[inputOffset] - 128) << 8;
    output.writeInt16LE(sample, 44 + index * 2);
  }
  fs.writeFileSync(file, output);
});

console.log('Normalized WAV files to iOS-compatible 8 kHz, 16-bit mono PCM.');
