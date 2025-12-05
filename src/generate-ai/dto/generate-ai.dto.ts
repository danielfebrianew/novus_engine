import { IsArray, IsNotEmpty, IsString, IsUrl, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

// ==========================================
// 1. DTO UNTUK ENDPOINT /text
// ==========================================
export class GenerateTextDto {
  @IsNotEmpty()
  @IsUrl({}, { message: 'Image URL tidak valid' })
  imageUrl: string;
}

// ==========================================
// 2. DTO UNTUK ENDPOINT /video
// ==========================================

// Helper Class (Item Video)
export class VideoItem {
  @IsString()
  @IsNotEmpty()
  prompt: string;

  @IsUrl()
  @IsNotEmpty()
  imageUrl: string;
}

// Main DTO
export class GenerateVideoDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VideoItem)
  items: VideoItem[]; // Array berisi prompt & image

  @IsString()
  @IsNotEmpty() // <--- WAJIB DIISI! (Hasil dari generate /text)
  script: string;
}