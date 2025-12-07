import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path'; 
import ffmpeg from 'fluent-ffmpeg';
import { pipeline } from 'stream/promises';
import sharp from 'sharp';

@Injectable()
export class VideoUtilsHelper {
  private readonly logger = new Logger(VideoUtilsHelper.name);
  private tempDir = './temp'; 

  // 1. Shuffle Logic
  generateUniqueShuffles(length: number, limit: number): number[][] {
    const results = new Set<string>();
    const output: number[][] = [];
    const baseIndices = Array.from({ length }, (_, i) => i);
    let attempts = 0;

    // Safety break limit
    while (output.length < limit && attempts < limit * 50) {
      attempts++;
      const shuffled = [...baseIndices].sort(() => Math.random() - 0.5);
      const key = shuffled.join(',');
      
      if (!results.has(key)) {
        results.add(key);
        output.push(shuffled);
      }
    }

    if (output.length < limit) {
      this.logger.warn(`Hanya berhasil generate ${output.length} variasi dari target ${limit}`);
    }
    return output;
  }

  // 2. Download File
  async downloadFile(url: string, outputPath: string): Promise<void> {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`);
      if (!response.body) throw new Error('Response body is empty');

      // @ts-ignore
      await pipeline(response.body, fs.createWriteStream(outputPath));
    } catch (error) {
      this.logger.error(`Download Error: ${error.message}`);
      throw error;
    }
  }

  // 3. Trim Video (Memotong durasi)
  trimVideo(inputPath: string, outputPath: string, duration: number): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .setStartTime(0)
        .setDuration(duration)
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(new Error(`Trim Error: ${err.message}`)))
        .run();
    });
  }

  // 4. Merge Video (Stitching) - VERSI LEBIH ROBUST (Concat Filter)
  mergeVideoFiles(inputs: string[], output: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Kita gunakan filter complex 'concat' agar lebih aman untuk MP4
      // Format: [0:v][0:a][1:v][1:a]... concat=n=2:v=1:a=1 [v] [a]
      // Karena video Wavespeed mungkin tidak ada audio, kita fokus visual dulu [v]
      
      const inputArgs = inputs.flatMap(input => ['-i', input]);
      
      // Buat filter string: [0:v][1:v][2:v]... concat=n=X:v=1:a=0 [v]
      const filterInputs = inputs.map((_, i) => `[${i}:v]`).join('');
      const filterComplex = `${filterInputs}concat=n=${inputs.length}:v=1:a=0[v]`;

      const command = ffmpeg();
      
      inputs.forEach(input => command.input(input));

      command
        .complexFilter([filterComplex])
        .outputOptions(['-map [v]']) // Map hasil concat visual
        .save(output)
        .on('end', () => resolve())
        .on('error', (err) => {
            this.logger.error(`Merge Error: ${err.message}`);
            reject(err);
        });
    });
  }

  // 5. Audio Helpers
  createWavHeader(dataLength: number, options: any): Buffer {
    const { numChannels, sampleRate, bitsPerSample } = options;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const buffer = Buffer.alloc(44);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataLength, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataLength, 40);
    return buffer;
  }

  parseMimeType(mimeType: string) {
    const [fileType, ...params] = mimeType.split(';').map(s => s.trim());
    const [_, format] = fileType.split('/');
    const options = { numChannels: 1, sampleRate: 24000, bitsPerSample: 16 };
    if (format && format.startsWith('L')) {
      const bits = parseInt(format.slice(1), 10);
      if (!isNaN(bits)) options.bitsPerSample = bits;
    }
    for (const param of params) {
      const [key, value] = param.split('=').map(s => s.trim());
      if (key === 'rate') options.sampleRate = parseInt(value, 10);
    }
    return options;
  }

  convertToWav(base64Data: string, mimeType: string): Buffer {
    const options = this.parseMimeType(mimeType);
    const buffer = Buffer.from(base64Data, 'base64');
    const wavHeader = this.createWavHeader(buffer.length, options);
    return Buffer.concat([wavHeader, buffer]);
  }

  async downloadAndCropImage(url: string, prefix: string): Promise<string> {
    try {
      // 1. Download Gambar dari URL ke Buffer
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // 2. Setup Path Output
      const filename = `${prefix}_${Date.now()}.jpg`;
      const outputPath = path.join(this.tempDir, filename);

      // 3. Sharp Resize & Crop 9:16 (720x1280)
      await sharp(buffer)
        .resize(720, 1280, {
          fit: 'cover',       // Crop tengah otomatis
          position: 'center'
        })
        .toFile(outputPath);

      this.logger.log(`✅ Image cropped: ${filename}`);
      return outputPath; // Mengembalikan path file lokal

    } catch (error) {
      this.logger.error(`Gagal crop image: ${url}`, error);
      throw error; // Biarkan error naik ke atas
    }
  }

  async processImageTo916(buffer: Buffer): Promise<Buffer> {
    try {
      const image = sharp(buffer);
      const metadata = await image.metadata();

      const originalWidth = metadata.width || 0;
      const originalHeight = metadata.height || 0;

      if (originalWidth === 0 || originalHeight === 0) {
        throw new Error('Gagal membaca dimensi gambar.');
      }

      // Target Rasio 9:16 = 0.5625
      const targetRatio = 9 / 16;
      const currentRatio = originalWidth / originalHeight;

      let targetWidth, targetHeight;

      // LOGIKA MATEMATIKA:
      // Kita cari kotak 9:16 terbesar yang muat di dalam gambar asli
      
      if (currentRatio > targetRatio) {
        // Kasus 1: Gambar terlalu Lebar (Landscape/Square)
        // Patokannya adalah Tinggi (Height) tetap maksimal
        targetHeight = originalHeight;
        targetWidth = Math.round(originalHeight * targetRatio);
      } else {
        // Kasus 2: Gambar terlalu Tinggi (Sangat Portrait)
        // Patokannya adalah Lebar (Width) tetap maksimal
        targetWidth = originalWidth;
        targetHeight = Math.round(originalWidth * (16 / 9));
      }

      this.logger.log(`Cropping Image: ${originalWidth}x${originalHeight} -> ${targetWidth}x${targetHeight}`);

      return await image
        .resize(targetWidth, targetHeight, {
          fit: 'cover',      // Crop bagian tengah (center) jika rasio beda
          position: 'center' // Fokus di tengah
        })
        .toBuffer();

    } catch (error) {
      this.logger.error(`Sharp Error: ${error.message}`);
      throw error;
    }
  }
}