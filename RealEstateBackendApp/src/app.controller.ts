import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AnyRole } from './common/decorators/any-role.decorator';

@ApiTags('App')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @AnyRole()
  @ApiOperation({
    summary: 'Get hello message',
    description: 'Get hello message',
  })
  getHello(): string {
    return this.appService.getHello();
  }
}
