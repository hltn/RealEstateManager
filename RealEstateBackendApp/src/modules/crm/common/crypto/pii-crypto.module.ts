import { Module } from '@nestjs/common';
import { PiiCryptoService } from './pii-crypto.service';

@Module({
  providers: [PiiCryptoService],
  exports: [PiiCryptoService],
})
export class PiiCryptoModule {}
