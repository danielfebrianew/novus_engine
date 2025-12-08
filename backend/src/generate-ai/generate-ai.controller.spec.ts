import { Test, TestingModule } from '@nestjs/testing';
import { GenerateAiController } from './generate-ai.controller';

describe('GenerateAiController', () => {
  let controller: GenerateAiController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GenerateAiController],
    }).compile();

    controller = module.get<GenerateAiController>(GenerateAiController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
