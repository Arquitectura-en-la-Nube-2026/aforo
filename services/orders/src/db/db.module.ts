import { Global, Module } from '@nestjs/common';
import { HealthModule } from '../common';
import { DbService } from './db.service';

@Global()
@Module({ imports: [HealthModule], providers: [DbService], exports: [DbService] })
export class DbModule {}
