import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { pipeline } from 'stream/promises';

@Injectable()
export class GenerateAiService {
  private readonly logger = new Logger(GenerateAiService.name);
  private openai: OpenAI;
  private gemini: GoogleGenAI;
  private tempDir = './temp';

  constructor(private configService: ConfigService) {
    // 1. Init OpenAI
    this.openai = new OpenAI({ apiKey: this.configService.get<string>('OPENAI_API_KEY') });
    
    // 2. Init Gemini
    const geminiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (geminiKey) this.gemini = new GoogleGenAI({ apiKey: geminiKey });

    // 3. Ensure Temp Directory
    if (!fs.existsSync(this.tempDir)) fs.mkdirSync(this.tempDir);
  }

  // =================================================================
  // A. PUBLIC METHOD: 1. ANALYZE IMAGE (OpenAI)
  // =================================================================
  async generateText(imageUrl: string) {
    this.logger.log(`OpenAI: Analyzing image...`);
    
    // Prompt Engineering
    const promptText = `
      Analisa gambar ini dengan teliti.
      
      Tugasmu adalah membuat 3 output dalam format JSON:
      
      1. "voiceover": 
         Buatkan naskah voiceover yang PADAT dan JELAS (Target 15-20 detik).
         - Gaya bahasa: Storytelling, santai, akrab, seperti me-review barang ke sahabat.
         - Akhiri dengan ajakan cek keranjang kuning.

      2. "tiktokCaption": 
         Caption TikTok lengkap, engaging, dan relevan dengan gambar.
         - Sertakan headline clickbait di baris pertama.
         - Sertakan 4-5 hashtag relevan.

      3. "videoPrompt": 
         Deskripsi visual singkat dalam Bahasa Inggris untuk AI Video Generator (seperti Wavespeed/Runway).
         - Deskripsikan gerakan kamera (misal: "Slow pan camera showing the texture...").
         - Fokus pada detail visual objek di gambar agar hasil videonya konsisten.
      
      Format Output WAJIB JSON:
      {
        "voiceover": "teks naskah...",
        "tiktokCaption": "teks caption...",
        "videoPrompt": "Cinematic shot of..."
      }
    `;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: [{ type: 'text', text: promptText }, { type: 'image_url', image_url: { url: imageUrl } }] }],
        response_format: { type: 'json_object' },
      });
      
      const content = response.choices[0].message.content;
      if (!content) throw new Error('OpenAI returned empty content');
      
      // Return Raw JSON (Biar Controller/Interceptor yang format)
      return JSON.parse(content);

    } catch (error) {
      this.logger.error(error);
      throw new InternalServerErrorException('OpenAI Error');
    }
  }

  // =================================================================
  // B. PUBLIC METHOD: 2. EXECUTE VIDEO CREATION (Batch + Audio + Merge)
  // =================================================================
  async processFullVideo(items: { prompt: string; imageUrl: string }[], script: string) {
    let cleanupFiles: string[] = [];

    try {
      this.logger.log(`=== START EXECUTION (${items.length} clips) ===`);

      // 1. PARALLEL EXECUTION (Video Batch & Audio TTS)
      // Kita jalankan semua task berat secara bersamaan
      this.logger.log("Running Wavespeed & Gemini concurrently...");

      const videoTasks = items.map((item, idx) => 
         this._generateSingleVideo(item.prompt, item.imageUrl)
            .then(url => ({ status: 'success', url, index: idx }))
            .catch(err => ({ status: 'failed', error: err, index: idx }))
      );

      // Generate audio langsung dari script yang dikirim (WAJIB ADA)
      const audioTask = this._generateAudio(script); 

      // Tunggu semua selesai
      const [videoResults, audioPath] = await Promise.all([
        Promise.all(videoTasks),
        audioTask
      ]);
      
      cleanupFiles.push(audioPath); // Masukkan audio ke list hapus

      // 2. Download Valid Videos
      this.logger.log("Downloading clips...");
      const successVideos = videoResults
        .filter((r): r is { status: 'success', url: string, index: number } => r.status === 'success')
        .sort((a, b) => a.index - b.index);

      if (successVideos.length < 2) throw new Error("Minimal 2 video diperlukan untuk penggabungan.");

      const localVideoPaths: string[] = [];
      for (const vid of successVideos) {
        const fileName = path.join(this.tempDir, `clip_${Date.now()}_${vid.index}.mp4`);
        await this._downloadFile(vid.url, fileName);
        localVideoPaths.push(fileName);
        cleanupFiles.push(fileName);
      }

      // 3. Merge Visual Clips
      const mergedVisualPath = path.join(this.tempDir, `visual_merged_${Date.now()}.mp4`);
      cleanupFiles.push(mergedVisualPath);
      await this._mergeVideoFiles(localVideoPaths, mergedVisualPath);

      // 4. Final Merge (Visual + Audio)
      const finalOutputPath = path.join(this.tempDir, `FINAL_${Date.now()}.mp4`);
      this.logger.log("Merging Visual + Audio...");

      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(mergedVisualPath)
          .input(audioPath)
          .outputOptions([
              '-c:v copy', '-c:a aac', 
              '-map 0:v:0', '-map 1:a:0', 
              '-shortest' // Potong durasi video mengikuti audio (atau sebaliknya yg terpendek)
          ])
          .save(finalOutputPath)
          .on('end', resolve)
          .on('error', (err) => reject(new Error(`FFmpeg Merge Error: ${err.message}`)));
      });

      return { finalPath: finalOutputPath, cleanupFiles };

    } catch (error) {
      // Emergency Cleanup
      cleanupFiles.forEach(f => { if(fs.existsSync(f)) fs.unlinkSync(f); });
      throw new InternalServerErrorException(error.message);
    }
  }

  // =================================================================
  // C. PRIVATE WORKERS (Internal Use Only)
  // =================================================================

  // 1. Wavespeed Worker
  private async _generateSingleVideo(prompt: string, imageUrl: string): Promise<string> {
    const apiKey = this.configService.get<string>('WAVESPEED_API_KEY');
    const urlSubmit = "https://api.wavespeed.ai/api/v3/bytedance/seedance-v1-pro-fast/image-to-video";
    
    const submitResp = await fetch(urlSubmit, {
        method: 'POST',
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({ camera_fixed: false, duration: 10, image: imageUrl, prompt, resolution: "480p", seed: -1 })
    });

    if (!submitResp.ok) throw new Error(await submitResp.text());
    const { data: { id: requestId } } = await submitResp.json();

    // Polling
    let attempts = 0;
    while (attempts < 60) {
        attempts++;
        await new Promise(r => setTimeout(r, 2000));
        const statusResp = await fetch(`https://api.wavespeed.ai/api/v3/predictions/${requestId}/result`, {
            headers: { "Authorization": `Bearer ${apiKey}` }
        });
        const statusData = await statusResp.json();
        
        if (statusData.data.status === "completed") return statusData.data.outputs[0];
        if (statusData.data.status === "failed") throw new Error(statusData.data.error);
    }
    throw new Error("Wavespeed Timeout");
  }

  // 2. Gemini TTS Worker
  private async _generateAudio(textScript: string): Promise<string> {
    if (!this.gemini) throw new Error("GEMINI_API_KEY missing");
    this.logger.log("Generating Audio TTS...");

    const response = await this.gemini.models.generateContentStream({
        model: 'gemini-2.5-flash-preview-tts',
        config: { responseModalities: ['audio'] as any, speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Achernar' } } } },
        contents: [{ role: 'user', parts: [{ text: textScript }] }]
    });

    const outputFileName = path.join(this.tempDir, `audio_${Date.now()}.wav`);
    for await (const chunk of response) {
        if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData) {
            const { data, mimeType } = chunk.candidates[0].content.parts[0].inlineData;
            // Gunakan helper convertToWav untuk memasang header yang benar
            const buffer = this._convertToWav(data || '', mimeType || '');
            await fs.promises.writeFile(outputFileName, buffer);
            return outputFileName;
        }
    }
    throw new Error("Gemini Audio Generation Failed");
  }

  // 3. Helpers (File & WAV Processing)
  private async _downloadFile(url: string, outputPath: string) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed: ${url}`);
    // @ts-ignore
    await pipeline(response.body, fs.createWriteStream(outputPath));
  }

  private _mergeVideoFiles(inputs: string[], output: string) {
    return new Promise((resolve, reject) => {
        const command = ffmpeg();
        inputs.forEach(p => command.input(p));
        command.on('end', resolve).on('error', reject).mergeToFile(output, this.tempDir);
    });
  }

  // --- WAV HEADER LOGIC (From your Express code) ---
  private _createWavHeader(dataLength: number, options: any): Buffer {
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

  private _parseMimeType(mimeType: string) {
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

  private _convertToWav(base64Data: string, mimeType: string): Buffer {
    const options = this._parseMimeType(mimeType);
    const buffer = Buffer.from(base64Data, 'base64');
    const wavHeader = this._createWavHeader(buffer.length, options);
    return Buffer.concat([wavHeader, buffer]);
  }
}