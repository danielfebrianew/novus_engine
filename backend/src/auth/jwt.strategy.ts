import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), // Ambil token dari Header: Authorization Bearer ...
      ignoreExpiration: false, // Tolak jika token expired
      secretOrKey: 'RAHASIA_NEGARA', // Harus SAMA dengan yang di module tadi
    });
  }

  // Fungsi ini jalan otomatis jika token valid
  async validate(payload: any) {
    // Return object ini akan masuk ke request user (req.user)
    return { userId: payload.sub, email: payload.email };
  }
}