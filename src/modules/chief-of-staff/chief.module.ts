import { Module } from '@nestjs/common';
import { ChiefController } from './chief.controller';
import { ChiefService } from './chief.service';

@Module({ controllers: [ChiefController], providers: [ChiefService] })
export class ChiefModule {}
