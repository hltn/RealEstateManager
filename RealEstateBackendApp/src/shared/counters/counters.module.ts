import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Counter, CounterSchema } from './counter.schema';
import { CounterService } from './counter.service';

/** Bộ đếm nguyên tử dùng chung; module nghiệp vụ cần cấp số thì import module này. */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Counter.name, schema: CounterSchema }]),
  ],
  providers: [CounterService],
  exports: [CounterService],
})
export class CountersModule {}
