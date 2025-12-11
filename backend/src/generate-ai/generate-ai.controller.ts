import { 
  Body, 
  Controller, 
  Post, 
  UseInterceptors, 
  UploadedFiles,
  BadRequestException,
  InternalServerErrorException, 
  Sse,        
  MessageEvent,
  Param,
  UseGuards,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express'; 
import { GenerateAiService } from './generate-ai.service';
import { GenerateTextDto, GenerateVideoDto } from './dto/generate-ai.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Observable, fromEvent } from 'rxjs';
import { map, filter } from 'rxjs/operators';
import { ResponseInterceptor } from 'src/common/interceptors/response.interceptor';
import { ResponseMessage } from 'src/common/decorators/response-message.decorator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

@Controller('generate')
@UseGuards(JwtAuthGuard)
@UseInterceptors(ResponseInterceptor)
export class GenerateAiController {
  constructor(
    private readonly generateAiService: GenerateAiService, 
    private eventEmitter: EventEmitter2
  ) {}

  @Sse('progress/:jobId')
  sse(@Param('jobId') jobId: string): Observable<MessageEvent> {
    return fromEvent(this.eventEmitter, 'job.progress').pipe(
      filter((payload: any) => payload.jobId === jobId),
      map((payload: any) => {
        return {
          data: { 
            message: payload.message, 
            progress: payload.progress ?? null 
          },
        } as MessageEvent;
      }),
    );
  }

  @Post('text')
  @ResponseMessage('Generate Text Berhasil')
  async generateText(@Body() dto: GenerateTextDto) {
    return this.generateAiService.generateText(dto.imageUrl, dto.promptCount);
  }

  @Post('video')
  @ResponseMessage('Video sedang diproses')
  async generateVideo(@Body() dto: GenerateVideoDto) {
    const count = dto.prompts.length;
    if (![4, 5, 6].includes(count)) {
       throw new BadRequestException(`Jumlah prompt harus 4, 5, atau 6. Kamu kirim ${count}.`);
    }

    try {
      const result = await this.generateAiService.processVideoVariations(
          dto.images, 
          dto.prompts, 
          dto.script,
          dto.jobId
      );

      return result; 

    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Internal Server Error';
      throw new InternalServerErrorException(msg);
    }
  }

  @Post('upload')
  @UseInterceptors(FilesInterceptor('files', 6)) 
  @ResponseMessage('Upload File Berhasil')
  async uploadFiles(@UploadedFiles() files: Array<Express.Multer.File>) {
      if (!files || files.length === 0) throw new BadRequestException('File tidak ditemukan');
      
      for (const file of files) {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|webp)$/)) {
            throw new BadRequestException('Hanya boleh upload file gambar (jpg, png, webp)');
        }
      }

      try {
          return await this.generateAiService.uploadImages(files);
      } catch (error) {
          const msg = error instanceof Error ? error.message : 'Upload Failed';
          throw new InternalServerErrorException(msg);
      }
  }
}