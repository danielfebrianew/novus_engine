import { Injectable, InternalServerErrorException } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import { v4 as uuidv4 } from 'uuid'; 
import { VideoUtilsHelper } from './helpers/video-utils.helper'; 

@Injectable()
export class VideoMixerService {
  private readonly tempDir = path.resolve('./temp'); // Pastikan folder ini ada/dibuat
  private readonly outputDir = path.resolve('./output'); // Folder hasil

  constructor(private readonly videoUtilsHelper: VideoUtilsHelper) {
    // Pastikan folder temp dan output ada
    if (!fs.existsSync(this.tempDir)) fs.mkdirSync(this.tempDir);
    if (!fs.existsSync(this.outputDir)) fs.mkdirSync(this.outputDir);
  }

  async generateStitchedVideos(
    clipPaths: string[], 
    audioPath: string, 
    targetVariations: number = 1
  ) {
    const PROCESS_ID = uuidv4().split('-')[0]; // ID unik pendek
    const cleanupFiles: string[] = [];
    
    try {
      this.logProgress(PROCESS_ID, 'Mengenerate urutan unik...', 10);
      
      // Menggunakan helper kamu untuk generate order
      const uniqueOrders = this.videoUtilsHelper.generateUniqueShuffles(
        clipPaths.length, 
        targetVariations
      );

      this.logProgress(PROCESS_ID, `Memulai Stitching ${uniqueOrders.length} variasi...`, 20);

      const resultPaths: string[] = [];

      for (let i = 0; i < uniqueOrders.length; i++) {
        const order = uniqueOrders[i];
        const orderedPaths = order.map((index) => clipPaths[index]);

        // --- A. Stitch Visual (Menggunakan Helper Kamu) ---
        const tempVisualPath = path.join(this.tempDir, `vis_${PROCESS_ID}_${i}.mp4`);
        cleanupFiles.push(tempVisualPath);

        // Panggil helper mergeVideoFiles yang sudah ada
        await this.videoUtilsHelper.mergeVideoFiles(orderedPaths, tempVisualPath);

        // --- B. Merge Audio (Logic Kamu) ---
        const finalFileName = `VARIATION_${PROCESS_ID}_${i + 1}.mp4`;
        const finalVarPath = path.join(this.outputDir, finalFileName); // Simpan ke output dir

        await new Promise((resolve, reject) => {
          ffmpeg()
            .input(tempVisualPath)
            .input(audioPath)
            // Opsi ffmpeg sesuai requestmu
            // Note: -c:v copy hanya berhasil jika semua video punya codec/resolusi sama persis
            // Jika error, ganti '-c:v copy' menjadi '-c:v libx264' (tapi lebih lama render)
            .outputOptions(['-c:v copy', '-c:a aac', '-map 0:v:0', '-map 1:a:0'])
            // Opsional: Jika audio lebih pendek dari video, gunakan '-stream_loop -1' sebelum input audio
            .save(finalVarPath)
            .on('end', () => {
              resultPaths.push(finalVarPath);
              resolve(true);
            })
            .on('error', (err) => {
              console.error('FFmpeg Error:', err);
              reject(err);
            });
        });
        
        this.logProgress(PROCESS_ID, `Variasi ${i + 1} selesai.`, 80);
      }

      return {
        success: true,
        processId: PROCESS_ID,
        files: resultPaths
      };

    } catch (error) {
      console.error(error);
      throw new InternalServerErrorException('Gagal memproses video');
    } finally {
        // --- C. Cleanup (Hapus file temp visual, biarkan hasil akhir) ---
        // Uncomment jika ingin auto-delete temp files
        /*
        cleanupFiles.forEach(file => {
            if (fs.existsSync(file)) fs.unlinkSync(file);
        });
        */
    }
  }

  private logProgress(id: string, message: string, percent: number) {
    console.log(`[${id}] ${percent}% - ${message}`);
  }
}