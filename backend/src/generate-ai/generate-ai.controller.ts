import { 
  Body, 
  Controller, 
  Post, 
  Res, 
  UseInterceptors, 
  UploadedFiles, // <--- Ganti UploadedFile jadi UploadedFiles
  BadRequestException,
  InternalServerErrorException 
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express'; // <--- Ganti FileInterceptor
import type { Response } from 'express';
import { GenerateAiService } from './generate-ai.service';
import { GenerateTextDto, GenerateVideoDto } from './dto/generate-ai.dto';

@Controller('generate')
export class GenerateAiController {
  constructor(private readonly generateAiService: GenerateAiService) {}

  // 1. ANALISA TEXT (Tetap Sama)
  @Post('text')
  async generateText(@Body() dto: GenerateTextDto) {
    // Analisa tetap butuh 1 gambar utama sebagai referensi
    // Jika user upload banyak, Frontend kirim salah satu URL saja ke sini
    return this.generateAiService.generateText(dto.imageUrl, dto.promptCount);
  }

  // 2. EKSEKUSI VIDEO (Output JSON Array URL)
  @Post('video')
  async generateVideo(
    @Body() dto: GenerateVideoDto, 
    @Res() res: Response // Tetap pakai Res untuk kontrol status code leluasa
  ) {
    try {
      const count = dto.prompts.length;
      if (![4, 5, 6].includes(count)) {
         return res.status(400).json({ 
             statusCode: 400, 
             message: `Jumlah prompt harus 4, 5, atau 6. Kamu kirim ${count}.` 
         });
      }

      // Panggil Service
      const result = await this.generateAiService.processVideoVariations(
          dto.images, 
          dto.prompts, 
          dto.script
      );

      // Return JSON berisi List URL Video
      return res.status(200).json({
          statusCode: 200,
          message: "Success",
          data: result // { variations: ["url1", "url2", ...] }
      });

    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Internal Server Error';
      return res.status(500).json({ statusCode: 500, message: msg });
    }
  }

  // 3. UPLOAD MULTIPLE IMAGES (Max 6)
  @Post('upload')
  @UseInterceptors(FilesInterceptor('files', 6)) // Max 6 file, field name 'files'
  async uploadFiles(@UploadedFiles() files: Array<Express.Multer.File>) {
      if (!files || files.length === 0) throw new BadRequestException('File tidak ditemukan');
      
      // Validasi tipe file
      for (const file of files) {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|webp)$/)) {
            throw new BadRequestException('Hanya boleh upload file gambar (jpg, png, webp)');
        }
      }

      try {
          // Panggil service upload multi
          return await this.generateAiService.uploadImages(files);
      } catch (error) {
          const msg = error instanceof Error ? error.message : 'Upload Failed';
          throw new InternalServerErrorException(msg);
      }
  }
}