import { IsArray, IsNotEmpty, IsString, IsUrl, IsInt, Min, Max, IsOptional, ArrayMinSize } from 'class-validator';

// 1. DTO UNTUK ENDPOINT /text
export class GenerateTextDto {
  @IsNotEmpty()
  @IsUrl({}, { message: 'Image URL tidak valid' })
  imageUrl: string;

  @IsOptional() // Opsional, kalau user gak isi kita default ke 4
  @IsInt()
  @Min(4, { message: 'Minimal 4 prompt' })
  @Max(6, { message: 'Maksimal 6 prompt' })
  promptCount?: number; 
}

// 2. DTO Utama (Variations) - TETAP SAMA
export class GenerateVideoDto {
  @IsArray()
  @ArrayMinSize(1, { message: "Minimal harus ada 1 gambar." })
  @IsUrl({}, { each: true, message: "Setiap item dalam images harus berupa URL valid." })
  images: string[]; 

  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  prompts: string[]; 

  @IsString()
  @IsNotEmpty()
  script: string;

  @IsString()
  @IsNotEmpty()
  jobId: string;
}