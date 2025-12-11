import { Controller, Post, Body, UseInterceptors } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResponseMessage } from '../common/decorators/response-message.decorator'; 
import { ResponseInterceptor } from '../common/interceptors/response.interceptor'; 

@Controller('auth')
@UseInterceptors(ResponseInterceptor)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ResponseMessage('Registrasi Berhasil')
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @ResponseMessage('Login Berhasil')
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }
}