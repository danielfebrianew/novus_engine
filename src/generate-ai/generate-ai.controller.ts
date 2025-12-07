import { 
  Body, 
  Controller, 
  Post, 
  Res, 
  UseInterceptors, 
  UploadedFile, 
  BadRequestException,
  InternalServerErrorException 
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import 'multer';
import type { Response } from 'express';
import * as fs from 'fs';
import { GenerateAiService } from './generate-ai.service';
import { GenerateTextDto, GenerateVideoDto } from './dto/generate-ai.dto';

@Controller('generate')
export class GenerateAiController {
  constructor(private readonly generateAiService: GenerateAiService) {}

  // ==========================================
  // 1. ENDPOINT ANALISA (TEXT ONLY)
  // ==========================================
  @Post('text')
  async generateText(@Body() dto: GenerateTextDto) {
    // Menggunakan promptCount dari DTO atau default 4
    return this.generateAiService.generateText(dto.imageUrl, dto.promptCount);
  }

  // ==========================================
  // 2. ENDPOINT EKSEKUSI (VIDEO ZIP)
  // ==========================================
  @Post('video')
  async generateVideo(
    @Body() dto: GenerateVideoDto, 
    @Res() res: Response
  ) {
    try {
      // Validasi Manual: Jumlah Prompt harus 4, 5, atau 6
      const count = dto.prompts.length;
      if (![4, 5, 6].includes(count)) {
         return res.status(400).json({ 
             statusCode: 400, 
             message: `Jumlah prompt harus 4, 5, atau 6. Kamu kirim ${count}.` 
         });
      }

      // Panggil Service (support multi-image round robin)
      const result = await this.generateAiService.processVideoVariations(
          dto.images, 
          dto.prompts, 
          dto.script
      );

      // Kirim ZIP ke User
      res.download(result.finalPath, 'video_variations.zip', (err) => {
        if (err) {
            console.error("Download Error:", err);
        }

        // --- CLEANUP LOGIC ---
        // 1. Hapus File ZIP Final
        if (fs.existsSync(result.finalPath)) fs.unlinkSync(result.finalPath);
        
        // 2. Hapus Semua File Sampah (Raw Clips, Stitched Visuals, Audio)
        if (result.cleanupFiles && result.cleanupFiles.length > 0) {
            result.cleanupFiles.forEach(f => {
                if (fs.existsSync(f)) fs.unlinkSync(f);
            });
        }

        console.log("Cleanup Selesai.");
      });

    } catch (error) {
      // Safety check error type
      const msg = error instanceof Error ? error.message : 'Internal Server Error';
      
      // Cegah error "Can't set headers after they are sent"
      if (!res.headersSent) {
          res.status(500).json({ statusCode: 500, message: msg });
      }
    }
  }

  // ==========================================
  // 3. ENDPOINT UPLOAD IMAGE
  // ==========================================
  @Post('upload')
  @UseInterceptors(FileInterceptor('file')) // Nama field di Postman harus 'file'
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
      if (!file) throw new BadRequestException('File tidak ditemukan');
      
      // Validasi tipe file (harus gambar)
      if (!file.mimetype.match(/\/(jpg|jpeg|png|webp)$/)) {
          throw new BadRequestException('Hanya boleh upload file gambar (jpg, png, webp)');
      }

      try {
          return await this.generateAiService.uploadImage(file);
      } catch (error) {
          const msg = error instanceof Error ? error.message : 'Upload Failed';
          throw new InternalServerErrorException(msg);
      }
  }
}